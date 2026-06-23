const SkeletonCard = () => (
  <div className="bg-white border border-cream-300 rounded-2xl overflow-hidden animate-pulse">
    <div className="w-full h-48 bg-cream-200 rounded-t-2xl" />
    <div className="p-3 space-y-2">
      <div className="h-4 bg-cream-200 rounded w-3/4" />
      <div className="h-3 bg-cream-100 rounded w-1/2" />
      <div className="h-3 bg-cream-100 rounded w-2/3" />
      <div className="flex justify-between items-center pt-3">
        <div className="h-5 bg-cream-200 rounded w-16" />
        <div className="h-7 bg-cream-200 rounded-full w-20" />
      </div>
    </div>
  </div>
);

export const SkeletonGrid = ({ count = 8 }: { count?: number }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
    {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
  </div>
);

export default SkeletonCard;
