/**
 * 6/9/2026 — Stessa storia della scheda prodotto: mancava `role="status"` (chi
 * non vede lo schermo apriva un ordine e non sentiva nulla) e l'attesa era
 * disegnata con `animate-pulse` invece della classe `.skeleton` usata dal resto
 * del sito.
 */
export default function OrderLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Caricamento in corso"
      className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl"
    >
      <div aria-hidden>
        <div className="skeleton h-7 rounded w-1/2 mb-3" />
        <div className="skeleton h-5 rounded w-1/3 mb-8" />
        <div className="space-y-3 mb-8">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-12 rounded-lg" />
          ))}
        </div>
        <div className="skeleton h-40 rounded-2xl" />
      </div>
    </div>
  );
}
