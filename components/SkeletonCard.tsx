import { classiGriglia, PROPORZIONE_FOTO, type ColonneMassime } from '@/lib/griglia-prodotti';

/**
 * Lo scheletro tiene il posto della scheda vera. Per tenerlo davvero deve avere la SUA forma: la
 * proporzione della foto e le colonne della griglia arrivano dallo stesso posto da cui le prende la
 * griglia vera, così non possono più divergere.
 */
const SkeletonCard = () => (
  <div className="bg-white border border-cream-300 rounded-2xl overflow-hidden animate-pulse">
    <div className={`w-full ${PROPORZIONE_FOTO} bg-cream-200 rounded-t-2xl`} />
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

export const SkeletonGrid = ({ count = 8, maxColumns }: { count?: number; maxColumns?: ColonneMassime }) => (
  // `maxColumns` è lo stesso che riceve la griglia vera: senza, lo scheletro si fermava a quattro
  // colonne e la griglia ne apriva sei, e la pagina si riorganizzava tutta al caricamento.
  <div className={classiGriglia(maxColumns)}>
    {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
  </div>
);

export default SkeletonCard;
