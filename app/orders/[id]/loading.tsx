export default function OrderLoading() {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl animate-pulse">
      <div className="h-7 bg-cream-200 rounded w-1/2 mb-3" />
      <div className="h-5 bg-cream-100 rounded w-1/3 mb-8" />
      <div className="space-y-3 mb-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 bg-cream-100 rounded-lg" />
        ))}
      </div>
      <div className="h-40 bg-cream-100 rounded-2xl" />
    </div>
  );
}
