import type { SupabaseClient } from '@supabase/supabase-js';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';
import { formatPrice } from '@/lib/format';
import { APERTURA_EXPRESS, CHIUSURA_EXPRESS, ETICHETTA_ADESSO, MINUTI_PER_IL_RITIRO, expressSiPuo } from '@/lib/quando-arriva';
import { negozioPuoServire } from '@/lib/store-hours';
import { ORE_PER_ACCETTARE } from '@/lib/ordini/scadenza-accettazione';

/**
 * 29/10/2026 — LA CONSEGNA VELOCE SI VENDE SOLO SE SI PUÒ MANTENERE.
 *
 * La fascia «Adesso» prometteva 30-60 minuti guardando solo l'orologio del browser
 * (`expressSiPuo`): nessuno controllava che il negozio fosse aperto né che ci fosse un fattorino
 * approvato e acceso. In produzione il 29/10 c'era un solo fattorino, in attesa di approvazione:
 * ogni «Adesso» venduto era una promessa che nessuno poteva mantenere.
 *
 * Qui c'è UNA decisione, `veloceSiPuo`, con tre condizioni: dalle 8 alle 21 (ora di Piacenza),
 * ogni negozio del carrello aperto adesso, almeno un fattorino approvato con l'interruttore
 * acceso. La usano le due rotte che creano l'ordine (rifiutano con un 409), la rotta
 * /api/consegna/veloce (che la cassa e il carrello leggono) e la riga del carrello. Se una lettura
 * non riesce, la veloce non si offre: mai promettere alla cieca.
 * Prova: tests/unit/la-consegna-veloce-si-vende-solo-se-c-e-un-fattorino.test.ts.
 *
 * 13/11/2026 (R15-015) — UN FATTORINO ACCESO NON VUOL DIRE UN FATTORINO LIBERO.
 * Con un fattorino solo, dieci clienti alle 12:00 ricevevano tutti «arrivo in 30-60 minuti»: nessuno
 * contava le veloci che i fattorini avevano già in mano. Adesso `contaVelociInCorso` le conta (vendute
 * e non ancora consegnate) e `veloceSiPuo` le confronta con quante ne possono portare i fattorini
 * accesi: fattorini × `VELOCI_PER_FATTORINO`. Quel numero è una scelta di Nicola: finché non c'è, il
 * conteggio non decide e la veloce si vende come prima.
 * Prova: tests/unit/riparazione-r15-la-veloce-conta-quelle-in-mano.test.ts.
 *
 * 21/11/2026 (R04-021) — UNA VELOCE ALLA VOLTA PER FATTORINO, LA STESSA RISPOSTA DAPPERTUTTO.
 * Nicola ha scelto il 19/11 (fatto `consegna.veloce-per-fattorino`): un fattorino porta una veloce
 * alla volta. Il conto sta in `contaFattoriniOnline`, che tutte e quattro le strade già chiamano e
 * passano a `veloceSiPuo` (la cassa e il carrello con /api/consegna/veloce, le schede dei negozi con
 * /api/consegna/veloce/negozi, la rotta dei contanti e quella della carta): risponde i fattorini
 * accesi che non hanno già una veloce in mano. Così la cassa non offre «Adesso» che poi il clic finale
 * rifiuta con un 409. Si contano le consegne, non le righe: un carrello di due negozi è una consegna
 * sola (`contaVelociInCorso`).
 * Prova: tests/unit/riparazione-r04-una-veloce-per-fattorino.test.ts.
 */

/**
 * Quante consegne veloci può avere in mano un fattorino nello stesso momento. Scelta di Nicola del
 * 19/11/2026 (fatto `consegna.veloce-per-fattorino`): una alla volta. `null` = il conteggio non decide.
 */
const VELOCI_PER_FATTORINO: number | null = 1;

/** Gli stati di una consegna venduta e non ancora finita: dal «nuovo» al «in strada». */
const STATI_DELLA_CONSEGNA_IN_CORSO = ['NEW', 'ACCEPTED', 'READY', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'];

/**
 * 21/11/2026 (R04-020) — UNA VELOCE DIMENTICATA NON SPEGNE LA VELOCE PER SEMPRE.
 *
 * Il conteggio delle veloci in corso non aveva una finestra di tempo: un ordine «Adesso» rimasto
 * fermo in uno stato aperto (nessuno l'ha chiuso) contava per giorni, e con il tetto a una veloce per
 * fattorino il fattorino solo risultava occupato. Il collaudo: un «Adesso» fermo dal 16/11 dava 409
 * il 19/11. Adesso si contano solo le veloci nate nelle ultime `ORE_PER_ACCETTARE` ore: è la vita più
 * lunga che il sito dà a una veloce (dopo tre ore senza conferma il giro notturno la annulla; una
 * confermata promette 30-60 minuti, e il negozio ha 10 minuti per confermarla). È il valore più
 * prudente già scritto nel codice: una veloce vera in ritardo resta contata; una più vecchia di tre
 * ore è dimenticata. (Una finestra più corta è una scelta di Nicola.)
 */
const ORE_DELLA_VELOCE_IN_CORSO = ORE_PER_ACCETTARE;

/** La fascia salvata sull'ordine è la veloce? È l'ingresso `consegnaVeloce` del conto. */
export function eConsegnaVeloce(a: { fascia: string | null | undefined; ritiroInNegozio: boolean }): boolean {
  return !a.ritiroInNegozio && a.fascia === ETICHETTA_ADESSO;
}

export type EsitoVeloce = { possibile: true } | { possibile: false; perche: string };

const SCEGLI_UNA_FASCIA = 'Scegli una fascia oraria: la consegna arriva quando la scegli tu.';

export function veloceSiPuo(s: {
  /** L'ora di Piacenza (`romeNow()`), non quella del server. */
  adesso: Date;
  /** Gli orari dei negozi del carrello. `null` = la lettura non è riuscita. */
  negozi: Array<{ nome: string; orari: unknown }> | null;
  /**
   * I fattorini che possono partire adesso per una veloce. `null` = la lettura non è riuscita.
   * 21/11/2026 (R04-021) — Da `contaFattoriniOnline` arrivano già senza quelli che hanno in mano
   * tutte le veloci che possono portare: chi passa quel numero non passa anche `velociInCorso`.
   */
  fattoriniOnline: number | null;
  /**
   * Le veloci già vendute e non ancora consegnate (`contaVelociInCorso`). `null` = la lettura non è
   * riuscita. Assente = chi chiama non le conta. Solo per chi passa i fattorini accesi, non i liberi.
   */
  velociInCorso?: number | null;
  /** Quante veloci può avere in mano un fattorino. Assente = qui il conteggio non decide (vedi sotto). */
  velociPerFattorino?: number | null;
}): EsitoVeloce {
  if (!expressSiPuo(s.adesso.getHours())) {
    // 5/11/2026 — Le ore dalle costanti di lib/quando-arriva, come ORE_DELLA_VELOCE: prima erano scritte a mano.
    return { possibile: false, perche: `La consegna veloce si fa dalle ${APERTURA_EXPRESS} alle ${CHIUSURA_EXPRESS}. ${SCEGLI_UNA_FASCIA}` };
  }
  if (s.negozi === null || s.fattoriniOnline === null) {
    return { possibile: false, perche: `Adesso non riesco a confermare la consegna veloce. ${SCEGLI_UNA_FASCIA}` };
  }
  // 5/11/2026 — Aperto adesso E ancora fra un quarto d'ora (MINUTI_PER_IL_RITIRO, la stessa regola delle
  // fasce: «il tempo di accettare e preparare la busta»). Prima la veloce si vendeva anche due minuti
  // prima della chiusura, e il fattorino arrivava a negozio chiuso.
  const fraUnQuarto = new Date(s.adesso.getTime() + MINUTI_PER_IL_RITIRO * 60_000);
  const chiuso = s.negozi.find(
    (n) => !negozioPuoServire(n.orari, ETICHETTA_ADESSO, s.adesso) || !negozioPuoServire(n.orari, ETICHETTA_ADESSO, fraUnQuarto),
  );
  if (chiuso) {
    const apertoAdesso = negozioPuoServire(chiuso.orari, ETICHETTA_ADESSO, s.adesso);
    return {
      possibile: false,
      perche: apertoAdesso
        ? `${chiuso.nome} sta per chiudere: la consegna veloce non si può. ${SCEGLI_UNA_FASCIA}`
        : `${chiuso.nome} adesso è chiuso: la consegna veloce non si può. ${SCEGLI_UNA_FASCIA}`,
    };
  }
  if (s.fattoriniOnline < 1) {
    return { possibile: false, perche: `Adesso non c'è un fattorino libero per la consegna veloce. ${SCEGLI_UNA_FASCIA}` };
  }
  // 13/11/2026 (R15-015) — Le veloci già in mano contano: i fattorini accesi ne portano al massimo
  // fattorini × tetto. Senza il tetto (scelta di Nicola) o senza il conteggio, si decide come prima.
  // 21/11/2026 (R04-021) — Qui il tetto conta solo se chi chiama lo passa: le strade passano i
  // fattorini liberi di `contaFattoriniOnline`, che lo ha già applicato (due volte sarebbe un errore).
  const tetto = s.velociPerFattorino ?? null;
  if (tetto !== null && s.velociInCorso !== undefined) {
    if (s.velociInCorso === null) {
      return { possibile: false, perche: `Adesso non riesco a confermare la consegna veloce. ${SCEGLI_UNA_FASCIA}` };
    }
    if (s.velociInCorso >= s.fattoriniOnline * tetto) {
      return {
        possibile: false,
        perche: `Adesso i fattorini hanno già in mano tutte le consegne veloci che possono portare. ${SCEGLI_UNA_FASCIA}`,
      };
    }
  }
  return { possibile: true };
}

/**
 * Quanti fattorini possono partire adesso: ruolo rider, approvati, interruttore acceso.
 * `null` se la lettura fallisce (chi chiama non offre la veloce). Serve il client di servizio:
 * i profili degli altri al cliente non si leggono.
 *
 * 21/11/2026 (R04-021) — «Possono partire» per una veloce: senza quelli che hanno già in mano tutte
 * le veloci che possono portare (`VELOCI_PER_FATTORINO`, una). Con un fattorino acceso e una veloce in
 * corso risponde 0, e `veloceSiPuo` dice «non c'è un fattorino libero» alla cassa come al clic finale.
 * Se il conteggio delle veloci cade, `null`: un conteggio caduto non vende la veloce.
 */
export async function contaFattoriniOnline(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  adesso: Date = new Date(),
): Promise<number | null> {
  try {
    const { count, error } = await db
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'rider')
      .eq('is_approved', true)
      .eq('rider_is_online', true);
    if (error) return null;
    const accesi = count ?? 0;
    if (accesi === 0 || VELOCI_PER_FATTORINO === null) return accesi;
    const inCorso = await contaVelociInCorso(db, adesso);
    if (inCorso === null) return null;
    return Math.max(0, accesi - Math.ceil(inCorso / VELOCI_PER_FATTORINO));
  } catch {
    return null;
  }
}

/**
 * 13/11/2026 (R15-015) — Quante consegne veloci sono già vendute e non ancora finite: fascia
 * «Adesso», stato fra il nuovo e il «in strada». Le ha in mano un fattorino o le aspetta.
 * `null` se la lettura fallisce o non dà un numero: un conteggio caduto non vale zero.
 * Serve il client di servizio: gli ordini degli altri al cliente non si leggono.
 * 21/11/2026 (R04-020) — Solo quelle nate nelle ultime `ORE_DELLA_VELOCE_IN_CORSO` ore.
 * 21/11/2026 (R04-021) — Si contano le CONSEGNE, non le righe: gli ordini di un carrello sono dello
 * stesso cliente e partono insieme, quindi le veloci di un cliente sono una consegna sola (un
 * carrello di due negozi fa due righe). Due carrelli veloci dello stesso cliente insieme contano
 * uno: vanno alla stessa porta.
 */
export async function contaVelociInCorso(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  adesso: Date = new Date(),
): Promise<number | null> {
  try {
    const soglia = adesso.getTime() - ORE_DELLA_VELOCE_IN_CORSO * 3_600_000;
    const leggi = () =>
      db
        .from('orders')
        .select('user_id, created_at', { count: 'exact' })
        .eq('delivery_slot', ETICHETTA_ADESSO)
        .in('delivery_status', STATI_DELLA_CONSEGNA_IN_CORSO);
    let { data, error, count } = await leggi();
    if (error || !Array.isArray(data)) return null;
    // R04-013 — Il servizio dati restituisce al massimo 1000 righe per richiesta: se il conteggio vero
    // è più alto, sono rimaste fuori righe (le veloci dimenticate di sempre possono coprire quelle di
    // adesso). Allora si rilegge chiedendo al database solo la finestra; se anche così non entra
    // tutto, il numero non si sa (`null`: un conteggio caduto non vende la veloce).
    if (typeof count === 'number' && count > data.length) {
      ({ data, error, count } = await leggi().gte('created_at', new Date(soglia).toISOString()));
      if (error || !Array.isArray(data)) return null;
      if (typeof count === 'number' && count > data.length) return null;
    }
    // La finestra si guarda qui: le veloci aperte sono poche. Una nascita che non si legge conta
    // (non si può dire che sia dimenticata).
    const recenti = (data as Array<{ user_id?: unknown; created_at?: unknown }>).filter((r) => {
      const nato = Date.parse(String(r.created_at ?? ''));
      return Number.isNaN(nato) || nato >= soglia;
    });
    // R04-021 — Una consegna per cliente; una riga senza cliente è una consegna sua.
    return new Set(recenti.map((r, i) => (r.user_id ? `cliente:${String(r.user_id)}` : `riga:${i}`))).size;
  } catch {
    return null;
  }
}

/** La parola sotto la mattonella «Adesso»: «+1 €» da 10 € in su, «compresa» sotto i 10 €. */
export function prezzoDellaVeloce(supplementoCents: number): string {
  if (supplementoCents <= 0) return 'compresa';
  const euro = supplementoCents / 100;
  return Number.isInteger(euro) ? `+${euro} €` : `+${formatPrice(euro)}`;
}

/**
 * La riga del carrello «quando arriva». Promette i minuti SOLO se la veloce si può davvero (stessa
 * risposta della cassa e delle rotte) e l'orologio è ancora dentro le 8-21. `null` = non ancora
 * letto, o lettura fallita: nessun tempo promesso.
 */
export function rigaQuandoArrivaNelCarrello(ora: number | null, veloce: boolean | null): string | null {
  if (ora === null || veloce === null) return null;
  if (veloce && expressSiPuo(ora)) return `Consegna in ${EXPRESS_ETA_LABEL}`;
  return 'Consegna nella fascia che scegli in cassa';
}

/**
 * Come il carrello e la cassa leggono la risposta di /api/consegna/veloce. Solo `possibile: true`
 * vale sì; `possibile: false` vale no; tutto il resto (rete caduta, risposta storta, errore) vale
 * «non so», e chi non sa non promette la veloce né il suo prezzo.
 */
export function leggiEsitoDellaVeloce(esito: unknown): boolean | null {
  if (!esito || typeof esito !== 'object') return null;
  const possibile = (esito as { possibile?: unknown }).possibile;
  if (possibile === true) return true;
  if (possibile === false) return false;
  return null;
}
