import { Transform, TransformCallback } from 'stream';
import { logger } from './logger.js';

export interface StreamMessage {
  id: string;
  type: 'log' | 'result' | 'error';
  level?: 'info' | 'warn' | 'error' | 'debug';
  msg?: string;
  data?: unknown;
  error?: string;
}

export class NDJSONStreamParser extends Transform {
  private buffer = '';

  constructor() {
    super({ objectMode: true });
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          this.push(JSON.parse(line));
        } catch (err) {
          logger.error({ err, line }, 'Failed to parse NDJSON line');
        }
      }
    }
    callback();
  }

  _flush(callback: TransformCallback): void {
    if (this.buffer.trim()) {
      try {
        this.push(JSON.parse(this.buffer));
      } catch (err) {
        logger.error({ err, line: this.buffer }, 'Failed to parse final NDJSON buffer');
      }
    }
    callback();
  }
}

export function formatNDJSON(msg: StreamMessage): string {
  return JSON.stringify(msg) + '\n';
}