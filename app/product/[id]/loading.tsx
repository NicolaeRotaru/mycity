/**
 * Loading skeleton per la scheda prodotto. Mantiene la layout grid 2 colonne
 * per evitare CLS quando il prodotto reale arriva.
 */
export default function ProductLoading() {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-pulse">
        <div className="bg-cream-200 aspect-square rounded-2xl" />
        <div className="space-y-4">
          <div className="h-7 bg-cream-200 rounded w-3/4" />
          <div className="h-4 bg-cream-100 rounded w-1/2" />
          <div className="h-10 bg-cream-200 rounded w-1/3 mt-6" />
          <div className="h-24 bg-cream-100 rounded" />
          <div className="h-12 bg-cream-300 rounded mt-4" />
        </div>
      </div>
    </div>
  );
}
