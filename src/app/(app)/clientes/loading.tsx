export default function ClientesLoading() {
  return (
    <div className="flex-1 pb-24">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4 animate-pulse">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 w-32 rounded-lg bg-[var(--border)]" />
            <div className="h-4 w-20 rounded bg-[var(--border)] mt-2" />
          </div>
          <div className="h-10 w-28 rounded-xl bg-[var(--border)]" />
        </div>

        {/* Search bar */}
        <div className="h-10 rounded-xl bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none" />

        {/* Client list */}
        <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none divide-y divide-[var(--border)]">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="px-4 py-3 flex items-start gap-3">
              {/* Avatar */}
              <div className="w-9 h-9 rounded-full bg-[var(--border)] shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-32 rounded bg-[var(--border)]" />
                  <div className="h-4 w-12 rounded-full bg-[var(--border)]" />
                </div>
                <div className="h-3 w-48 rounded bg-[var(--border)]" />
              </div>
              <div className="flex gap-1.5 shrink-0">
                <div className="w-7 h-7 rounded-lg bg-[var(--border)]" />
                <div className="w-7 h-7 rounded-lg bg-[var(--border)]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
