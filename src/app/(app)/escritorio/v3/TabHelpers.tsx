import type { ReactNode } from "react";

export function TabCard({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-white dark:bg-white/[0.04] rounded-xl border border-[var(--border)] p-4 space-y-3">
      {title && (
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-[var(--foreground)]">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, desc, action }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string; desc: string; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
      <div className="w-10 h-10 rounded-xl bg-[var(--surface)] flex items-center justify-center">
        <Icon size={20} className="text-[var(--muted)]" />
      </div>
      <p className="text-sm font-medium text-[var(--foreground)]">{title}</p>
      <p className="text-xs text-[var(--muted-light)] max-w-xs">{desc}</p>
      {action}
    </div>
  );
}

export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 rounded-lg bg-[var(--surface)]" />
      ))}
    </div>
  );
}
