import ScheletroNegozio from '@/components/store-sections/ScheletroNegozio';

/**
 * 3/9/2026 — L'ATTESA CHE COPRE ANCHE IL GUSCIO, NON SOLO LA PAGINA.
 *
 * Da oggi `app/store/[id]/layout.tsx` legge il negozio sul server prima di
 * disegnare: finché quella lettura non torna, il guscio è fermo. E un'attesa
 * scritta DENTRO il guscio non può fare da sipario al guscio stesso — la trova
 * solo chi è già entrato. Senza questo file il sipario sarebbe quello generale
 * del sito (`app/loading.tsx`), che ha la forma di una pagina qualsiasi e non
 * di un negozio: di nuovo un salto, solo spostato più in su.
 *
 * Questa cartella contiene solo il negozio (l'elenco dei negozi sta in
 * `app/stores/`), quindi qui si può mettere lo scheletro del negozio senza che
 * finisca sotto a nient'altro. È lo stesso pezzo che usa la pagina: una forma
 * sola, da qualunque porta si entri.
 */
export default function StoreRouteLoading() {
  return <ScheletroNegozio />;
}
