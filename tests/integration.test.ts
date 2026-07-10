import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { AgentBridge } from '../src/core/registry.js';
import { StreamMessage } from '../src/core/protocol.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('AgentBridge Integration', () => {
  const bridge = new AgentBridge({ token: 'test_token', strictSandbox: true });

  it('streams get_file_content correctly', async () => {
    server.use(
      http.get('https://api.github.com/repos/test/repo/contents/package.json', () => {
        return HttpResponse.json({
          type: 'file',
          path: 'package.json',
          size: 12,
          content: Buffer.from('{"name":"x"}').toString('base64'),
          sha: 'abc123'
        });
      })
    );

    const messages: StreamMessage[] = [];
    const result = await bridge.execute('get_file_content', {
      id: '123e4567-e89b-12d3-a456-426614174000',
      owner: 'test',
      repo: 'repo',
      path: 'package.json',
      ref: 'main'
    }, (msg) => messages.push(msg));

    expect(result.content).toBe('{"name":"x"}');
    expect(messages.some(m => m.type === 'log')).toBe(true);
    expect(messages.some(m => m.type === 'result')).toBe(true);
  });

  it('handles API errors gracefully', async () => {
    server.use(
      http.get('https://api.github.com/repos/test/repo', () => {
        return new HttpResponse(null, { status: 404 });
      })
    );

    const messages: StreamMessage[] = [];
    await expect(bridge.execute('get_repo', {
      id: '123e4567-e89b-12d3-a456-426614174001',
      owner: 'test',
      repo: 'repo'
    }, (msg) => messages.push(msg))).rejects.toThrow();

    expect(messages.some(m => m.type === 'error')).toBe(true);
  });
});