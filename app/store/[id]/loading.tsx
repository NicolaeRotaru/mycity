export default function StoreLoading() {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 animate-pulse">
      <div className="h-48 bg-cream-200 rounded-2xl mb-6" />
      <div className="h-8 bg-cream-200 rounded w-1/3 mb-4" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-square bg-cream-200 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
