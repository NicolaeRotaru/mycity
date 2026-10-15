import { logger } from '@/lib/logger';
import { colonnaNonTrovata } from '@/lib/db/migrazione-148';
import type { SceltaContanti } from './regole-del-rimborso';
import { finaleIban } from './scelta-del-cliente';

/**
 * Come tornano i soldi a chi ha pagato in contanti: e' quello che `refundOrder`
 * riceve da chi lo chiama (R71).
 *
 *  · CREDITO: il cliente l'ha scelto lui; si accredita il portafoglio MyCity.
 *  · BONIFICO: i soldi non escono adesso, li paga a mano chi amministra. Il
 *    rimborso si registra, e chi paga riceve l'avviso con il link dove trova
 *    l'IBAN (`doveSiPaga`). `ibanFinale` sono le ultime quattro cifre, per dire
 *    al cliente su quale conto arrivera': l'IBAN intero non gira oltre il reso.
 */
export type ComeTornanoIContanti =
  | { modo: 'CREDITO' }
  | { modo: 'BONIFICO'; ibanFinale?: string | null; doveSiPaga?: string };

/** La pagina dove chi amministra trova i bonifici dei resi da fare, con l'IBAN. */
export const PAGINA_DEI_BONIFICI_DA_FARE = '/admin/rimborsi-da-bonificare';

/** Quello che si e' riusciti a leggere della scelta salvata sul reso. */
export interface SceltaSalvata {
  modo: SceltaContanti | null;
  iban: string | null;
  /** false quando la lettura non e' riuscita: la scelta vale «bonifico», mai credito. */
  letta: boolean;
}

/** Il minimo di client che serve: una lettura di una riga. */
interface LetturaDiUnaRiga {
  select(colonne: string): {
    eq(colonna: string, valore: string): {
      maybeSingle(): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
    };
  };
}

/**
 * Il client si accetta «largo» e si restringe qui dentro: il tipo completo del
 * client di Supabase, confrontato con quello stretto, manda in giro il
 * controllore dei tipi senza fine (TS2589).
 */
type ClientCheLegge = { from(tabella: string): unknown };

/**
 * Legge dal reso la scelta del cliente, con il client del server.
 *
 * Non lancia mai. Se la lettura non riesce — la migrazione 162 non ancora
 * applicata, il database che non risponde — la risposta e' «nessuna scelta», e
 * nessuna scelta vuol dire bonifico. E' il verso giusto in cui sbagliare: un
 * bonifico in piu' da fare a mano costa un quarto d'ora, un credito dato senza
 * consenso e' un rimborso non conforme.
 */
export async function leggiLaSceltaDelReso(admin: ClientCheLegge, returnId: string): Promise<SceltaSalvata> {
  try {
    const { data, error } = await (admin.from('returns') as LetturaDiUnaRiga)
      .select('refund_method, refund_iban')
      .eq('id', returnId)
      .maybeSingle();
    if (error) {
      if (colonnaNonTrovata(error)) {
        logger.warn('[resi] migrazione 162 non ancora applicata: il rimborso in contanti va col bonifico', {
          returnId,
        });
      } else {
        logger.error('[resi] scelta del rimborso non letta: si va col bonifico', {
          returnId, message: error.message,
        });
      }
      return { modo: null, iban: null, letta: false };
    }
    const riga = (data ?? {}) as { refund_method?: unknown; refund_iban?: unknown };
    const modo = riga.refund_method === 'CREDITO' || riga.refund_method === 'BONIFICO' ? riga.refund_method : null;
    const iban = modo === 'BONIFICO' && typeof riga.refund_iban === 'string' ? riga.refund_iban : null;
    return { modo, iban, letta: true };
  } catch (err) {
    logger.error('[resi] scelta del rimborso non letta: si va col bonifico', { returnId, err });
    return { modo: null, iban: null, letta: false };
  }
}

/** Dalla scelta salvata a quello che riceve `refundOrder`. */
export function comeTornanoIContanti(scelta: SceltaSalvata): ComeTornanoIContanti {
  if (scelta.modo === 'CREDITO') return { modo: 'CREDITO' };
  return { modo: 'BONIFICO', ibanFinale: finaleIban(scelta.iban), doveSiPaga: PAGINA_DEI_BONIFICI_DA_FARE };
}
