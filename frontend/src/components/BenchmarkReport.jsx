import { useState } from 'react';
import { runBenchmark, runSweep } from '../api.js';
import { LineChart } from './Charts.jsx';

const DEPTHS = [1000, 10000, 100000, 200000, 1000000, 5000000, 10000000];
const SWEEP_DEPTHS = [1000, 10000, 100000, 1000000];

export default function BenchmarkReport() {
  const [depth, setDepth] = useState(200000);
  const [single, setSingle] = useState(null);
  const [sweep, setSweep] = useState(null);
  const [loading, setLoading] = useState(null); // 'single' | 'sweep' | null
  const [error, setError] = useState(null);

  async function doSingle() {
    setLoading('single');
    setError(null);
    try {
      setSingle(await runBenchmark(depth));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  }

  async function doSweep() {
    setLoading('sweep');
    setError(null);
    try {
      setSweep(await runSweep(SWEEP_DEPTHS));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-12">
      <p className="text-neutral-400">
        Both queries fetch the <b>same 20 rows</b> at a given depth.{' '}
        <b className="text-neutral-200">dbExec</b> is Postgres' own execution time
        (no network); <b className="text-neutral-200">wallClock</b> is what the
        server measured including the round-trip to the database.
      </p>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* --- Single depth --- */}
      <section>
        <h2 className="mb-4 text-lg font-medium">Single depth</h2>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm outline-none focus:border-neutral-600"
          >
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                Depth: {d.toLocaleString()} rows deep
              </option>
            ))}
          </select>
          <button
            onClick={doSingle}
            disabled={loading === 'single'}
            className="rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-50"
          >
            {loading === 'single' ? 'Running…' : 'Run benchmark'}
          </button>
          <span className="text-xs text-neutral-600">
            Deep runs (≥1M) can take several seconds — they scan that many rows.
          </span>
        </div>

        {single && !single.error && (
          <div className="mt-8 space-y-8">
            <BarGroup title="Postgres execution time (dbExec)" data={single.dbExec} />
            <BarGroup title="Wall clock incl. network (wallClock)" data={single.wallClock} />
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 text-center">
              <div className="text-sm uppercase tracking-wider text-neutral-500">
                Keyset is (by dbExec)
              </div>
              <div className="mt-1 text-4xl font-semibold text-emerald-400">
                {single.speedup ? `${single.speedup}× faster` : '—'}
              </div>
              <div className="mt-1 text-sm text-neutral-500">
                at depth {single.depth.toLocaleString()}
              </div>
            </div>
          </div>
        )}
        {single?.error && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            {single.error}
          </div>
        )}
      </section>

      {/* --- Sweep chart --- */}
      <section>
        <h2 className="mb-1 text-lg font-medium">Latency vs depth (sweep)</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Postgres execution time across depths {SWEEP_DEPTHS.map((d) => d.toLocaleString()).join(', ')}.
          Watch OFFSET climb while keyset stays flat.
        </p>
        <button
          onClick={doSweep}
          disabled={loading === 'sweep'}
          className="rounded-xl border border-neutral-700 px-5 py-2.5 text-sm font-medium transition hover:border-neutral-500 disabled:opacity-50"
        >
          {loading === 'sweep' ? 'Running sweep…' : 'Run full sweep'}
        </button>

        {sweep && (
          <div className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
            <Legend />
            <LineChart
              xLabels={sweep.results.map((r) => formatDepth(r.depth))}
              series={[
                {
                  label: 'OFFSET',
                  color: '#f87171',
                  points: sweep.results.map((r) => ({ x: r.depth, y: r.offsetMs ?? 0 })),
                },
                {
                  label: 'Keyset',
                  color: '#34d399',
                  points: sweep.results.map((r) => ({ x: r.depth, y: r.keysetMs ?? 0 })),
                },
              ]}
            />
            <SweepTable results={sweep.results} />
          </div>
        )}
      </section>
    </div>
  );
}

function BarGroup({ title, data }) {
  const max = Math.max(data.offsetMs, data.keysetMs, 0.001);
  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-neutral-300">{title}</h3>
      <div className="space-y-4">
        <Bar label="OFFSET" ms={data.offsetMs} max={max} color="bg-red-500/70" />
        <Bar label="Keyset (cursor)" ms={data.keysetMs} max={max} color="bg-emerald-500/80" />
      </div>
    </div>
  );
}

function Bar({ label, ms, max, color }) {
  const pct = Math.max((ms / max) * 100, 2);
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="text-neutral-300">{label}</span>
        <span className="font-mono text-neutral-400">{ms} ms</span>
      </div>
      <div className="h-4 overflow-hidden rounded-full bg-neutral-800">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="mb-4 flex gap-6 text-sm">
      <span className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f87171]" /> OFFSET
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#34d399]" /> Keyset
      </span>
    </div>
  );
}

function SweepTable({ results }) {
  return (
    <table className="mt-6 w-full text-sm">
      <thead>
        <tr className="text-left text-neutral-500">
          <th className="py-2 font-medium">Depth</th>
          <th className="py-2 font-medium">OFFSET (ms)</th>
          <th className="py-2 font-medium">Keyset (ms)</th>
          <th className="py-2 font-medium">Speedup</th>
        </tr>
      </thead>
      <tbody>
        {results.map((r) => (
          <tr key={r.depth} className="border-t border-neutral-800">
            <td className="py-2 text-neutral-300">{r.depth.toLocaleString()}</td>
            <td className="py-2 font-mono text-red-300">{r.skipped ? '—' : r.offsetMs}</td>
            <td className="py-2 font-mono text-emerald-300">{r.skipped ? '—' : r.keysetMs}</td>
            <td className="py-2 font-mono text-neutral-400">
              {r.skipped || !r.keysetMs ? '—' : `${(r.offsetMs / r.keysetMs).toFixed(1)}×`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatDepth(d) {
  if (d >= 1_000_000) return `${d / 1_000_000}M`;
  if (d >= 1_000) return `${d / 1_000}k`;
  return String(d);
}
