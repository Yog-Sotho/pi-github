import { InstanceType } from '@octokit/rest';
import { RetryOctokit } from '../core/auth';
import { executeWithRetry } from '../core/auth';

export async function listRepos(octokit: InstanceType<typeof RetryOctokit>): Promise<any[]> {
  return executeWithRetry(async () => {
    const repos = await octokit.repos.listForAuthenticatedUser({ per_page: 100, visibility: 'all' });
    return repos.data.map(r => ({
      full_name: r.full_name,
      private: r.private,
      default_branch: r.default_branch,
      url: r.html_url
    }));
  });
}

export async function getRepo(octokit: InstanceType<typeof RetryOctokit>, owner: string, repo: string): Promise<any> {
  return executeWithRetry(async () => {
    const res = await octokit.repos.get({ owner, repo });
    return {
      full_name: res.data.full_name,
      private: res.data.private,
      default_branch: res.data.default_branch,
      clone_url: res.data.clone_url,
      ssh_url: res.data.ssh_url
    };
  });
}