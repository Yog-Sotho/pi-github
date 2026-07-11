import { OctokitClient, withRetry } from '../core/auth.js';
import type { ToolArgs } from '../core/schemas.js';
import { StreamEmitter } from '../core/protocol.js';

export interface CodeSearchHit {
  repository: string;
  path: string;
  url: string;
}

export async function searchCode(
  octokit: OctokitClient,
  args: ToolArgs<'search_code'>,
  emit: StreamEmitter,
): Promise<CodeSearchHit[]> {
  emit({ type: 'log', level: 'debug', msg: `Searching code: ${args.query}` });
  return withRetry(async () => {
    const res = await octokit.search.code({ q: args.query, per_page: args.per_page });
    return res.data.items.map((i) => ({
      repository: i.repository.full_name,
      path: i.path,
      url: i.html_url,
    }));
  });
}
