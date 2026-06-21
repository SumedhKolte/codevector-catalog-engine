export default function ProductCard({ product }) {
  return (
    <div className="group rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 transition hover:border-neutral-700 hover:bg-neutral-900">
      <div className="flex items-start justify-between gap-3">
        <span className="rounded-full bg-neutral-800 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-neutral-400">
          {product.category}
        </span>
        <span className="text-xs text-neutral-600">#{product.id}</span>
      </div>
      <h3 className="mt-3 text-base font-medium leading-snug text-neutral-100">
        {product.name}
      </h3>
      <div className="mt-4 flex items-end justify-between">
        <span className="text-2xl font-semibold tracking-tight">
          ${product.price.toFixed(2)}
        </span>
        <time className="text-xs text-neutral-500">
          {new Date(product.created_at).toLocaleDateString()}
        </time>
      </div>
    </div>
  );
}
