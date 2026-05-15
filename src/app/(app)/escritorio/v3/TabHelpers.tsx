import type { ReactNode } from "react";

export function TabCard({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ background: "#1c1c1e", borderRadius: 16, border: "1px solid #38383a", padding: 16 }}>
      {title && (
        <div className="flex items-center justify-between mb-3">
          <h3 style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{title}</h3>
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
