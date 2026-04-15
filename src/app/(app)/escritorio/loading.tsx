export default function EscritorioLoading() {
  return (
    <div className="min-h-screen">
      <div className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="animate-shimmer h-8 w-48 rounded" />
        <div className="animate-shimmer h-4 w-64 rounded mt-2" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-8">
          <div className="lg:col-span-5 space-y-6">
            <div className="animate-shimmer h-56 rounded-[20px]" />
            <div className="animate-shimmer h-80 rounded-[20px]" />
          </div>
          <div className="lg:col-span-7 space-y-6">
            <div className="animate-shimmer h-96 rounded-[20px]" />
            <div className="animate-shimmer h-64 rounded-[20px]" />
          </div>
        </div>
      </div>
    </div>
  );
}
