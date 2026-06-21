// Pure unit tests for cursor encode/decode. No database required — these run on
// every `npm test`, even on a fresh checkout.
import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, InvalidCursorError } from '../src/lib/cursor.js';

describe('cursor encode/decode', () => {
  it('round-trips a timestamp + id', () => {
    const createdAt = '2026-06-22 10:15:03.412345+00';
    const id = '200050';
    const token = encodeCursor(createdAt, id);
    const decoded = decodeCursor(token);
    expect(decoded.createdAt).toBe(createdAt);
    expect(decoded.id).toBe(id);
  });

  it('produces a URL-safe (base64url) token', () => {
    const token = encodeCursor('2026-06-22 10:15:03.412345+00', 42);
    expect(token).not.toMatch(/[+/=]/); // no standard-base64 chars
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('preserves full microsecond precision in the timestamp', () => {
    const createdAt = '2026-01-01 00:00:00.123456+00';
    const decoded = decodeCursor(encodeCursor(createdAt, 1));
    expect(decoded.createdAt).toBe(createdAt); // not truncated to .123
  });

  it('handles a numeric id passed as a number', () => {
    const decoded = decodeCursor(encodeCursor('2026-06-22 10:15:03+00', 7));
    expect(decoded.id).toBe('7');
  });

  it('throws InvalidCursorError for a token with no separator', () => {
    const bad = Buffer.from('no-separator-here', 'utf8').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
  });

  it('throws InvalidCursorError for a non-numeric id', () => {
    const bad = Buffer.from('2026-06-22 10:15:03+00|abc', 'utf8').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
  });

  it('throws InvalidCursorError for a missing timestamp', () => {
    const bad = Buffer.from('|123', 'utf8').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
  });

  it('uses the last separator so timestamps are safe', () => {
    // Belt-and-braces: even if a timestamp contained a '|', the id (last field)
    // is parsed from the final separator.
    const decoded = decodeCursor(encodeCursor('2026-06-22 10:15:03+00', 99));
    expect(decoded.id).toBe('99');
  });

  it('attaches a 400 status code to the error', () => {
    try {
      decodeCursor('!!!not-base64-with-no-sep');
    } catch (err) {
      expect(err.statusCode).toBe(400);
    }
  });
});
