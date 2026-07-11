import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../src/core/auth.js';

const fastRetry = { retries: 3, minTimeoutMs: 1, maxTimeoutMs: 2 };

describe('withRetry', () => {
  it('returns the result on first success', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    await expect(withRetry(fn, fastRetry)).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('server error'), { status: 500 }))
      .mockRejectedValueOnce(new Error('network hiccup'))
      .mockResolvedValue('ok');
    await expect(withRetry(fn, fastRetry)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('aborts immediately on non-retryable statuses', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    await expect(withRetry(fn, fastRetry)).rejects.toThrow('Not Found');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error('flaky'), { status: 502 }));
    await expect(withRetry(fn, { ...fastRetry, retries: 2 })).rejects.toThrow('flaky');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
