import { describe, it, expect } from 'vitest';
import { ToolRequestSchema, toolManifest, toolNames } from '../src/core/schemas.js';

describe('Tool Request Validation', () => {
  it('validates list_repos with defaults applied', () => {
    const parsed = ToolRequestSchema.safeParse({ id: 'req_1', tool: 'list_repos' });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.tool === 'list_repos') {
      expect(parsed.data.args.per_page).toBe(100);
    }
  });

  it('accepts free-form correlation IDs (not just UUIDs)', () => {
    const parsed = ToolRequestSchema.safeParse({
      id: 'agent-turn-42',
      tool: 'get_repo',
      args: { owner: 'octocat', repo: 'hello-world' },
    });
    expect(parsed.success).toBe(true);
  });

  it('validates create_branch with a string branch name', () => {
    const parsed = ToolRequestSchema.safeParse({
      id: 'req_2',
      tool: 'create_branch',
      args: { owner: 'test-org', repo: 'test-repo', branch: 'feature/ai-gen', source: 'develop' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.tool === 'create_branch') {
      expect(parsed.data.args.branch).toBe('feature/ai-gen');
    }
  });

  it('rejects an object where branch must be a string', () => {
    const parsed = ToolRequestSchema.safeParse({
      id: 'req_3',
      tool: 'create_branch',
      args: { owner: 'test-org', repo: 'test-repo', branch: { name: 'feature/x' } },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects invalid owner names', () => {
    const parsed = ToolRequestSchema.safeParse({
      id: 'req_4',
      tool: 'get_repo',
      args: { owner: 'invalid name!', repo: 'repo' },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects directory traversal in commit_files paths', () => {
    const parsed = ToolRequestSchema.safeParse({
      id: 'req_5',
      tool: 'commit_files',
      args: {
        owner: 'org',
        repo: 'repo',
        message: 'test',
        branch: 'main',
        files: [{ path: '../../etc/passwd', content: 'x' }],
      },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects requests without an id', () => {
    const parsed = ToolRequestSchema.safeParse({ tool: 'list_repos' });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown tools', () => {
    const parsed = ToolRequestSchema.safeParse({ id: 'req_6', tool: 'delete_everything', args: {} });
    expect(parsed.success).toBe(false);
  });

  it('applies get_file_content ref default', () => {
    const parsed = ToolRequestSchema.safeParse({
      id: 'req_7',
      tool: 'get_file_content',
      args: { owner: 'o', repo: 'r', path: 'src/index.ts' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.tool === 'get_file_content') {
      expect(parsed.data.args.ref).toBe('main');
    }
  });
});

describe('Tool Manifest', () => {
  it('exposes a JSON Schema entry for every tool', () => {
    const manifest = toolManifest();
    expect(manifest.map((m) => m.name).sort()).toEqual([...toolNames].sort());
    for (const entry of manifest) {
      expect(entry.description.length).toBeGreaterThan(0);
      expect(typeof entry.streaming).toBe('boolean');
      expect(entry.parameters).toHaveProperty('type');
    }
  });

  it('marks required properties for get_diff', () => {
    const entry = toolManifest().find((m) => m.name === 'get_diff');
    expect(entry).toBeDefined();
    const required = (entry!.parameters as { required?: string[] }).required ?? [];
    expect(required).toEqual(expect.arrayContaining(['owner', 'repo', 'base', 'head']));
  });
});
