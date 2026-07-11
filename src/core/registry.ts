import crypto from 'crypto';
import CircuitBreaker from 'opossum';
import { createAuthenticatedClient, OctokitClient } from './auth.js';
import { ToolRequest, ToolRequestSchema, ToolName } from './schemas.js';
import { StreamMessage, StreamEmitter } from './protocol.js';
import { logger } from './logger.js';
import { listRepos, getRepo } from '../tools/repo.js';
import { createBranch } from '../tools/branch.js';
import { getFileContent, commitFiles } from '../tools/files.js';
import { getDiff } from '../tools/diff.js';
import { createPullRequest } from '../tools/pr.js';
import { searchCode } from '../tools/search.js';
import { listIssues } from '../tools/issues.js';

export class ToolValidationError extends Error {
  readonly code = 'VALIDATION_FAILED';
  constructor(message: string) {
    super(message);
    this.name = 'ToolValidationError';
  }
}

export interface BridgeConfig {
  token: string;
  /** Per-request circuit breaker timeout. Default: 120s. */
  requestTimeoutMs?: number;
  /** Enable octokit request throttling/pacing. Default: true. */
  throttle?: boolean;
}

export type OnStream = (msg: StreamMessage) => void;

/**
 * Single dispatch path for all GitHub tools. Every request — programmatic or
 * CLI — is validated against the zod schema before touching the network, and
 * every stream frame echoes the caller's request ID.
 */
export class AgentBridge {
  private octokit: OctokitClient;
  private breaker: CircuitBreaker<[request: ToolRequest, onStream?: OnStream], unknown>;

  constructor(config: BridgeConfig) {
    this.octokit = createAuthenticatedClient(config.token, { throttling: config.throttle });

    this.breaker = new CircuitBreaker(
      (request: ToolRequest, onStream?: OnStream) => this.dispatch(request, onStream),
      {
        timeout: config.requestTimeoutMs ?? 120_000,
        errorThresholdPercentage: 50,
        resetTimeout: 30_000,
      },
    );

    this.breaker.on('open', () => logger.error('Circuit breaker opened'));
    this.breaker.on('halfOpen', () => logger.info('Circuit breaker half-open'));
    this.breaker.on('close', () => logger.info('Circuit breaker closed'));
  }

  /**
   * Validate and execute a tool call. `id` (optional) is echoed on every
   * streamed frame so callers can correlate responses.
   */
  async execute(tool: ToolName, args: unknown, onStream?: OnStream, id?: string): Promise<unknown> {
    const requestId = id ?? crypto.randomUUID();
    const parsed = ToolRequestSchema.safeParse({ id: requestId, tool, args: args ?? {} });

    if (!parsed.success) {
      const error = new ToolValidationError(
        `Invalid arguments for ${tool}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
      onStream?.({ id: requestId, type: 'error', error: error.message, code: error.code });
      throw error;
    }

    return this.executeRequest(parsed.data, onStream);
  }

  /** Execute an already-validated request (used by the CLI stream loop). */
  async executeRequest(request: ToolRequest, onStream?: OnStream): Promise<unknown> {
    try {
      return await this.breaker.fire(request, onStream);
    } catch (err) {
      throw this.mapBreakerError(err, request, onStream);
    }
  }

  private mapBreakerError(err: unknown, request: ToolRequest, onStream?: OnStream): Error {
    const e = err as Error & { code?: string; status?: number };
    // Octokit RequestErrors expose a deprecated `code` getter; only opossum's
    // own errors (which have no `status`) carry the breaker codes.
    if (typeof e.status === 'number') return e;
    if (e.code === 'EOPENBREAKER') {
      const mapped = new Error('GitHub API circuit breaker is open (too many recent failures); retry later');
      onStream?.({ id: request.id, type: 'error', error: mapped.message, code: 'CIRCUIT_OPEN' });
      return mapped;
    }
    if (e.code === 'ETIMEDOUT') {
      const mapped = new Error(`Tool ${request.tool} timed out`);
      onStream?.({ id: request.id, type: 'error', error: mapped.message, code: 'TIMEOUT' });
      return mapped;
    }
    return e;
  }

  private async dispatch(request: ToolRequest, onStream?: OnStream): Promise<unknown> {
    const emit: StreamEmitter = (msg) => {
      onStream?.({ id: request.id, ...msg });
    };

    try {
      emit({ type: 'log', level: 'info', msg: `Executing tool: ${request.tool}` });

      let result: unknown;
      switch (request.tool) {
        case 'list_repos':
          result = await listRepos(this.octokit, request.args);
          break;
        case 'get_repo':
          result = await getRepo(this.octokit, request.args);
          break;
        case 'get_file_content':
          result = await getFileContent(this.octokit, request.args, emit);
          break;
        case 'get_diff':
          result = await getDiff(this.octokit, request.args, emit);
          break;
        case 'create_branch':
          result = await createBranch(this.octokit, request.args);
          break;
        case 'commit_files':
          result = await commitFiles(this.octokit, request.args);
          break;
        case 'create_pr':
          result = await createPullRequest(this.octokit, request.args);
          break;
        case 'search_code':
          result = await searchCode(this.octokit, request.args, emit);
          break;
        case 'list_issues':
          result = await listIssues(this.octokit, request.args, emit);
          break;
      }

      emit({ type: 'result', data: result });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, tool: request.tool }, 'Tool execution failed');
      emit({ type: 'error', error: message });
      throw err;
    }
  }
}
