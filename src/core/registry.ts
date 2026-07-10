import { Octokit } from '@octokit/rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import CircuitBreaker from 'opossum';
import { ToolRequest } from './schemas.js';
import { StreamMessage } from './protocol.js';
import { logger } from './logger.js';
import { SecuritySandbox } from './security.js';

const RetryOctokit = Octokit.plugin(retry, throttling);

export class AgentBridge {
  private octokit: InstanceType<typeof RetryOctokit>;
  private breaker: CircuitBreaker;

  constructor(private config: { token: string; telemetry?: boolean; strictSandbox?: boolean }) {
    this.octokit = new RetryOctokit({
      auth: config.token,
      throttle: {
        onRateLimit: (retryAfter, options) => {
          logger.warn({ retryAfter, url: options.url }, 'Rate limit hit, retrying');
          return true;
        },
        onSecondaryRateLimit: (retryAfter, options) => {
          logger.warn({ retryAfter, url: options.url }, 'Secondary rate limit hit, retrying');
          return true;
        },
      },
    });

    this.breaker = new CircuitBreaker(this.executeInternal.bind(this), {
      timeout: 30000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
    });

    this.breaker.on('open', () => logger.error('Circuit breaker opened'));
    this.breaker.on('halfOpen', () => logger.info('Circuit breaker half-open'));
    this.breaker.on('close', () => logger.info('Circuit breaker closed'));
  }

  async execute(
    tool: ToolRequest['tool'], 
    args: any, 
    onStream?: (msg: StreamMessage) => void
  ): Promise<any> {
    const id = args.id || crypto.randomUUID();
    const request = { id, tool, args } as ToolRequest;
    
    return this.breaker.fire(request, onStream);
  }

  private async executeInternal(request: ToolRequest, onStream?: (msg: StreamMessage) => void): Promise<any> {
    const emit = (msg: Omit<StreamMessage, 'id'>) => {
      if (onStream) onStream({ id: request.id, ...msg });
    };

    try {
      emit({ type: 'log', level: 'info', msg: `Executing tool: ${request.tool}` });
      
      let result: any;
      switch (request.tool) {
        case 'list_repos':
          result = await this.listRepos(request.args);
          break;
        case 'get_repo':
          result = await this.getRepo(request.args);
          break;
        case 'get_file_content':
          result = await this.getFileContent(request.args, emit);
          break;
        case 'get_diff':
          result = await this.getDiff(request.args, emit);
          break;
        case 'create_branch':
          result = await this.createBranch(request.args);
          break;
        case 'commit_files':
          result = await this.commitFiles(request.args);
          break;
        case 'create_pr':
          result = await this.createPR(request.args);
          break;
        case 'search_code':
          result = await this.searchCode(request.args, emit);
          break;
        case 'list_issues':
          result = await this.listIssues(request.args, emit);
          break;
        default:
          throw new Error(`Unknown tool: ${request.tool}`);
      }

      emit({ type: 'result', data: result });
      return result;
    } catch (err: any) {
      logger.error({ err, tool: request.tool }, 'Tool execution failed');
      emit({ type: 'error', error: err.message });
      throw err;
    }
  }

  private async listRepos(args: any): Promise<any[]> {
    const res = await this.octokit.repos.listForAuthenticatedUser({ 
      visibility: args.visibility || 'all', 
      per_page: 100 
    });
    return res.data.map(r => ({ full_name: r.full_name, private: r.private, default_branch: r.default_branch }));
  }

  private async getRepo(args: any): Promise<any> {
    const res = await this.octokit.repos.get(args);
    return { full_name: res.data.full_name, private: res.data.private, default_branch: res.data.default_branch };
  }

  private async getFileContent(args: any, emit: (msg: Omit<StreamMessage, 'id'>) => void): Promise<any> {
    emit({ type: 'log', level: 'debug', msg: `Fetching ${args.path}@${args.ref}` });
    const res = await this.octokit.repos.getContent(args);
    const data = res.data as any;
    
    if (data.type !== 'file') throw new Error('Path is not a file');
    
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return { path: data.path, size: data.size, content, sha: data.sha };
  }

  private async getDiff(args: any, emit: (msg: Omit<StreamMessage, 'id'>) => void): Promise<any> {
    emit({ type: 'log', level: 'debug', msg: `Generating diff ${args.base}...${args.head}` });
    const res = await this.octokit.repos.compareCommitsWithBasehead({
      ...args,
      basehead: `${args.base}...${args.head}`,
      mediaType: { format: 'diff' }
    });
    return { patch: res.data as unknown as string };
  }

  private async createBranch(args: any): Promise<any> {
    const ref = await this.octokit.git.getRef({ ...args, ref: `heads/${args.source}` });
    await this.octokit.git.createRef({ ...args, ref: `refs/heads/${args.branch}`, sha: ref.data.object.sha });
    return { created: true, branch: args.branch, sha: ref.data.object.sha };
  }

  private async commitFiles(args: any): Promise<any> {
    const { owner, repo, message, branch, files } = args;
    const branchRes = await this.octokit.repos.getBranch({ owner, repo, branch });
    const latestSha = branchRes.data.commit.sha;

    const treeItems = files.map((f: any) => ({
      path: f.path,
      mode: '100644' as const,
      type: 'blob' as const,
      content: f.content,
    }));

    const treeRes = await this.octokit.git.createTree({ owner, repo, tree: treeItems, base_tree: latestSha });
    const commitRes = await this.octokit.git.createCommit({ owner, repo, message, tree: treeRes.data.sha, parents: [latestSha] });
    await this.octokit.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commitRes.data.sha });

    return { sha: commitRes.data.sha, files: files.length };
  }

  private async createPR(args: any): Promise<any> {
    const res = await this.octokit.pulls.create(args);
    return { url: res.data.html_url, number: res.data.number, state: res.data.state };
  }

  private async searchCode(args: any, emit: (msg: Omit<StreamMessage, 'id'>) => void): Promise<any[]> {
    emit({ type: 'log', level: 'debug', msg: `Searching code: ${args.query}` });
    const res = await this.octokit.search.code({ q: args.query, per_page: 50 });
    return res.data.items.map(i => ({ repository: i.repository.full_name, path: i.path, url: i.html_url }));
  }

  private async listIssues(args: any, emit: (msg: Omit<StreamMessage, 'id'>) => void): Promise<any[]> {
    emit({ type: 'log', level: 'debug', msg: `Listing issues (${args.state})` });
    const res = await this.octokit.issues.listForRepo({ ...args, owner: args.owner, repo: args.repo });
    return res.data.map(i => ({ number: i.number, title: i.title, state: i.state, url: i.html_url }));
  }
}