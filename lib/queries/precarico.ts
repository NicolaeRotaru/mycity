import * as React from 'react';
import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { logger } from '@/lib/logger';
import { domandaCategorie, domandaNegozio, type ClientDiLettura } from '@/lib/queries/catalogo';
import { domandaVendutoDa } from '@/lib/queries/venduto-da';
import { domandaRiepilogoRecensioni, type ClientConFunzioni } from '@/lib/queries/riepilogo-recensioni-negozio';
import { leggiSchedaPerIlGuscio } from '@/lib/queries/scheda-con-venduto-da';
import { queryKeys } from '@/lib/queries/keys';
import { domandaCategoriePiene } from '@/lib/queries/categorie-piene';

/**
 * IL PRECARICO: i dati che partono DENTRO la pagina, invece di essere chiesti
 * dopo dal browser.
 *
 * 30/8/2026 (R068) — La home e la scheda prodotto arrivavano vuote nell'HTML.
 * Ogni sezione era un componente del browser con la sua lettura: il telefono
 * scaricava il codice, lo eseguiva, e solo allora cominciava a chiedere i dati.
 * Sulla scheda prodotto voleva dire che nome, prezzo e foto comparivano dopo
 * due viaggi di rete in fila, e la foto solo dopo il secondo.
 *
 * Qui si legge sul server e si consegna lo stato gia' pieno. Il componente del
 * browser non cambia di una riga: fa la sua stessa domanda, la trova gia'
 * risposta e non va in rete.
 *
 * ── PERCHE' NON FALLISCE MAI ────────────────────────────────────────────────
 * Un precarico e' un'ottimizzazione, non un requisito. Se la lettura sul server
 * va storta — variabili mancanti, database lento — si consegna uno stato vuoto
 * e il browser fa quello che faceva prima. Una pagina che non si apre perche'
 * il precarico non e' riuscito sarebbe molto peggio del problema che risolve.
 */

/** Il cliente di lettura del server: pubblico, senza sessione. Non lancia in pagina. */
async function clienteDiLettura(): Promise<ClientDiLettura | null> {
  try {
    const { creaClientAnonimo } = await import('@/lib/supabase/anonimo');
    return creaClientAnonimo() as unknown as ClientDiLettura;
  } catch (e) {
    logger.warn('[precarico] client di lettura non disponibile: la pagina si riempie dal browser', e);
    return null;
  }
}

type Domanda = { queryKey: readonly unknown[]; queryFn: () => Promise<unknown>; staleTime?: number };

/**
 * 22/11/2026 — UN PRECARICO PER RICHIESTA, NON UNO PER CHI LO CHIEDE.
 *
 * Sulla scheda prodotto e sulla vetrina, `generateMetadata` e il guscio leggevano ognuno la sua
 * copia della stessa riga: i metadati con `leggiPerMetadati`, il guscio col precarico. Il collaudo
 * ha contato, in una richiesta, `products` due volte e `seller_public_profiles` due volte sulla
 * scheda, tre volte sulla vetrina. Adesso i metadati e il guscio prendono i loro campi dalla
 * risposta del precarico, e il precarico si fa una volta per richiesta: `cache()` di React, che
 * c'è nei componenti del server (Next usa lì il suo React, il 19) e vale per una richiesta sola.
 * Dove `cache` non c'è (il React 18 del progetto, nelle prove) si legge e basta, come prima.
 */
type Memorizzatore = <F extends (...argomenti: never[]) => unknown>(f: F) => F;
const cacheDiReact = (React as unknown as { cache?: Memorizzatore }).cache;
const perRichiesta: Memorizzatore = (f) => (typeof cacheDiReact === 'function' ? cacheDiReact(f) : f);

async function precarica(
  lavoro: (supa: ClientDiLettura, qc: QueryClient) => Promise<unknown>,
): Promise<DehydratedState> {
  const vuoto = dehydrate(new QueryClient());
  const supa = await clienteDiLettura();
  if (!supa) return vuoto;

  const qc = new QueryClient();
  try {
    await lavoro(supa, qc);
    return dehydrate(qc);
  } catch (e) {
    logger.warn('[precarico] non riuscito: la pagina si riempie dal browser', e);
    return vuoto;
  }
}

/**
 * Le domande partono insieme. `allSettled`: una domanda che va storta non porta
 * giu' le altre, e il browser rifara' solo quella.
 */
function insieme(qc: QueryClient, domande: Domanda[]) {
  return Promise.allSettled(domande.map((d) => qc.prefetchQuery(d)));
}

/** I dati sopra la piega della home: oggi le categorie. */
export function precaricaHome(): Promise<DehydratedState> {
  return precarica((supa, qc) => insieme(qc, [domandaCategorie(supa)]));
}

/** Le categorie che menu, piede e vetrina leggono su OGNI pagina: l'elenco intero e quelle piene. Va consegnato SOPRA il menu (app/layout.tsx): CategoryBar crea queste domande appena si disegna, e una HydrationBoundary che arriva dopo le riempie solo nel browser, non nell'HTML. */
export function precaricaSito(): Promise<DehydratedState> {
  return precarica((supa, qc) =>
    insieme(qc, [
      {
        queryKey: ['categories', 'tree'],
        staleTime: 10 * 60_000,
        queryFn: async () => {
          const { data, error } = await supa.from('categories').select('id, slug, name, parent_id, icon').order('name');
          if (error) throw error;
          return data ?? [];
        },
      },
      domandaCategoriePiene(supa),
    ]),
  );
}

/**
 * La scheda del prodotto: nome, prezzo, foto e negozio, dentro l'HTML. E il
 * riquadro «Venduto da» del suo negozio.
 *
 * 15/10/2026 (R55) — «Venduto da» si leggeva solo nel browser: quando la vista
 * dei negozi non aveva le colonne della migrazione 126, l'avviso restava nella
 * console del telefono del cliente, dove nessuno lo legge. Letto qui, l'avviso
 * esce dal server e finisce nei registri. Si chiede solo per un negozio che la
 * vetrina mostra: per gli altri la pagina dice «non disponibile» e il riquadro
 * non c'e'.
 *
 * 16/10/2026 — Il negozio della scheda e «Venduto da» arrivano dalla STESSA
 * domanda alla vista (`leggiSchedaPerIlGuscio`): due viaggi in fila invece di
 * quattro. Una lettura che va storta qui non scrive niente, come faceva
 * `prefetchQuery`: il browser rifara' la domanda. Il guasto vero della vista lo
 * scrive gia' chi legge la vista.
 */
export const precaricaProdotto = perRichiesta((id: string): Promise<DehydratedState> =>
  precarica(async (supa, qc) => {
    const [voci, sconto] = await Promise.all([
      leggiSchedaPerIlGuscio(supa, id).catch(() => []),
      leggiScontoAttivo(supa, id).catch(() => null),
    ]);
    for (const voce of voci) qc.setQueryData(voce.queryKey, voce.data);
    // R10-009 — Solo con la scheda in mano (un prodotto che l'estraneo non vede si rilegge tutto
    // nel browser) e solo con una lettura riuscita: uno zero di ripiego non è «nessuno sconto».
    if (voci.length > 0 && sconto !== null) qc.setQueryData(queryKeys.products.activeDiscount(id), sconto);
  }),
);

/**
 * R10-009 — Lo sconto attivo del prodotto: la scheda (prezzo grande) e ActivePromoBadge lo chiedono
 * con questa chiave e questa lettura (`product_active_discount`, `Number(data) || 0`). Il precarico
 * non lo riempiva, e il browser lo rileggeva a ogni apertura, col prezzo pieno nell'HTML. Parte
 * insieme alla scheda: nessun viaggio in più in fila.
 */
async function leggiScontoAttivo(supa: ClientDiLettura, id: string): Promise<number> {
  const { data, error } = await (supa as ClientDiLettura & ClientConFunzioni).rpc('product_active_discount', { p_product: id });
  if (error) throw error;
  return Number(data) || 0;
}

/**
 * 22/11/2026 — La domanda della vetrina è quella del browser (`domandaNegozio`: stessa chiave,
 * stesso ripiego della 124), con UNA colonna in più: `role`. Così il guscio e i metadati del
 * negozio prendono dalla stessa riga anche la condizione della 404 («venditore, approvato, con
 * un'insegna») invece di rileggerla. Nel browser arriva un campo in più, `role`, che la vetrina
 * non usa.
 */
function domandaVetrina(supa: ClientDiLettura, id: string) {
  const conIlRuolo: ClientDiLettura = {
    from: (tabella: string) => {
      const q = supa.from(tabella);
      return { select: (colonne: string) => q.select(`${colonne}, role`) };
    },
  };
  return domandaNegozio(conIlRuolo, id);
}

/**
 * La vetrina del negozio: nome, orari, copertina e personalizzazione, dentro
 * l'HTML.
 *
 * 3/9/2026 — senza questa riga la pagina del negozio partiva vuota e chiedeva
 * tutto al browser: prima lo scheletro del server, poi l'attesa del browser,
 * poi il negozio. Tre impaginazioni in fila. Con il precarico la seconda non
 * c'e' piu', perche' quando il codice della pagina parte la risposta e' gia' in
 * mano.
 */
export const precaricaNegozio = perRichiesta((id: string): Promise<DehydratedState> =>
  // 15/10/2026 (R55) — anche «Venduto da», che la vetrina mostra in fondo: letto
  // qui, l'avviso sulla migrazione 126 finisce nei registri del server.
  // 12/11/2026 (R07-021) — e le stelle del negozio: senza, lo schema per Google usciva dal
  // server senza `aggregateRating` e il browser lo riscriveva con, due script diversi.
  precarica((supa, qc) =>
    insieme(qc, [
      domandaVetrina(supa, id),
      domandaVendutoDa(supa, id),
      domandaRiepilogoRecensioni(supa as unknown as ClientConFunzioni, id),
    ]),
  ),
);
