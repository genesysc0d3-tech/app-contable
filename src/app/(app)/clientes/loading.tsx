export default function ClientesLoading() {
  return (
    <div className="flex-1 pb-24">
      <div className="max-w-lg mx-auto px-4 space-y-4">
        <div className="pt-6 pb-3 flex items-center justify-between">
          <div>
            <div className="animate-shimmer h-7 w-28 rounded" />
            <div className="animate-shimmer h-4 w-40 rounded mt-2" />
          </div>
          <div className="animate-shimmer h-10 w-10 rounded-full" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl bg-white dark:bg-white/5 border border-[var(--border)] px-3 py-3">
              <div className="animate-shimmer w-9 h-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="animate-shimmer h-4 w-2/3 rounded" />
                <div className="animate-shimmer h-3 w-1/3 rounded" />
              </div>
              <div className="animate-shimmer h-5 w-12 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
