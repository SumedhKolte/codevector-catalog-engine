// Opaque cursor encode/decode.
//
// A cursor encodes the (created_at, id) of the LAST row on a page. We keep the
// full-precision created_at string (see db.js) plus the bigint id, base64url it
// so it's URL-safe and opaque to clients (they should treat it as a token, not
// parse it).

export function encodeCursor(createdAt, id) {
  // created_at is a raw Postgres timestamp string; it never contains a '|'.
  const raw = `${createdAt}|${id}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

export function decodeCursor(cursor) {
  let raw;
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new InvalidCursorError();
  }

  // Use lastIndexOf so a timestamp containing characters is handled robustly.
  const sep = raw.lastIndexOf('|');
  if (sep === -1) throw new InvalidCursorError();

  const createdAt = raw.slice(0, sep);
  const id = raw.slice(sep + 1);

  if (!createdAt || !/^\d+$/.test(id)) throw new InvalidCursorError();

  return { createdAt, id };
}

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid cursor');
    this.name = 'InvalidCursorError';
    this.statusCode = 400;
  }
}
