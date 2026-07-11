import { OctokitClient, withRetry } from '../core/auth.js';
import type { ToolArgs } from '../core/schemas.js';

export interface BranchResult {
  created: boolean;
  branch: string;
  source: string;
  sha: string;
}

export async function createBranch(
  octokit: OctokitClient,
  args: ToolArgs<'create_branch'>,
): Promise<BranchResult> {
  const { owner, repo, branch, source } = args;
  return withRetry(async () => {
    const ref = await octokit.git.getRef({ owner, repo, ref: `heads/${source}` });
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: ref.data.object.sha,
    });
    return { created: true, branch, source, sha: ref.data.object.sha };
  });
}
