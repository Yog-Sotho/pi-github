import { OctokitClient, withRetry } from '../core/auth.js';
import type { ToolArgs } from '../core/schemas.js';

export interface RepoSummary {
  full_name: string;
  private: boolean;
  default_branch: string;
  url: string;
}

export async function listRepos(
  octokit: OctokitClient,
  args: ToolArgs<'list_repos'>,
): Promise<RepoSummary[]> {
  return withRetry(async () => {
    const res = await octokit.repos.listForAuthenticatedUser({
      visibility: args.visibility ?? 'all',
      per_page: args.per_page,
    });
    return res.data.map((r) => ({
      full_name: r.full_name,
      private: r.private,
      default_branch: r.default_branch,
      url: r.html_url,
    }));
  });
}

export interface RepoDetails extends Omit<RepoSummary, 'url'> {
  clone_url: string;
  ssh_url: string;
  description: string | null;
}

export async function getRepo(
  octokit: OctokitClient,
  args: ToolArgs<'get_repo'>,
): Promise<RepoDetails> {
  return withRetry(async () => {
    const res = await octokit.repos.get({ owner: args.owner, repo: args.repo });
    return {
      full_name: res.data.full_name,
      private: res.data.private,
      default_branch: res.data.default_branch,
      clone_url: res.data.clone_url,
      ssh_url: res.data.ssh_url,
      description: res.data.description,
    };
  });
}
