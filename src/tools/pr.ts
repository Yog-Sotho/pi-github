import { OctokitClient, withRetry } from '../core/auth.js';
import type { ToolArgs } from '../core/schemas.js';

export interface PullRequestResult {
  url: string;
  number: number;
  state: string;
  draft: boolean;
}

export async function createPullRequest(
  octokit: OctokitClient,
  args: ToolArgs<'create_pr'>,
): Promise<PullRequestResult> {
  const { owner, repo, title, body, base, head, draft } = args;
  return withRetry(async () => {
    const pr = await octokit.pulls.create({ owner, repo, title, base, head, body, draft });
    return {
      url: pr.data.html_url,
      number: pr.data.number,
      state: pr.data.state,
      draft: pr.data.draft ?? false,
    };
  });
}
