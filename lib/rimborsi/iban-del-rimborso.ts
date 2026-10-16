import { logger } from '@/lib/logger';
import { colonnaNonTrovata } from '@/lib/db/migrazione-148';
import { eUnBonificoDiRimborso, tabellaDeiBonificiMancante } from './bonifici-da-fare';

/**
 * QUANTO TENIAMO L'IBAN DI UN RIMBORSO (R71, riesame del 16/10).
 *
 * Chi paga in contanti e restituisce un prodotto ci lascia l'IBAN, e noi gli
 * facciamo il bonifico a mano. Prima l'IBAN restava sul reso per sempre: dopo
 * il bonifico, dopo un reso respinto, e anche dopo che il cliente aveva
 * cancellato l'account — su una riga che non portava piu' il suo nome ma il
 * suo conto si', con l'informativa che diceva «usato solo per quel bonifico».
 *
 * LA REGOLA, in una frase: l'IBAN si tiene SOLO finche' il bonifico e' da fare,
 * perche' rimborsare e' un obbligo di legge e per farlo serve il conto.
 *
 *  · Bonifico segnato fatto → l'IBAN si cancella (lo fa la rotta che segna
 *    «fatto», e la 162 non accetta un «fatto» con l'IBAN ancora scritto).
 *  · Reso chiuso senza bonifico — respinto, annullato, rimborsato col credito
 *    o sulla carta → il bonifico non ci sara' mai, l'IBAN si cancella.
 *  · Il cliente cancella l'account con un bonifico ancora da fare → sul reso
 *    (o sul bonifico del reclamo) restano SOLO l'IBAN e il nome
 *    dell'intestatario, fino al pagamento; poi si cancellano anche quelli. Il
 *    nome va scritto li' perche' la riga ordine, a quel punto, non lo porta
 *    piu': senza un nome il bonifico non si fa.
 *  · Il cliente cancella l'account senza bonifici da fare → l'IBAN se ne va
 *    con l'account.
 *
 * La regola la possono cambiare Nicola e il legale: e' scritta qui, una volta
 * sola, e la informativa la legge da qui (`app/privacy/page.tsx`).
 */

/** Gli stati di un reso ancora in corso: il rimborso deve ancora arrivare. */
export const STATI_APERTI_DEL_RESO = ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'] as const;

/** Quello che serve sapere di un reso per decidere se il suo IBAN serve ancora. */
export interface RigaDelResoPerLIban {
  status: string | null | undefined;
  refund_id?: string | null;
  refund_method?: string | null;
  refund_bonifico_fatto_at?: string | null;
}

/**
 * Il bonifico di questo reso e' ancora da fare — adesso, o quando il reso
 * arrivera' in fondo?
 *
 *  · rimborsato col segno del bonifico e non ancora segnato fatto → si';
 *  · ancora in corso, e il cliente ha scelto il bonifico → si': quando il
 *    negozio rimborsa, il bonifico sara' dovuto;
 *  · tutto il resto (fatto, respinto, annullato, credito, carta) → no.
 */
export function ilBonificoDelResoEAncoraDaFare(r: RigaDelResoPerLIban): boolean {
  if (r.refund_bonifico_fatto_at) return false;
  if (r.status === 'REFUNDED') return eUnBonificoDiRimborso(r.refund_id);
  if ((STATI_APERTI_DEL_RESO as readonly string[]).includes(String(r.status))) {
    return r.refund_method === 'BONIFICO';
  }
  return false;
}

/** I campi che portano via il conto e il nome dal reso. */
export const IBAN_DEL_RESO_CANCELLATO = { refund_iban: null, refund_intestatario: null } as const;

/** I campi che portano via il conto e il nome dal bonifico di un reclamo. */
export const IBAN_DEL_RECLAMO_CANCELLATO = { iban: null, intestatario: null } as const;

/**
 * Il nome a cui intestare il bonifico, quando il cliente se ne va: quello che
 * ha scritto sull'ordine, se no quello del profilo. Spazi tolti; vuoto = null.
 */
export function nomeDellIntestatario(
  dallOrdine: string | null | undefined,
  dalProfilo: string | null | undefined,
): string | null {
  for (const nome of [dallOrdine, dalProfilo]) {
    const pulito = typeof nome === 'string' ? nome.replace(/\s+/g, ' ').trim() : '';
    if (pulito) return pulito;
  }
  return null;
}

// ── Le parole per chi legge: l'informativa e le impostazioni le prendono da qui ──

/** Dove chiediamo l'IBAN, davvero. */
export const DOVE_CHIEDIAMO_L_IBAN =
  "Nel modulo di reso, se scegli il bonifico. Per un reclamo — o se nel reso non l'hai scritto — " +
  "te lo chiediamo per email e ce lo mandi con un messaggio dalla pagina Contatti: quel messaggio " +
  "arriva anche nella casella email dell'assistenza e resta fra i messaggi dell'assistenza al massimo 2 anni. " +
  "Chi fa il bonifico copia l'IBAN sulla richiesta di rimborso.";

/** Perché lo teniamo. */
export const PERCHE_TENIAMO_L_IBAN =
  'Obbligo di rimborsare il consumatore (Codice del Consumo, art. 56; art. 6.1.c GDPR) ed esecuzione del contratto (art. 6.1.b)';

/** Quanto lo teniamo: è la regola qui sopra, detta a chi legge. */
export const QUANTO_TENIAMO_L_IBAN =
  'Solo finché il bonifico è da fare. Quando il bonifico è fatto, o la richiesta si chiude senza bonifico, ' +
  "l'IBAN si cancella. Se cancelli l'account e non ti dobbiamo nessun bonifico, l'IBAN se ne va con l'account. " +
  "Se cancelli l'account mentre ti dobbiamo ancora un bonifico, sulla richiesta di rimborso restano solo " +
  "l'IBAN e il tuo nome come intestatario, fino al pagamento; poi si cancellano anche quelli.";

/** La frase per chi sta cancellando l'account. */
export const SE_CANCELLI_L_ACCOUNT_CON_UN_BONIFICO_DA_FARE =
  "Se ti dobbiamo ancora un rimborso con bonifico, sulla richiesta di rimborso restano solo il tuo IBAN e il " +
  'tuo nome, fino al pagamento; poi li cancelliamo.';

// ── Le scritture ─────────────────────────────────────────────────────────────

/**
 * Il client si accetta «largo» e si restringe qui dentro, come in
 * `scelta-del-reso.ts`: il tipo completo del client di Supabase, confrontato con
 * quelli stretti, manda in giro il controllore dei tipi senza fine.
 */
type ClientLargo = { from(tabella: string): unknown };
type Errore = { code?: string; message?: string } | null;
type Risposta = PromiseLike<{ data?: unknown; error: Errore }>;

/** La catena di filtri minima che usano le scritture e le letture qui sotto. */
interface Catena extends Risposta {
  eq(colonna: string, valore: unknown): Catena;
  in(colonna: string, valori: readonly unknown[]): Catena;
  is(colonna: string, valore: null): Catena;
  maybeSingle(): Risposta;
}
interface Tabella {
  select(colonne: string): Catena;
  update(valori: Record<string, unknown>): Catena;
}
const tabella = (admin: ClientLargo, nome: string) => admin.from(nome) as Tabella;

export type EsitoDellIban = 'tenuto' | 'cancellato' | 'niente-da-togliere' | 'senza-162' | 'errore';

/**
 * Dopo che un reso ha cambiato stato: se il suo bonifico non ci sara' piu',
 * l'IBAN (e il nome, se c'era) se ne vanno.
 *
 * Lo chiamano le rotte che chiudono un reso (`decide`, `avanza`). Non lancia
 * mai: un guasto qui finisce nei log e non disfa una decisione gia' presa — al
 * peggio l'IBAN resta fino al prossimo giro, ma i soldi del cliente non si
 * toccano. Senza la migrazione 162 non c'e' nessun IBAN da togliere.
 */
export async function dimenticaLIbanSeNonServe(
  admin: ClientLargo,
  returnId: string,
): Promise<{ esito: EsitoDellIban; errore?: string }> {
  try {
    const { data, error } = await tabella(admin, 'returns')
      .select('status, refund_id, refund_method, refund_bonifico_fatto_at, refund_iban, refund_intestatario')
      .eq('id', returnId)
      .maybeSingle();
    if (error) {
      if (colonnaNonTrovata(error)) return { esito: 'senza-162' };
      logger.error('[iban del rimborso] reso non letto: l IBAN resta per ora', { returnId, message: error.message });
      return { esito: 'errore', errore: error.message };
    }
    const riga = data as (RigaDelResoPerLIban & { refund_iban?: string | null; refund_intestatario?: string | null }) | null;
    if (!riga) return { esito: 'niente-da-togliere' };
    if (ilBonificoDelResoEAncoraDaFare(riga)) return { esito: 'tenuto' };
    if (!riga.refund_iban && !riga.refund_intestatario) return { esito: 'niente-da-togliere' };

    const { error: errScrittura } = await tabella(admin, 'returns')
      .update({ ...IBAN_DEL_RESO_CANCELLATO })
      .eq('id', returnId)
      .eq('status', String(riga.status));
    if (errScrittura) {
      if (colonnaNonTrovata(errScrittura)) return { esito: 'senza-162' };
      logger.error('[iban del rimborso] IBAN non cancellato', { returnId, message: errScrittura.message });
      return { esito: 'errore', errore: errScrittura.message };
    }
    return { esito: 'cancellato' };
  } catch (e) {
    const errore = e instanceof Error ? e.message : 'errore';
    logger.error('[iban del rimborso] IBAN non cancellato', { returnId, errore });
    return { esito: 'errore', errore };
  }
}

export type CustodiaDeiBonifici =
  | { ok: true; resiConIlNome: number; ibanCancellati: number; reclamiConIlNome: number }
  | { ok: false; errore: string };

/**
 * PRIMA DI CANCELLARE UN ACCOUNT: i bonifici che gli dobbiamo ancora.
 *
 * La cancellazione azzera il nome sugli ordini e stacca resi e bonifici dalla
 * persona. Qui, finche' il legame c'e' ancora:
 *
 *  · sui resi col bonifico ancora da fare si scrive il nome dell'intestatario,
 *    e l'IBAN resta: sono le uniche due cose che restano, fino al pagamento;
 *  · sui resi senza bonifico da fare, l'IBAN (se c'era) si cancella adesso:
 *    dopo, senza piu' il legame con la persona, non lo ritroverebbe nessuno;
 *  · sui bonifici dei reclami ancora da fare si scrive il nome.
 *
 * Se una lettura o una scrittura cade, la risposta e' «fermati»: la
 * cancellazione si rinvia e domani si riprova. Andare avanti lascerebbe un
 * debito senza nessun nome, o un conto in chiaro senza piu' un proprietario.
 */
export async function custodisciIBonificiDaFare(admin: ClientLargo, userId: string): Promise<CustodiaDeiBonifici> {
  const fermati = (perche: string): CustodiaDeiBonifici => {
    logger.error('[cancellazione] bonifici da fare non messi al sicuro', { userId, perche });
    return { ok: false, errore: perche };
  };

  try {
    // ① I resi della persona. Senza la 162 non c'e' nessun IBAN e nessun bonifico segnato.
    const resi = await tabella(admin, 'returns')
      .select('id, order_id, status, refund_id, refund_method, refund_bonifico_fatto_at, refund_iban')
      .eq('buyer_id', userId);
    if (resi.error && !colonnaNonTrovata(resi.error)) return fermati(`resi: ${resi.error.message}`);
    const righeResi = (resi.error ? [] : ((resi.data ?? []) as Array<
      RigaDelResoPerLIban & { id: string; order_id: string; refund_iban?: string | null }
    >));

    // ② I bonifici dei reclami ancora da fare, passando dai suoi reclami.
    let righeReclami: Array<{ dispute_id: string; order_id: string }> = [];
    const reclami = await tabella(admin, 'disputes').select('id, order_id').eq('opener_id', userId);
    if (reclami.error) return fermati(`reclami: ${reclami.error.message}`);
    const idReclami = ((reclami.data ?? []) as Array<{ id: string }>).map((d) => d.id);
    if (idReclami.length > 0) {
      const bonifici = await tabella(admin, 'bonifici_dei_reclami')
        .select('dispute_id, order_id')
        .in('dispute_id', idReclami)
        .is('fatto_at', null);
      if (bonifici.error && !tabellaDeiBonificiMancante(bonifici.error)) {
        return fermati(`bonifici dei reclami: ${bonifici.error.message}`);
      }
      righeReclami = (bonifici.error ? [] : (bonifici.data ?? [])) as typeof righeReclami;
    }

    const daFare = righeResi.filter((r) => ilBonificoDelResoEAncoraDaFare(r));
    const daDimenticare = righeResi.filter((r) => !ilBonificoDelResoEAncoraDaFare(r) && r.refund_iban);

    // ③ Il nome, solo se c'e' qualcosa da pagare: letto prima che la pulizia degli ordini lo tolga.
    const nomi = new Map<string, string | null>();
    let nomeDelProfilo: string | null = null;
    if (daFare.length > 0 || righeReclami.length > 0) {
      const ordini = await tabella(admin, 'orders').select('id, delivery_full_name').eq('user_id', userId);
      if (ordini.error) return fermati(`ordini: ${ordini.error.message}`);
      for (const o of (ordini.data ?? []) as Array<{ id: string; delivery_full_name: string | null }>) {
        nomi.set(o.id, o.delivery_full_name);
      }
      const profilo = await tabella(admin, 'profiles').select('full_name').eq('id', userId);
      if (profilo.error) return fermati(`profilo: ${profilo.error.message}`);
      nomeDelProfilo = ((profilo.data ?? []) as Array<{ full_name: string | null }>)[0]?.full_name ?? null;
    }
    const nomePer = (ordineId: string) => nomeDellIntestatario(nomi.get(ordineId), nomeDelProfilo);

    for (const r of daFare) {
      const { error } = await tabella(admin, 'returns')
        .update({ refund_intestatario: nomePer(r.order_id) })
        .eq('id', r.id)
        .is('refund_bonifico_fatto_at', null);
      if (error) return fermati(`reso ${r.id}: ${error.message}`);
    }
    for (const r of daDimenticare) {
      const { error } = await tabella(admin, 'returns').update({ ...IBAN_DEL_RESO_CANCELLATO }).eq('id', r.id);
      if (error) return fermati(`reso ${r.id}: ${error.message}`);
    }
    for (const b of righeReclami) {
      const { error } = await tabella(admin, 'bonifici_dei_reclami')
        .update({ intestatario: nomePer(b.order_id) })
        .eq('dispute_id', b.dispute_id)
        .is('fatto_at', null);
      if (error) return fermati(`bonifico del reclamo ${b.dispute_id}: ${error.message}`);
    }

    return {
      ok: true,
      resiConIlNome: daFare.length,
      ibanCancellati: daDimenticare.length,
      reclamiConIlNome: righeReclami.length,
    };
  } catch (e) {
    return fermati(e instanceof Error ? e.message : 'errore');
  }
}
