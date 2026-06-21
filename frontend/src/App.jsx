import { useState } from 'react';
import LiveFeed from './components/LiveFeed.jsx';
import BenchmarkReport from './components/BenchmarkReport.jsx';

const TABS = [
  { id: 'feed', label: 'Live Feed' },
  { id: 'benchmark', label: 'Benchmark' },
];

export default function App() {
  const [tab, setTab] = useState('feed');

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-900">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-10 sm:py-14">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Product Catalog
            </h1>
            <p className="mt-2 max-w-2xl text-neutral-400">
              Browsing 200k+ products, newest first — with stable keyset pagination
              that never duplicates or skips a row, even while data is changing.
            </p>
          </div>

          <nav className="flex gap-1 rounded-full border border-neutral-800 bg-neutral-900/50 p-1 self-start">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-full px-5 py-2 text-sm font-medium transition ${
                  tab === t.id ? 'bg-white text-neutral-900' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10">
        {tab === 'feed' ? <LiveFeed /> : <BenchmarkReport />}
      </main>

      <footer className="border-t border-neutral-900 py-8 text-center text-xs text-neutral-600">
        Fastify · PostgreSQL · React — keyset pagination demo
      </footer>
    </div>
  );
}
