import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { AgentBridge, ToolValidationError } from '../src/core/registry.js';
import { StreamMessage, CHUNK_SIZE } from '../src/core/protocol.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const bridge = new AgentBridge({ token: 'test_token', throttle: false });

describe('AgentBridge integration', () => {
  it('correlates every stream frame with the caller-supplied request ID', async () => {
    server.use(
      http.get('https://api.github.com/repos/test/repo/contents/package.json', () =>
        HttpResponse.json({
          type: 'file',
          path: 'package.json',
          size: 12,
          encoding: 'base64',
          content: Buffer.from('{"name":"x"}').toString('base64'),
          sha: 'abc123',
        }),
      ),
    );

    const messages: StreamMessage[] = [];
    const result = (await bridge.execute(
      'get_file_content',
      { owner: 'test', repo: 'repo', path: 'package.json', ref: 'main' },
      (msg) => messages.push(msg),
      'req_42',
    )) as { content: string };

    expect(result.content).toBe('{"name":"x"}');
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((m) => m.id === 'req_42')).toBe(true);
    expect(messages.at(-1)?.type).toBe('result');
  });

  it('streams large file content as chunk frames', async () => {
    const bigContent = 'x'.repeat(CHUNK_SIZE + 1000);
    server.use(
      http.get('https://api.github.com/repos/test/repo/contents/big.txt', () =>
        HttpResponse.json({
          type: 'file',
          path: 'big.txt',
          size: bigContent.length,
          encoding: 'base64',
          content: Buffer.from(bigContent).toString('base64'),
          sha: 'big1',
        }),
      ),
    );

    const messages: StreamMessage[] = [];
    const result = (await bridge.execute(
      'get_file_content',
      { owner: 'test', repo: 'repo', path: 'big.txt' },
      (msg) => messages.push(msg),
    )) as { chunked?: boolean; chunks?: number };

    expect(result.chunked).toBe(true);
    const chunks = messages.filter((m) => m.type === 'chunk');
    expect(chunks).toHaveLength(result.chunks!);
    expect(chunks.map((c) => c.data).join('')).toBe(bigContent);
  });

  it('rejects invalid arguments before touching the network', async () => {
    const messages: StreamMessage[] = [];
    await expect(
      bridge.execute('get_repo', { owner: 'bad name!', repo: 'r' }, (msg) => messages.push(msg)),
    ).rejects.toThrow(ToolValidationError);
    expect(messages.some((m) => m.type === 'error' && m.code === 'VALIDATION_FAILED')).toBe(true);
  });

  it('emits an error frame and rethrows on API failures', async () => {
    server.use(
      http.get('https://api.github.com/repos/test/missing', () => new HttpResponse(null, { status: 404 })),
    );

    const messages: StreamMessage[] = [];
    await expect(
      bridge.execute('get_repo', { owner: 'test', repo: 'missing' }, (msg) => messages.push(msg)),
    ).rejects.toThrow();
    expect(messages.some((m) => m.type === 'error')).toBe(true);
  });

  it('lists repositories', async () => {
    server.use(
      http.get('https://api.github.com/user/repos', () =>
        HttpResponse.json([
          { full_name: 'me/a', private: false, default_branch: 'main', html_url: 'https://github.com/me/a' },
        ]),
      ),
    );
    const result = (await bridge.execute('list_repos', {})) as Array<{ full_name: string }>;
    expect(result).toEqual([
      { full_name: 'me/a', private: false, default_branch: 'main', url: 'https://github.com/me/a' },
    ]);
  });

  it('creates a branch from a source ref', async () => {
    server.use(
      http.get('https://api.github.com/repos/o/r/git/ref/heads%2Fmain', () =>
        HttpResponse.json({ object: { sha: 'deadbeef' } }),
      ),
      http.post('https://api.github.com/repos/o/r/git/refs', () =>
        HttpResponse.json({ ref: 'refs/heads/feat', object: { sha: 'deadbeef' } }, { status: 201 }),
      ),
    );
    const result = await bridge.execute('create_branch', { owner: 'o', repo: 'r', branch: 'feat' });
    expect(result).toEqual({ created: true, branch: 'feat', source: 'main', sha: 'deadbeef' });
  });

  it('commits utf-8 and base64 files atomically', async () => {
    let treePayload: { tree: Array<Record<string, unknown>> } | undefined;
    server.use(
      http.get('https://api.github.com/repos/o/r/branches/main', () =>
        HttpResponse.json({ commit: { sha: 'base1' } }),
      ),
      http.post('https://api.github.com/repos/o/r/git/blobs', () =>
        HttpResponse.json({ sha: 'blob1' }, { status: 201 }),
      ),
      http.post('https://api.github.com/repos/o/r/git/trees', async ({ request }) => {
        treePayload = (await request.json()) as typeof treePayload;
        return HttpResponse.json({ sha: 'tree1' }, { status: 201 });
      }),
      http.post('https://api.github.com/repos/o/r/git/commits', () =>
        HttpResponse.json({ sha: 'commit1' }, { status: 201 }),
      ),
      http.patch('https://api.github.com/repos/o/r/git/refs/heads%2Fmain', () =>
        HttpResponse.json({ object: { sha: 'commit1' } }),
      ),
    );

    const result = await bridge.execute('commit_files', {
      owner: 'o',
      repo: 'r',
      message: 'feat: add files',
      branch: 'main',
      files: [
        { path: 'a.txt', content: 'hello' },
        { path: 'b.bin', content: Buffer.from('binary').toString('base64'), encoding: 'base64' },
      ],
    });

    expect(result).toEqual({ sha: 'commit1', files: 2, branch: 'main' });
    // utf-8 file goes inline; base64 file is referenced by blob SHA.
    expect(treePayload?.tree).toEqual([
      { path: 'a.txt', mode: '100644', type: 'blob', content: 'hello' },
      { path: 'b.bin', mode: '100644', type: 'blob', sha: 'blob1' },
    ]);
  });

  it('opens a pull request', async () => {
    server.use(
      http.post('https://api.github.com/repos/o/r/pulls', () =>
        HttpResponse.json(
          { html_url: 'https://github.com/o/r/pull/7', number: 7, state: 'open', draft: false },
          { status: 201 },
        ),
      ),
    );
    const result = await bridge.execute('create_pr', {
      owner: 'o',
      repo: 'r',
      title: 'My PR',
      base: 'main',
      head: 'feat',
    });
    expect(result).toEqual({ url: 'https://github.com/o/r/pull/7', number: 7, state: 'open', draft: false });
  });

  it('generates a diff between refs', async () => {
    server.use(
      http.get('https://api.github.com/repos/o/r/compare/main...feat', () =>
        HttpResponse.text('diff --git a/x b/x\n+new line\n'),
      ),
    );
    const result = (await bridge.execute('get_diff', {
      owner: 'o',
      repo: 'r',
      base: 'main',
      head: 'feat',
    })) as { patch: string };
    expect(result.patch).toContain('diff --git');
  });

  it('searches code', async () => {
    server.use(
      http.get('https://api.github.com/search/code', () =>
        HttpResponse.json({
          total_count: 1,
          items: [
            {
              path: 'src/x.ts',
              html_url: 'https://github.com/o/r/blob/main/src/x.ts',
              repository: { full_name: 'o/r' },
            },
          ],
        }),
      ),
    );
    const result = (await bridge.execute('search_code', { query: 'AgentBridge' })) as Array<{ path: string }>;
    expect(result).toEqual([
      { repository: 'o/r', path: 'src/x.ts', url: 'https://github.com/o/r/blob/main/src/x.ts' },
    ]);
  });

  it('lists issues and flags pull requests', async () => {
    server.use(
      http.get('https://api.github.com/repos/o/r/issues', () =>
        HttpResponse.json([
          { number: 1, title: 'Bug', state: 'open', html_url: 'https://github.com/o/r/issues/1' },
          {
            number: 2,
            title: 'PR',
            state: 'open',
            html_url: 'https://github.com/o/r/pull/2',
            pull_request: { url: 'x' },
          },
        ]),
      ),
    );
    const result = (await bridge.execute('list_issues', { owner: 'o', repo: 'r' })) as Array<{
      is_pull_request: boolean;
    }>;
    expect(result.map((i) => i.is_pull_request)).toEqual([false, true]);
  });

  it('rejects non-file paths in get_file_content', async () => {
    server.use(
      http.get('https://api.github.com/repos/o/r/contents/src', () =>
        HttpResponse.json([{ type: 'file', path: 'src/a.ts' }]),
      ),
    );
    await expect(bridge.execute('get_file_content', { owner: 'o', repo: 'r', path: 'src' })).rejects.toThrow(
      'not a file',
    );
  });
});
