const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

async function json(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${res.status})`);
  }
  return res.json();
}

export function fetchProducts({ limit = 20, category = null, cursor = null, before = null } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (category) params.set('category', category);
  if (cursor) params.set('cursor', cursor); // forward (older)
  if (before) params.set('before', before); // backward (newer)
  return json(`/api/products?${params.toString()}`);
}

export function fetchCategories() {
  return json('/api/categories');
}

export function simulateInserts(count = 50) {
  return json(`/api/simulate-inserts?count=${count}`, { method: 'POST' });
}

export function runBenchmark(depth = 200000) {
  return json(`/api/benchmark?depth=${depth}`);
}

export function runSweep(depths) {
  const q = depths && depths.length ? `?depths=${depths.join(',')}` : '';
  return json(`/api/benchmark/sweep${q}`);
}
