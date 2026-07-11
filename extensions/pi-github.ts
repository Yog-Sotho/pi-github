/**
 * Pi coding agent extension for pi-github.
 *
 * Registers every tool exposed by the `pi-github` CLI as a native Pi tool,
 * discovered dynamically from `pi-github tools` (the machine-readable
 * manifest), so new tools appear in Pi without touching this file.
 *
 * Install:
 *   1. `npm install -g pi-github` (or make the binary available on PATH,
 *      or set PI_GITHUB_BIN to its location)
 *   2. `export GITHUB_TOKEN=ghp_...`
 *   3. Copy this file to `~/.pi/agent/extensions/` (global) or
 *      `.pi/extensions/` (project-local), then `/reload` in Pi.
 *
 * This file is loaded and type-resolved by Pi itself, which provides the
 * `@earendil-works/pi-coding-agent` import. It is intentionally excluded
 * from this package's own tsconfig.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { execFile } from 'node:child_process';

const CLI = process.env.PI_GITHUB_BIN ?? 'pi-github';
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

interface ManifestEntry {
  name: string;
  description: string;
  streaming: boolean;
  parameters: Record<string, unknown>;
}

function run(args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      CLI,
      args,
      { maxBuffer: MAX_OUTPUT_BYTES, env: process.env },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr.trim() || err.message));
        } else {
          resolve(stdout);
        }
      },
    );
    signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
  });
}

export default function (pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => {
    let manifest: ManifestEntry[];
    try {
      manifest = JSON.parse(await run(['tools'])) as ManifestEntry[];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.ui.notify(`pi-github: could not load tool manifest (${message}). Is the CLI on PATH?`, 'error');
      return;
    }

    if (!process.env.GITHUB_TOKEN) {
      ctx.ui.notify('pi-github: GITHUB_TOKEN is not set; GitHub tools will fail until it is.', 'warning');
    }

    for (const tool of manifest) {
      pi.registerTool({
        name: `github_${tool.name}`,
        label: `GitHub: ${tool.name.replace(/_/g, ' ')}`,
        description: tool.description,
        // The manifest's parameters are standard JSON Schema, which is what
        // TypeBox produces — Pi accepts them directly.
        parameters: tool.parameters as never,
        async execute(_toolCallId, params, signal) {
          const stdout = await run(['exec', tool.name, JSON.stringify(params ?? {})], signal);
          return {
            content: [{ type: 'text', text: stdout.trim() }],
            details: { tool: tool.name },
          };
        },
      });
    }

    ctx.ui.notify(`pi-github: registered ${manifest.length} GitHub tools`, 'info');
  });
}
