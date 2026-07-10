import { InstanceType } from '@octokit/rest';
import { RetryOctokit, executeWithRetry } from '../core/auth';

export async function commitFiles(
  octokit: InstanceType<typeof RetryOctokit>,
  owner: string,
  repo: string,
  message: string,
  files: Array<{ path: string; content?: string; sha?: string }>,
  branch: string
): Promise<string> {
  return executeWithRetry(async () => {
    const repoRes = await octokit.repos.get({ owner, repo });
    const latestCommitSha = repoRes.data.default_branch === branch 
      ? repoRes.data.head.sha 
      : (await octokit.repos.getBranch({ owner, repo, branch })).data.commit.sha;

    const treeItems = files.map(f => ({
      path: f.path,
      mode: '100644' as const,
      type: 'blob' as const,
      content: f.content,
      ...(f.sha && { sha: f.sha })
    }));

    const treeRes = await octokit.git.createTree({
      owner,
      repo,
      tree: treeItems as any,
      base_tree: latestCommitSha
    });

    const commitRes = await octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: treeRes.data.sha,
      parents: [latestCommitSha]
    });

    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commitRes.data.sha
    });

    return commitRes.data.sha;
  });
}