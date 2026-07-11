import { OctokitClient, withRetry } from '../core/auth.js';
import type { ToolArgs } from '../core/schemas.js';
import { StreamEmitter, emitChunked } from '../core/protocol.js';

export async function getDiff(
  octokit: OctokitClient,
  args: ToolArgs<'get_diff'>,
  emit: StreamEmitter,
): Promise<Record<string, unknown>> {
  const { owner, repo, base, head } = args;
  emit({ type: 'log', level: 'debug', msg: `Generating diff ${base}...${head}` });

  return withRetry(async () => {
    const res = await octokit.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${base}...${head}`,
      mediaType: { format: 'diff' },
    });
    const patch = res.data as unknown as string;
    return { base, head, ...emitChunked(emit, 'patch', patch) };
  });
}
