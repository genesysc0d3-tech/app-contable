export default function SubirLoading() {
  return (
    <div className="flex-1 pb-24">
      <div className="max-w-lg mx-auto px-4 space-y-4">
        <div className="pt-6 pb-3">
          <div className="animate-shimmer h-7 w-24 rounded" />
          <div className="animate-shimmer h-4 w-52 rounded mt-2" />
        </div>
        <div className="animate-shimmer h-36 rounded-[20px]" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-shimmer h-14 rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
