import { useEffect, useRef, useState } from 'react';
import { fetchProducts, fetchCategories, simulateInserts } from '../api.js';
import ProductCard from './ProductCard.jsx';
import { Sparkline } from './Charts.jsx';

const PAGE_SIZE = 24;

export default function LiveFeed() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState('');
  const [pageInfo, setPageInfo] = useState({});
  const [pageNum, setPageNum] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastDbMs, setLastDbMs] = useState(null);
  const [latencyHistory, setLatencyHistory] = useState([]);
  const [toast, setToast] = useState(null);
  const [simulating, setSimulating] = useState(false);

  // Track ids seen while moving FORWARD to prove keyset never duplicates.
  // (Going back to a previous page legitimately revisits rows, so we only
  //  check on Next.)
  const forwardSeen = useRef(new Set());
  const [dupes, setDupes] = useState(0);

  // Synchronous re-entrancy guard. `disabled={loading}` only takes effect after
  // a re-render, so very fast clicking can fire several requests before the
  // buttons visually disable. This ref blocks them immediately.
  const inFlight = useRef(false);

  async function load({ cursor = null, before = null, direction = 'reset' } = {}) {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchProducts({ limit: PAGE_SIZE, category: category || null, cursor, before });

      if (direction === 'reset') {
        forwardSeen.current = new Set();
        setDupes(0);
      }
      if (direction === 'reset' || direction === 'next') {
        let d = 0;
        for (const p of res.data) {
          if (forwardSeen.current.has(p.id)) d++;
          else forwardSeen.current.add(p.id);
        }
        if (d) setDupes((x) => x + d);
      }

      setProducts(res.data);
      setPageInfo(res.pageInfo);

      const dbMs = res.meta?.dbMs ?? null;
      setLastDbMs(dbMs);
      if (dbMs != null) setLatencyHistory((h) => [...h, dbMs].slice(-30));
    } catch (e) {
      setError(e.message);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  function goFirst() {
    setPageNum(1);
    load({ direction: 'reset' });
  }
  function goNext() {
    if (!pageInfo.hasNextPage) return;
    setPageNum((n) => n + 1);
    load({ cursor: pageInfo.nextCursor, direction: 'next' });
  }
  function goPrev() {
    if (!pageInfo.hasPrevPage) return;
    setPageNum((n) => Math.max(1, n - 1));
    load({ before: pageInfo.prevCursor, direction: 'prev' });
  }

  useEffect(() => {
    fetchCategories().then((r) => setCategories(r.data)).catch(() => {});
  }, []);

  // Reset to page 1 whenever the category changes.
  useEffect(() => {
    goFirst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  async function handleSimulate() {
    if (simulating) return;
    setSimulating(true);
    try {
      const r = await simulateInserts(50);
      setToast(
        `Inserted ${r.inserted} products at the front of the feed. They won't disrupt the page you're on — navigate Prev/Next and nothing duplicates or skips.`
      );
      setTimeout(() => setToast(null), 5000);
    } catch (e) {
      setToast(`Simulate failed: ${e.message}`);
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm outline-none focus:border-neutral-600"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <button
          onClick={handleSimulate}
          disabled={simulating}
          className="rounded-xl bg-emerald-500/90 px-4 py-2.5 text-sm font-medium text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {simulating ? 'Inserting…' : '⚡ Simulate Traffic (+50)'}
        </button>

        <div className="ml-auto flex items-center gap-4 text-sm text-neutral-400">
          <span>
            Forward-unique <b className={dupes ? 'text-red-400' : 'text-emerald-400'}>{forwardSeen.current.size}</b>
          </span>
          <span>
            Dupes <b className={dupes ? 'text-red-400' : 'text-emerald-400'}>{dupes}</b>
          </span>
          {lastDbMs != null && <span>DB <b className="text-neutral-200">{lastDbMs}ms</b></span>}
          {latencyHistory.length > 1 && (
            <span title="Per-request DB time (last 30)">
              <Sparkline values={latencyHistory} />
            </span>
          )}
        </div>
      </div>

      {toast && (
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {toast}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Grid (one page, replaced on navigation) */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>

      {/* Prev / page / Next */}
      <div className="mt-8 flex items-center justify-center gap-4">
        <button
          onClick={goPrev}
          disabled={loading || !pageInfo.hasPrevPage}
          className="rounded-full border border-neutral-700 px-6 py-2.5 text-sm font-medium transition hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-30"
        >
          ← Previous
        </button>
        <span className="min-w-[5rem] text-center text-sm text-neutral-400">
          Page <b className="text-neutral-100">{pageNum}</b>
        </span>
        <button
          onClick={goNext}
          disabled={loading || !pageInfo.hasNextPage}
          className="rounded-full border border-neutral-700 px-6 py-2.5 text-sm font-medium transition hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {loading ? 'Loading…' : 'Next →'}
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-neutral-600">
        Cursor pagination gives Prev/Next (stable under writes), not jump-to-page — by design.
      </p>
    </div>
  );
}
