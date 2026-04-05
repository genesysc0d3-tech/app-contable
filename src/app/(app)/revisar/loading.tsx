import SkeletonCard from "@/components/SkeletonCard";

export default function RevisarLoading() {
  return (
    <div className="flex-1 pb-24">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4 animate-shimmer">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 w-32 rounded-lg bg-[var(--border)]" />
            <div className="h-4 w-48 rounded bg-[var(--border)] mt-2" />
          </div>
          <div className="h-10 w-32 rounded-xl bg-[var(--border)]" />
        </div>

        {/* Document groups */}
        {[1, 2].map((i) => (
          <div key={i} className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none overflow-hidden">
            {/* Document header */}
            <div className="px-4 py-3.5 flex items-center gap-3 border-b border-[var(--border)]">
              <div className="w-4 h-4 rounded bg-[var(--border)]" />
              <div className="w-5 h-5 rounded bg-[var(--border)]" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-2/3 rounded bg-[var(--border)]" />
                <div className="h-3 w-24 rounded bg-[var(--border)]" />
              </div>
              <div className="h-5 w-8 rounded-full bg-[var(--border)]" />
            </div>
            {/* Skeleton propuestas inside first group */}
            {i === 1 && (
              <div className="p-3 space-y-3">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
