export default function ResumenLoading() {
  return (
    <div className="flex-1 pb-24">
      <div className="max-w-lg mx-auto px-4 space-y-4">
        <div className="pt-6 pb-3">
          <div className="animate-shimmer h-7 w-32 rounded" />
          <div className="animate-shimmer h-4 w-48 rounded mt-2" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="animate-shimmer h-16 rounded-xl" />
          <div className="animate-shimmer h-16 rounded-xl" />
          <div className="animate-shimmer h-16 rounded-xl" />
        </div>
        <div className="animate-shimmer h-48 rounded-[20px]" />
        <div className="animate-shimmer h-40 rounded-[20px]" />
      </div>
    </div>
  );
}
