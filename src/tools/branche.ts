import { InstanceType } from '@octokit/rest';
import { RetryOctokit, executeWithRetry } from '../core/auth';

export async function createBranch(
  octokit: InstanceType<typeof RetryOctokit>,
  owner: string,
  repo: string,
  branch: string,
  source = 'main'
): Promise<any> {
  return executeWithRetry(async () => {
    const ref = await octokit.git.getRef({ owner, repo, ref: `heads/${source}` });
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: ref.data.object.sha
    });
    return { created: true, branch, source, sha: ref.data.object.sha };
  });
}