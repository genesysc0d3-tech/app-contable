export default function EscritorioLoading() {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="max-w-[1500px] mx-auto px-6 h-14 flex items-center border-b border-[var(--border)]">
        <div className="animate-shimmer h-4 w-44 rounded" />
      </div>
      <div className="max-w-[1500px] mx-auto px-6 pt-4 pb-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 xl:col-span-3 animate-shimmer h-96 rounded-[20px]" />
          <div className="lg:col-span-8 xl:col-span-9 animate-shimmer h-[40rem] rounded-[20px]" />
        </div>
      </div>
    </div>
  );
}
