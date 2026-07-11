import { Transform, TransformCallback } from 'stream';
import { StringDecoder } from 'string_decoder';

export interface StreamMessage {
  id: string;
  type: 'log' | 'chunk' | 'result' | 'error';
  level?: 'info' | 'warn' | 'error' | 'debug';
  msg?: string;
  /** Sequence number for `chunk` frames (0-based). */
  seq?: number;
  data?: unknown;
  error?: string;
  code?: string;
}

export interface ParseError {
  error: string;
  line: string;
}

/** Default cap on a single NDJSON line: 10 MiB. */
export const DEFAULT_MAX_LINE_BYTES = 10 * 1024 * 1024;

/**
 * Transforms a byte stream into parsed NDJSON objects (object mode).
 *
 * - Uses StringDecoder so multibyte UTF-8 characters split across chunks
 *   are decoded correctly.
 * - Enforces a maximum line length so an unterminated line cannot grow the
 *   internal buffer without bound.
 * - Malformed lines emit a `parse-error` event (not `error`, which would
 *   destroy the stream) so the consumer can report and continue.
 */
export class NDJSONStreamParser extends Transform {
  private buffer = '';
  private decoder = new StringDecoder('utf8');

  constructor(private readonly maxLineBytes: number = DEFAULT_MAX_LINE_BYTES) {
    super({ readableObjectMode: true, writableObjectMode: false });
  }

  private parseLine(line: string): void {
    if (!line.trim()) return;
    try {
      this.push(JSON.parse(line));
    } catch (err) {
      const parseError: ParseError = {
        error: err instanceof Error ? err.message : String(err),
        line: line.slice(0, 200),
      };
      this.emit('parse-error', parseError);
    }
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.buffer += this.decoder.write(chunk);

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      this.parseLine(line);
    }

    if (this.buffer.length > this.maxLineBytes) {
      this.emit('parse-error', {
        error: `Line exceeds maximum length of ${this.maxLineBytes} bytes`,
        line: this.buffer.slice(0, 200),
      } satisfies ParseError);
      this.buffer = '';
    }

    callback();
  }

  _flush(callback: TransformCallback): void {
    this.buffer += this.decoder.end();
    this.parseLine(this.buffer);
    this.buffer = '';
    callback();
  }
}

export function formatNDJSON(msg: StreamMessage): string {
  return JSON.stringify(msg) + '\n';
}

/** Emitter passed to tool implementations; the request ID is filled in upstream. */
export type StreamEmitter = (msg: Omit<StreamMessage, 'id'>) => void;

/** Payloads larger than this are streamed as `chunk` frames. */
export const CHUNK_SIZE = 256 * 1024;

/**
 * Deliver a large text payload. Small payloads are returned inline under
 * `field`; larger ones are emitted as sequential `chunk` frames and the
 * returned metadata describes the reassembly (`chunked`, `chunks`, `bytes`).
 */
export function emitChunked(
  emit: StreamEmitter,
  field: string,
  text: string,
  chunkSize: number = CHUNK_SIZE,
): Record<string, unknown> {
  if (text.length <= chunkSize) {
    return { [field]: text };
  }
  let seq = 0;
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    emit({ type: 'chunk', seq, data: text.slice(offset, offset + chunkSize) });
    seq++;
  }
  return { chunked: true, field, chunks: seq, bytes: Buffer.byteLength(text) };
}
