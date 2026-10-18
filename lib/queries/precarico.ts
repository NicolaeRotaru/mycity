import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { logger } from '@/lib/logger';
import { domandaCategorie, domandaNegozio, type ClientDiLettura } from '@/lib/queries/catalogo';
import { domandaVendutoDa } from '@/lib/queries/venduto-da';
import { leggiSchedaPerIlGuscio } from '@/lib/queries/scheda-con-venduto-da';

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
export function precaricaProdotto(id: string): Promise<DehydratedState> {
  return precarica(async (supa, qc) => {
    const voci = await leggiSchedaPerIlGuscio(supa, id).catch(() => []);
    for (const voce of voci) qc.setQueryData(voce.queryKey, voce.data);
  });
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
export function precaricaNegozio(id: string): Promise<DehydratedState> {
  // 15/10/2026 (R55) — anche «Venduto da», che la vetrina mostra in fondo: letto
  // qui, l'avviso sulla migrazione 126 finisce nei registri del server.
  return precarica((supa, qc) => insieme(qc, [domandaNegozio(supa, id), domandaVendutoDa(supa, id)]));
}
