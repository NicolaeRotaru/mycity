import { SkeletonGrid } from '@/components/SkeletonCard';
import { ALTEZZA_COPERTINA, CONTENITORE_PAGINA_NEGOZIO } from './misure-vetrina';

/**
 * L'UNICA COSA CHE SI VEDE MENTRE IL NEGOZIO ARRIVA.
 *
 * Prima ce n'erano due, e diverse fra loro: il guscio del server disegnava una
 * banda e otto quadrati, poi il codice del browser buttava via tutto e metteva
 * un cerchietto che gira in mezzo a una pagina alta poche righe. Adesso ne
 * esiste una sola, e ha la forma di quello che sta arrivando: stesso
 * contenitore, copertina della stessa altezza, la griglia dei prodotti presa
 * dallo stesso posto della griglia vera.
 *
 * Non ha `'use client'` apposta: la usa il guscio del server durante il primo
 * viaggio e la usa la pagina nel browser se i dati non sono ancora arrivati.
 * Non ha stato, non ha eventi, non ha testo da tradurre.
 */
export default function ScheletroNegozio() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={`${CONTENITORE_PAGINA_NEGOZIO} animate-pulse`}
    >
      {/* Briciole di pane */}
      <div className="h-4 w-56 max-w-full rounded bg-cream-200" />

      {/* Menu del negozio */}
      <div className="flex gap-1.5">
        <div className="h-7 w-24 rounded-full bg-cream-200" />
        <div className="h-7 w-20 rounded-full bg-cream-100" />
        <div className="h-7 w-28 rounded-full bg-cream-100" />
      </div>

      {/* La copertina: stessa cornice e stessa altezza di quella vera */}
      <div className="overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-warm">
        <div className="h-1.5 bg-cream-200" />
        <div className={`${ALTEZZA_COPERTINA} w-full bg-cream-200`} />
        <div className="space-y-2.5 px-6 py-5">
          <div className="h-4 w-2/3 rounded bg-cream-200" />
          <div className="h-3 w-1/2 rounded bg-cream-100" />
        </div>
      </div>

      {/* I prodotti del negozio */}
      <div className="h-6 w-48 max-w-full rounded bg-cream-200" />
      <SkeletonGrid count={8} />
    </div>
  );
}
