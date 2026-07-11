import { OctokitClient, withRetry } from '../core/auth.js';
import type { ToolArgs } from '../core/schemas.js';
import { StreamEmitter } from '../core/protocol.js';

export interface IssueSummary {
  number: number;
  title: string;
  state: string;
  is_pull_request: boolean;
  url: string;
}

export async function listIssues(
  octokit: OctokitClient,
  args: ToolArgs<'list_issues'>,
  emit: StreamEmitter,
): Promise<IssueSummary[]> {
  emit({ type: 'log', level: 'debug', msg: `Listing ${args.state} issues` });
  return withRetry(async () => {
    const res = await octokit.issues.listForRepo({
      owner: args.owner,
      repo: args.repo,
      state: args.state,
      per_page: args.per_page,
    });
    return res.data.map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      is_pull_request: i.pull_request !== undefined,
      url: i.html_url,
    }));
  });
}
