#!/usr/bin/env node
import { Command } from 'commander';
import { ToolRequestSchema } from './core/schemas.js';
import { AgentBridge } from './core/registry.js';
import { NDJSONStreamParser, formatNDJSON, StreamMessage } from './core/protocol.js';
import { logger } from './core/logger.js';

const program = new Command();

program
  .name('pi-github')
  .description('Military-grade GitHub integration protocol for AI agents')
  .version('2.0.0');

program
  .command('stream')
  .description('Execute tools via NDJSON streaming protocol')
  .action(async () => {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      process.stderr.write(formatNDJSON({ id: 'sys', type: 'error', error: 'GITHUB_TOKEN is required' }));
      process.exit(1);
    }

    const bridge = new AgentBridge({ token, telemetry: true, strictSandbox: true });
    const parser = new NDJSONStreamParser();

    process.stdin.pipe(parser);

    parser.on('data', async (rawReq: any) => {
      const parsed = ToolRequestSchema.safeParse(rawReq);
      if (!parsed.success) {
        process.stdout.write(formatNDJSON({ 
          id: rawReq.id || 'unknown', 
          type: 'error', 
          error: `Validation failed: ${parsed.error.message}` 
        }));
        return;
      }

      const req = parsed.data;
      
      try {
        await bridge.execute(req.tool, req.args, (msg: StreamMessage) => {
          process.stdout.write(formatNDJSON(msg));
        });
      } catch (err: any) {
        process.stdout.write(formatNDJSON({ 
          id: req.id, 
          type: 'error', 
          error: err.message 
        }));
      }
    });

    parser.on('error', (err) => {
      logger.error({ err }, 'Stream parsing error');
      process.stdout.write(formatNDJSON({ id: 'sys', type: 'error', error: 'Stream parsing failed' }));
    });
  });

program.parse(process.argv);