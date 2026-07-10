import { Octokit } from '@octokit/rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { pRetry, AbortError } from 'p-retry';

const RetryOctokit = Octokit.plugin(retry, throttling);

export function createAuthenticatedClient(token: string): InstanceType<typeof RetryOctokit> {
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }

  return new RetryOctokit({
    auth: token,
    retry: { enabled: true },
    throttle: {
      onRateLimit: (retryAfter, options) => {
        console.warn(`Rate limit exceeded for ${options.method} ${options.url}. Retrying in ${retryAfter}s`);
        return true;
      },
      onSecondaryRateLimit: (retryAfter, options) => {
        console.warn(`Secondary rate limit for ${options.method} ${options.url}. Retrying in ${retryAfter}s`);
        return true;
      },
    },
  });
}

export async function executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  return pRetry(fn, {
    retries: 3,
    factor: 2,
    minTimeout: 1000,
    maxTimeout: 5000,
    randomize: true,
    onFailedAttempt: (error) => {
      if (error.message.includes('Not Found') || error.message.includes('Bad credentials')) {
        throw new AbortError(error);
      }
    },
  });
}