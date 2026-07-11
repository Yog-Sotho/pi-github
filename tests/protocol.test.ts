import { describe, it, expect } from 'vitest';
import { NDJSONStreamParser, emitChunked, formatNDJSON, ParseError, StreamMessage } from '../src/core/protocol.js';

function collect(parser: NDJSONStreamParser): { objects: unknown[]; parseErrors: ParseError[] } {
  const objects: unknown[] = [];
  const parseErrors: ParseError[] = [];
  parser.on('data', (obj) => objects.push(obj));
  parser.on('parse-error', (err: ParseError) => parseErrors.push(err));
  return { objects, parseErrors };
}

describe('NDJSONStreamParser', () => {
  it('parses multiple lines in one chunk', () => {
    const parser = new NDJSONStreamParser();
    const { objects } = collect(parser);
    parser.write(Buffer.from('{"a":1}\n{"b":2}\n'));
    parser.end();
    expect(objects).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('reassembles a line split across chunks', () => {
    const parser = new NDJSONStreamParser();
    const { objects } = collect(parser);
    parser.write(Buffer.from('{"tool":"get'));
    parser.write(Buffer.from('_repo"}\n'));
    parser.end();
    expect(objects).toEqual([{ tool: 'get_repo' }]);
  });

  it('decodes multibyte UTF-8 characters split across chunk boundaries', () => {
    const parser = new NDJSONStreamParser();
    const { objects } = collect(parser);
    const encoded = Buffer.from('{"msg":"héllo→世界"}\n');
    // Split in the middle of a multibyte sequence.
    const splitAt = encoded.indexOf(Buffer.from('世')) + 1;
    parser.write(encoded.subarray(0, splitAt));
    parser.write(encoded.subarray(splitAt));
    parser.end();
    expect(objects).toEqual([{ msg: 'héllo→世界' }]);
  });

  it('parses the final unterminated line on flush', () => {
    const parser = new NDJSONStreamParser();
    const { objects } = collect(parser);
    parser.write(Buffer.from('{"last":true}'));
    parser.end();
    expect(objects).toEqual([{ last: true }]);
  });

  it('emits parse-error for malformed lines and keeps going', () => {
    const parser = new NDJSONStreamParser();
    const { objects, parseErrors } = collect(parser);
    parser.write(Buffer.from('not json\n{"ok":1}\n'));
    parser.end();
    expect(parseErrors).toHaveLength(1);
    expect(objects).toEqual([{ ok: 1 }]);
  });

  it('rejects lines exceeding the max length instead of buffering forever', () => {
    const parser = new NDJSONStreamParser(1024);
    const { parseErrors } = collect(parser);
    parser.write(Buffer.from('x'.repeat(4096)));
    parser.end();
    expect(parseErrors.length).toBeGreaterThan(0);
    expect(parseErrors[0].error).toContain('maximum length');
  });

  it('skips blank lines', () => {
    const parser = new NDJSONStreamParser();
    const { objects, parseErrors } = collect(parser);
    parser.write(Buffer.from('\n  \n{"a":1}\n\n'));
    parser.end();
    expect(objects).toEqual([{ a: 1 }]);
    expect(parseErrors).toHaveLength(0);
  });
});

describe('formatNDJSON', () => {
  it('produces a single newline-terminated JSON line', () => {
    const line = formatNDJSON({ id: 'x', type: 'result', data: { ok: true } });
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({ id: 'x', type: 'result', data: { ok: true } });
  });
});

describe('emitChunked', () => {
  it('returns small payloads inline', () => {
    const frames: Omit<StreamMessage, 'id'>[] = [];
    const result = emitChunked((m) => frames.push(m), 'content', 'hello');
    expect(result).toEqual({ content: 'hello' });
    expect(frames).toHaveLength(0);
  });

  it('streams large payloads as sequential chunk frames', () => {
    const frames: Omit<StreamMessage, 'id'>[] = [];
    const text = 'a'.repeat(2500);
    const result = emitChunked((m) => frames.push(m), 'patch', text, 1000);
    expect(result).toMatchObject({ chunked: true, field: 'patch', chunks: 3, bytes: 2500 });
    expect(frames.map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(frames.map((f) => f.data).join('')).toBe(text);
  });
});
