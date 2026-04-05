export default function SubirLoading() {
  return (
    <div className="flex-1 pb-24">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6 animate-shimmer">
        {/* Header */}
        <div>
          <div className="h-8 w-56 rounded-lg bg-[var(--border)]" />
          <div className="h-4 w-40 rounded bg-[var(--border)] mt-2" />
        </div>

        {/* Drop zone placeholder */}
        <div className="hidden md:block rounded-[20px] border-2 border-dashed border-[var(--border)] py-20" />

        {/* 2x2 button grid */}
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-[16px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none h-[72px]" />
          ))}
        </div>

        {/* Historial header */}
        <div className="h-5 w-24 rounded bg-[var(--border)]" />

        {/* Document list */}
        <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none divide-y divide-[var(--border)]">
          {[1, 2, 3].map((i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-3">
              <div className="w-6 h-6 rounded bg-[var(--border)]" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-3/4 rounded bg-[var(--border)]" />
                <div className="h-3 w-16 rounded bg-[var(--border)]" />
              </div>
              <div className="h-5 w-14 rounded-full bg-[var(--border)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
