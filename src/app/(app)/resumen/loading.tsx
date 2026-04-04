export default function ResumenLoading() {
  return (
    <div className="flex-1 pb-24">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4 animate-pulse">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 w-36 rounded-lg bg-[var(--border)]" />
            <div className="h-4 w-28 rounded bg-[var(--border)] mt-2" />
          </div>
          <div className="h-10 w-32 rounded-xl bg-[var(--border)]" />
        </div>

        {/* Month selector */}
        <div className="flex gap-2">
          <div className="flex-1 h-10 rounded-xl bg-[var(--border)]" />
          <div className="w-24 h-10 rounded-xl bg-[var(--border)]" />
        </div>

        {/* Summary cards 2x2 */}
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none border border-[var(--border)] px-3 py-3 space-y-1.5">
              <div className="h-3 w-16 rounded bg-[var(--border)]" />
              <div className="h-5 w-24 rounded bg-[var(--border)]" />
            </div>
          ))}
        </div>

        {/* Result card */}
        <div className="rounded-xl bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none border border-[var(--border)] px-3 py-3 text-center space-y-1.5">
          <div className="h-3 w-28 rounded bg-[var(--border)] mx-auto" />
          <div className="h-5 w-20 rounded bg-[var(--border)] mx-auto" />
        </div>

        {/* Bar chart */}
        <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none border border-[var(--border)] p-4">
          <div className="h-3 w-24 rounded bg-[var(--border)] mb-3" />
          <div className="flex items-end gap-2 h-32">
            {[40, 65, 50, 80, 55, 70].map((h, i) => (
              <div key={i} className="flex-1 flex gap-0.5 items-end" style={{ height: "100px" }}>
                <div className="flex-1 bg-[var(--border)] rounded-t" style={{ height: `${h}%` }} />
                <div className="flex-1 bg-[var(--border)] rounded-t" style={{ height: `${h * 0.6}%` }} />
              </div>
            ))}
          </div>
        </div>

        {/* F29 section */}
        <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none border border-[var(--border)] px-4 py-3">
          <div className="h-4 w-40 rounded bg-[var(--border)]" />
        </div>
      </div>
    </div>
  );
}
