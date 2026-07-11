import { OctokitClient, withRetry, NonRetryableError } from '../core/auth.js';
import type { ToolArgs } from '../core/schemas.js';
import { StreamEmitter, emitChunked } from '../core/protocol.js';

export async function getFileContent(
  octokit: OctokitClient,
  args: ToolArgs<'get_file_content'>,
  emit: StreamEmitter,
): Promise<Record<string, unknown>> {
  const { owner, repo, path, ref } = args;
  emit({ type: 'log', level: 'debug', msg: `Fetching ${path}@${ref}` });

  return withRetry(async () => {
    const res = await octokit.repos.getContent({ owner, repo, path, ref });
    const data = res.data as {
      type?: string;
      path?: string;
      size?: number;
      sha?: string;
      content?: string;
      encoding?: string;
    };

    if (Array.isArray(res.data) || data.type !== 'file') {
      throw new NonRetryableError(`Path is not a file: ${path}`);
    }

    let content: string;
    if (data.encoding === 'base64' && typeof data.content === 'string') {
      content = Buffer.from(data.content, 'base64').toString('utf-8');
    } else {
      // Files >1 MiB come back with encoding "none"; fetch the raw blob instead.
      const raw = await octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
        mediaType: { format: 'raw' },
      });
      content = raw.data as unknown as string;
    }

    return { path: data.path, size: data.size, sha: data.sha, ...emitChunked(emit, 'content', content) };
  });
}

export interface CommitResult {
  sha: string;
  files: number;
  branch: string;
}

export async function commitFiles(
  octokit: OctokitClient,
  args: ToolArgs<'commit_files'>,
): Promise<CommitResult> {
  const { owner, repo, message, branch, files } = args;

  return withRetry(async () => {
    const branchRes = await octokit.repos.getBranch({ owner, repo, branch });
    const latestSha = branchRes.data.commit.sha;

    const treeItems = await Promise.all(
      files.map(async (f) => {
        if (f.encoding === 'base64') {
          // Binary content must go through the blob API; the tree `content`
          // field only accepts UTF-8 text.
          const blob = await octokit.git.createBlob({
            owner,
            repo,
            content: f.content,
            encoding: 'base64',
          });
          return { path: f.path, mode: '100644' as const, type: 'blob' as const, sha: blob.data.sha };
        }
        return { path: f.path, mode: '100644' as const, type: 'blob' as const, content: f.content };
      }),
    );

    const treeRes = await octokit.git.createTree({ owner, repo, tree: treeItems, base_tree: latestSha });
    const commitRes = await octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: treeRes.data.sha,
      parents: [latestSha],
    });
    await octokit.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commitRes.data.sha });

    return { sha: commitRes.data.sha, files: files.length, branch };
  });
}
