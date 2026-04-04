export default function SkeletonCard() {
  return (
    <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:shadow-none p-5 space-y-3 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-5 w-20 rounded-full bg-[#EEEEEE] dark:bg-white/10" />
        <div className="h-4 w-10 rounded bg-[#EEEEEE] dark:bg-white/10" />
      </div>
      <div className="h-4 w-3/4 rounded bg-[#EEEEEE] dark:bg-white/10" />
      <div className="h-3 w-1/2 rounded bg-[#EEEEEE] dark:bg-white/10" />
      <div className="grid grid-cols-3 gap-2">
        <div className="h-10 rounded-xl bg-[#F5F5F3] dark:bg-white/5" />
        <div className="h-10 rounded-xl bg-[#F5F5F3] dark:bg-white/5" />
        <div className="h-10 rounded-xl bg-[#F5F5F3] dark:bg-white/5" />
      </div>
      <div className="flex gap-2">
        <div className="flex-1 h-10 rounded-xl bg-[#F5F5F3] dark:bg-white/5" />
        <div className="flex-1 h-10 rounded-xl bg-[#F5F5F3] dark:bg-white/5" />
        <div className="flex-1 h-10 rounded-xl bg-[#F5F5F3] dark:bg-white/5" />
      </div>
    </div>
  );
}
