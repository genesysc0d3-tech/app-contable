import SkeletonCard from "@/components/SkeletonCard";

export default function RevisarLoading() {
  return (
    <div className="flex-1 pb-24">
      <div className="max-w-lg mx-auto px-4 space-y-4">
        <div className="pt-6 pb-3">
          <div className="animate-shimmer h-7 w-28 rounded" />
          <div className="animate-shimmer h-4 w-44 rounded mt-2" />
        </div>
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}
