import { Octokit } from '@octokit/rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { logger } from './logger.js';

export const RetryOctokit = Octokit.plugin(retry, throttling);

/** Concrete instance type of the plugin-enhanced Octokit client. */
export type OctokitClient = InstanceType<typeof RetryOctokit>;

export interface ClientOptions {
  /** Disable the octokit-level retry plugin (retries are handled by withRetry). */
  pluginRetries?: boolean;
  /** Disable request throttling/pacing (useful in tests). Default: enabled. */
  throttling?: boolean;
}

export function createAuthenticatedClient(token: string, opts: ClientOptions = {}): OctokitClient {
  if (!token) {
    throw new Error('A GitHub token is required (set GITHUB_TOKEN)');
  }

  return new RetryOctokit({
    auth: token,
    retry: { enabled: opts.pluginRetries ?? false },
    throttle: {
      enabled: opts.throttling ?? true,
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        logger.warn({ retryAfter, url: options.url, retryCount }, 'Rate limit exceeded');
        return retryCount < 2;
      },
      onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
        logger.warn({ retryAfter, url: options.url, retryCount }, 'Secondary rate limit hit');
        return retryCount < 2;
      },
    },
  });
}

/** HTTP statuses where a retry cannot help. */
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 422]);

/** Error class for application-level failures that must never be retried. */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export interface RetryOptions {
  retries?: number;
  minTimeoutMs?: number;
  maxTimeoutMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute `fn` with exponential backoff and full jitter. Errors carrying a
 * non-retryable HTTP status (auth, not-found, validation) abort immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const minTimeout = opts.minTimeoutMs ?? 1000;
  const maxTimeout = opts.maxTimeoutMs ?? 5000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (err instanceof NonRetryableError) {
        throw err;
      }
      const status = (err as { status?: number }).status;
      if (status !== undefined && NON_RETRYABLE_STATUS.has(status)) {
        throw err;
      }
      if (attempt < retries) {
        const backoff = Math.min(minTimeout * 2 ** attempt, maxTimeout);
        await delay(Math.random() * backoff);
      }
    }
  }
  throw lastError;
}
