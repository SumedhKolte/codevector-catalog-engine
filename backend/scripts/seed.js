// ============================================================================
// Seeder: generates SEED_COUNT products and bulk-inserts them.
//
// Performance notes:
//  - We do NOT insert row-by-row in a loop (that's ~SEED_COUNT round trips and
//    is the slow approach the task warns about).
//  - Each batch is a single INSERT ... SELECT * FROM unnest($1,$2,$3,$4): one
//    network round trip and one statement parse for thousands of rows.
//  - created_at is spread across the last ~2 years so "newest first" ordering
//    is meaningful and pages contain a realistic spread of timestamps.
// ============================================================================
import { pool, closePool } from '../src/db.js';
import { config } from '../src/config.js';
import { CATEGORIES, randomProductName, randomPrice } from '../src/lib/generator.js';

const TOTAL = config.seedCount;
const BATCH = config.seedBatchSize;

const TWO_YEARS_MS = 1000 * 60 * 60 * 24 * 365 * 2;
const NOW = Date.now();

function randomCreatedAt() {
  // Random point within the last two years.
  return new Date(NOW - Math.floor(Math.random() * TWO_YEARS_MS)).toISOString();
}

async function insertBatch(size) {
  const names = new Array(size);
  const categories = new Array(size);
  const prices = new Array(size);
  const createdAts = new Array(size);

  for (let i = 0; i < size; i++) {
    names[i] = randomProductName();
    categories[i] = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
    prices[i] = randomPrice();
    createdAts[i] = randomCreatedAt();
  }

  await pool.query(
    `INSERT INTO products (name, category, price, created_at, updated_at)
     SELECT n, c, p, t, t
     FROM unnest($1::text[], $2::text[], $3::numeric[], $4::timestamptz[])
       AS u(n, c, p, t)`,
    [names, categories, prices, createdAts]
  );
}

async function main() {
  console.log(`Seeding ${TOTAL.toLocaleString()} products in batches of ${BATCH.toLocaleString()}...`);
  const start = Date.now();

  let inserted = 0;
  while (inserted < TOTAL) {
    const size = Math.min(BATCH, TOTAL - inserted);
    await insertBatch(size);
    inserted += size;
    process.stdout.write(`\r  ${inserted.toLocaleString()} / ${TOTAL.toLocaleString()}`);
  }

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✔ Done in ${secs}s (${Math.round(inserted / secs).toLocaleString()} rows/s).`);
}

main()
  .catch((err) => {
    console.error('\nSeeding failed:', err);
    process.exitCode = 1;
  })
  .finally(closePool);
