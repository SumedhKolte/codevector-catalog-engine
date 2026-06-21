// Applies schema.sql to the configured database. Idempotent.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool, closePool } from '../src/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = await readFile(join(__dirname, 'schema.sql'), 'utf8');
  console.log('Applying schema...');
  await pool.query(sql);
  console.log('✔ Schema applied.');
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(closePool);
