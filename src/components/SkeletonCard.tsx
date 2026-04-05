function Bone({ className }: { className: string }) {
  return <div className={`animate-shimmer rounded ${className}`} />;
}

export default function SkeletonCard() {
  return (
    <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none p-5 space-y-3">
      <div className="flex items-center justify-between">
        <Bone className="h-5 w-20 rounded-full" />
        <Bone className="h-4 w-10" />
      </div>
      <Bone className="h-4 w-3/4" />
      <Bone className="h-3 w-1/2" />
      <div className="grid grid-cols-3 gap-2">
        <Bone className="h-10 rounded-xl" />
        <Bone className="h-10 rounded-xl" />
        <Bone className="h-10 rounded-xl" />
      </div>
      <div className="flex gap-2">
        <Bone className="flex-1 h-10 rounded-xl" />
        <Bone className="flex-1 h-10 rounded-xl" />
        <Bone className="flex-1 h-10 rounded-xl" />
      </div>
    </div>
  );
}
