import { InstanceType } from '@octokit/rest';
import { RetryOctokit } from './auth';
import { ToolRequest } from './schemas';
import * as repoTools from '../tools/repo';
import * as branchTools from '../tools/branch';
import * as fileTools from '../tools/files';
import * as prTools from '../tools/pr';
import { GitOperations } from './git';

export async function executeTool(octokit: InstanceType<typeof RetryOctokit>, request: ToolRequest, cwd: string): Promise<any> {
  const gitOps = new GitOperations(cwd);
  await gitOps.init();

  switch (request.tool) {
    case 'list_repos': {
      return await repoTools.listRepos(octokit);
    }
    case 'get_repo': {
      return await repoTools.getRepo(octokit, request.args.owner, request.args.repo);
    }
    case 'create_branch': {
      const { owner, repo, branch, source } = request.args;
      await gitOps.checkout(branch, true);
      return await branchTools.createBranch(octokit, owner, repo, branch.name, source);
    }
    case 'commit': {
      const { owner, repo, message, files } = request.args;
      const sha = await fileTools.commitFiles(octokit, owner, repo, message, files, 'HEAD');
      return { committed: true, sha, files: files.length };
    }
    case 'create_pr': {
      const { owner, repo, title, body, base, head, draft } = request.args;
      return await prTools.createPullRequest(octokit, owner, repo, title, base, head, body, draft);
    }
    default:
      throw new Error(`Unknown tool: ${request.tool}`);
  }
}