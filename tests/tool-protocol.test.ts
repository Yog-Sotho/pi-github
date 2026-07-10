import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRequestSchema } from '../src/core/schemas';

describe('Tool Request Validation', () => {
  it('validates list_repos', () => {
    const input = JSON.stringify({ tool: 'list_repos' });
    const parsed = ToolRequestSchema.safeParse(JSON.parse(input));
    expect(parsed.success).toBe(true);
  });

  it('validates create_branch', () => {
    const input = JSON.stringify({
      tool: 'create_branch',
      args: { owner: 'test-org', repo: 'test-repo', branch: { name: 'feature/ai-gen' }, source: 'develop' }
    });
    const parsed = ToolRequestSchema.safeParse(JSON.parse(input));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.args.owner).toBe('test-org');
  });

  it('rejects invalid repo names', () => {
    const input = JSON.stringify({
      tool: 'get_repo',
      args: { owner: 'invalid name!', repo: 'repo' }
    });
    const parsed = ToolRequestSchema.safeParse(JSON.parse(input));
    expect(parsed.success).toBe(false);
  });

  it('rejects directory traversal in paths', () => {
    const input = JSON.stringify({
      tool: 'commit',
      args: {
        owner: 'org',
        repo: 'repo',
        message: 'test',
        files: [{ path: '../../etc/passwd', content: 'test' }]
      }
    });
    const parsed = ToolRequestSchema.safeParse(JSON.parse(input));
    expect(parsed.success).toBe(false);
  });
});