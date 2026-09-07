/**
 * Loading skeleton per la scheda prodotto. Mantiene la layout grid 2 colonne
 * per evitare CLS quando il prodotto reale arriva.
 *
 * 6/9/2026 — Mancavano due cose. La prima: nessun `role="status"`, quindi chi
 * apre la scheda con un lettore di schermo non sentiva niente finché la pagina
 * non era pronta. La seconda: l'attesa era disegnata con `animate-pulse`,
 * mentre il resto del sito usa la classe `.skeleton` di globals.css — in una
 * navigazione sola si vedevano due attese con due animazioni diverse.
 */
export default function ProductLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Caricamento in corso"
      className="container mx-auto px-4 sm:px-6 py-8"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8" aria-hidden>
        <div className="skeleton aspect-square rounded-2xl" />
        <div className="space-y-4">
          <div className="skeleton h-7 rounded w-3/4" />
          <div className="skeleton h-4 rounded w-1/2" />
          <div className="skeleton h-10 rounded w-1/3 mt-6" />
          <div className="skeleton h-24 rounded" />
          <div className="skeleton h-12 rounded mt-4" />
        </div>
      </div>
    </div>
  );
}
