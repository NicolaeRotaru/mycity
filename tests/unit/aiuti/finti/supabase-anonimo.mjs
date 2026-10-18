/**
 * Il client di lettura del server, in finto solo se la prova lo chiede.
 *
 * 15/10/2026 (R3, R55) — Per eseguire un guscio del server (la scheda prodotto, la pagina del
 * negozio, le anteprime) contro un database che applica le regole di chi guarda, la prova mette il
 * suo client in `globalThis.__CLIENT_ANONIMO__`. Se non lo mette, si usa quello vero: le prove che
 * fingono la rete con `fetch` continuano a funzionare come prima.
 */
import { creaClientAnonimo as vero } from '@/lib/supabase/anonimo';

export function creaClientAnonimo(opzioni) {
  const finto = globalThis.__CLIENT_ANONIMO__;
  return finto ?? vero(opzioni);
}
