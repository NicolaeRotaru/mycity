import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { logger } from '@/lib/logger';
import { domandaCategorie, domandaNegozio, domandaProdotto, type ClientDiLettura } from '@/lib/queries/catalogo';

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

async function precarica(
  domande: (supa: ClientDiLettura) => Array<{ queryKey: readonly unknown[]; queryFn: () => Promise<unknown> }>,
): Promise<DehydratedState> {
  const vuoto = dehydrate(new QueryClient());
  const supa = await clienteDiLettura();
  if (!supa) return vuoto;

  const qc = new QueryClient();
  try {
    // `allSettled`: una domanda che va storta non porta giu' le altre, e il
    // browser rifara' solo quella.
    await Promise.allSettled(domande(supa).map((d) => qc.prefetchQuery(d)));
    return dehydrate(qc);
  } catch (e) {
    logger.warn('[precarico] non riuscito: la pagina si riempie dal browser', e);
    return vuoto;
  }
}

/** I dati sopra la piega della home: oggi le categorie. */
export function precaricaHome(): Promise<DehydratedState> {
  return precarica((supa) => [domandaCategorie(supa)]);
}

/** La scheda del prodotto: nome, prezzo, foto e negozio, dentro l'HTML. */
export function precaricaProdotto(id: string): Promise<DehydratedState> {
  return precarica((supa) => [domandaProdotto(supa, id)]);
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
  return precarica((supa) => [domandaNegozio(supa, id)]);
}
