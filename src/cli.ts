#!/usr/bin/env node
import { Command } from 'commander';
import { ToolRequestSchema, ToolName, toolNames, toolManifest } from './core/schemas.js';
import { AgentBridge } from './core/registry.js';
import { NDJSONStreamParser, formatNDJSON, ParseError, StreamMessage } from './core/protocol.js';
import { logger } from './core/logger.js';

const program = new Command();

program
  .name('pi-github')
  .description('Streaming GitHub tool bridge for AI coding agents')
  .version('2.1.0');

function writeFrame(msg: StreamMessage): void {
  process.stdout.write(formatNDJSON(msg));
}

function requireToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    writeFrame({ id: 'sys', type: 'error', error: 'GITHUB_TOKEN is required', code: 'NO_TOKEN' });
    process.exit(1);
  }
  return token;
}

/** Coerce whatever arrived in the `id` slot into a safe string for error frames. */
function safeId(raw: unknown): string {
  if (typeof raw === 'object' && raw !== null && 'id' in raw) {
    const id = (raw as { id: unknown }).id;
    if (typeof id === 'string' && id.length > 0 && id.length <= 128) return id;
  }
  return 'unknown';
}

program
  .command('stream')
  .description('Execute tools via the NDJSON streaming protocol (requests on stdin, frames on stdout)')
  .action(async () => {
    const token = requireToken();
    const bridge = new AgentBridge({ token });
    const parser = new NDJSONStreamParser();

    // Requests are executed sequentially so frames from different requests
    // never interleave on stdout.
    let queue: Promise<void> = Promise.resolve();

    const handle = async (rawReq: unknown): Promise<void> => {
      const parsed = ToolRequestSchema.safeParse(rawReq);
      if (!parsed.success) {
        writeFrame({
          id: safeId(rawReq),
          type: 'error',
          error: `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
          code: 'VALIDATION_FAILED',
        });
        return;
      }

      try {
        await bridge.executeRequest(parsed.data, writeFrame);
      } catch (err) {
        // The failure frame was already emitted by the bridge; log for operators.
        logger.debug({ err, id: parsed.data.id }, 'Request failed');
        process.exitCode = 1;
      }
    };

    parser.on('data', (rawReq: unknown) => {
      queue = queue.then(() => handle(rawReq));
    });

    parser.on('parse-error', (info: ParseError) => {
      writeFrame({ id: 'sys', type: 'error', error: `Invalid NDJSON line: ${info.error}`, code: 'PARSE_ERROR' });
    });

    process.stdin.pipe(parser);

    await new Promise<void>((resolve) => parser.on('end', resolve));
    await queue;
  });

program
  .command('exec')
  .description('Execute a single tool call and print the result as JSON')
  .argument('<tool>', `Tool name (one of: ${toolNames.join(', ')})`)
  .argument('[args]', 'Tool arguments as a JSON object (default: {})')
  .action(async (tool: string, argsJson?: string) => {
    const token = requireToken();

    if (!toolNames.includes(tool as ToolName)) {
      writeFrame({ id: 'sys', type: 'error', error: `Unknown tool: ${tool}`, code: 'UNKNOWN_TOOL' });
      process.exit(1);
    }

    let args: unknown = {};
    if (argsJson) {
      try {
        args = JSON.parse(argsJson);
      } catch {
        writeFrame({ id: 'sys', type: 'error', error: 'Arguments must be valid JSON', code: 'PARSE_ERROR' });
        process.exit(1);
      }
    }

    const bridge = new AgentBridge({ token });
    try {
      const result = await bridge.execute(tool as ToolName, args);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeFrame({ id: 'sys', type: 'error', error: message });
      process.exit(1);
    }
  });

program
  .command('tools')
  .description('Print the machine-readable tool manifest (JSON Schema parameters)')
  .action(() => {
    process.stdout.write(JSON.stringify(toolManifest(), null, 2) + '\n');
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  logger.error({ err }, 'Fatal CLI error');
  process.exit(1);
});
