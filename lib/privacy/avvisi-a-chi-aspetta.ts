/**
 * PORTARE FUORI LA RISPOSTA CHE DOBBIAMO A CHI ASPETTA LA CANCELLAZIONE.
 *
 * 8/9/2026 — LA SPIEGAZIONE C'ERA E NON USCIVA DA CASA.
 *
 * `lib/cron-cancellazioni.ts` decide COSA dobbiamo dire a una persona che ha
 * chiesto di sparire e non è ancora sparita. Qui c'è il canale che lo porta
 * fuori, e il canale è uno solo: la notifica nel suo pannello, la stessa che
 * legge la campanella del sito.
 *
 * Il difetto che questo file chiude non è «manca una notifica». È che il rinvio
 * era stato progettato come un fatto interno — un contatore dentro una risposta
 * HTTP e un allarme per noi — invece che come una risposta dovuta a qualcuno.
 * Finché il testo per l'interessato non ha un canale che lo porta fuori, quel
 * testo vale zero, per bello che sia.
 *
 * ── DUE FUNZIONI, E UNA SOLA VERITÀ ──
 *
 * `recapitaAvvisi` scrive. `attesaDichiarata` rilegge la stessa riga, per la
 * pagina dell'account. Non ricalcola niente: quello che l'interessato vede
 * nella pagina è, parola per parola, quello che gli abbiamo detto — perché due
 * testi calcolati in due posti diversi finiscono sempre per non coincidere, e
 * la versione che conta in un reclamo è quella che gli è arrivata.
 *
 * ── PERCHÉ L'IDENTIFICATIVO SE LO CALCOLA LUI ──
 *
 * Il giro notturno ripassa ogni notte, e finché il fattorino non versa i
 * contanti il rinvio si ripete. Senza un freno, la persona riceverebbe lo
 * stesso messaggio trenta volte. Il freno non è un controllo «l'ho già
 * mandato?» fatto prima di scrivere — quello perde la corsa se due giri
 * partono insieme — ma l'IDENTIFICATIVO STESSO della riga: si ricava dalla
 * chiave dell'avviso, quindi due notti producono lo stesso identificativo e la
 * seconda scrittura sbatte contro la chiave primaria. Il database dice di no,
 * e il no è la garanzia. Il controllo prima della scrittura resta, ma solo per
 * non sprecare una scrittura: la correttezza non dipende da lui.
 *
 * 🟢 Nessun orologio, nessuna rete decisa qui dentro: il client si passa.
 */
import type { AvvisoAllInteressato, TappaAvviso } from '@/lib/cron-cancellazioni';
import { chiaveAvviso } from '@/lib/cron-cancellazioni';
import { createHash } from 'node:crypto';

type Risposta = { data: unknown; error: { message: string } | null };

/** La fetta di client che serve qui. Una prova ne passa uno finto. */
export type ClienteAvvisi = {
  from(tabella: string): {
    select(colonne?: string): {
      eq(colonna: string, valore: unknown): PromiseLike<Risposta>;
    };
    insert(righe: Record<string, unknown>[]): PromiseLike<Risposta>;
  };
};

/** Il registro degli errori: la rotta passa il suo, una prova passa il suo. */
export type RegistroAvvisi = {
  info(messaggio: string, dati?: Record<string, unknown>): void;
  warn(messaggio: string, dati?: Record<string, unknown>): void;
  error(messaggio: string, dati?: Record<string, unknown>): void;
};

export type RapportoAvvisi = {
  /** Avvisi recapitati stanotte per la prima volta. */
  recapitati: number;
  /** Avvisi che la persona aveva già: non si ripetono. */
  giaDetti: number;
  /** Avvisi che NON siamo riusciti a recapitare: qui si sveglia qualcuno. */
  falliti: number;
  /** Una riga per avviso, in ordine, per il registro. */
  esiti: Array<{ chiave: string; esito: 'recapitato' | 'gia-detto' | 'fallito'; errore?: string }>;
};

/**
 * La categoria delle notifiche di servizio: non è una promozione e non si
 * spegne con gli interruttori del marketing. Una risposta dovuta per legge non
 * può dipendere da una casella «voglio ricevere novità».
 */
const CATEGORIA = 'system';

/**
 * L'identificativo della riga, ricavato dalla chiave dell'avviso.
 *
 * È un UUID valido perché la colonna è di tipo uuid: si prendono sedici byte
 * dall'impronta della chiave e si sistemano i due gruppi di bit che dicono
 * «versione» e «variante», come prescrive la RFC 4122. Nessun segreto qui
 * dentro: non serve che sia imprevedibile, serve che sia SEMPRE LO STESSO per
 * la stessa chiave.
 */
export function identificativoAvviso(chiave: string): string {
  const b = createHash('sha256').update(`mycity:avviso-cancellazione:${chiave}`).digest();
  const byte = Buffer.from(b.subarray(0, 16));
  byte[6] = (byte[6] & 0x0f) | 0x50; // versione 5: derivato da un nome
  byte[8] = (byte[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = byte.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Vero quando il database ha rifiutato perché la riga c'è già. */
function eUnDoppione(messaggio: string): boolean {
  const m = messaggio.toLowerCase();
  return m.includes('duplicate key') || m.includes('23505') || m.includes('already exists');
}

/**
 * Recapita gli avvisi dovuti. Idempotente: chiamala tutte le notti che vuoi,
 * ogni persona riceve ogni messaggio una volta sola.
 *
 * Non lancia mai: un avviso che non parte è un guasto da contare e da dire, non
 * una ragione per far cadere il resto del giro notturno. Chi chiama guarda
 * `falliti`.
 */
export async function recapitaAvvisi(
  admin: ClienteAvvisi,
  avvisi: AvvisoAllInteressato[],
  registro: RegistroAvvisi,
): Promise<RapportoAvvisi> {
  const rapporto: RapportoAvvisi = { recapitati: 0, giaDetti: 0, falliti: 0, esiti: [] };

  for (const a of avvisi) {
    const id = identificativoAvviso(a.chiave);
    try {
      const gia = await admin.from('notifications').select('id').eq('id', id);
      if (gia.error) throw new Error(gia.error.message);
      if (Array.isArray(gia.data) && gia.data.length > 0) {
        rapporto.giaDetti++;
        rapporto.esiti.push({ chiave: a.chiave, esito: 'gia-detto' });
        continue;
      }

      const scritto = await admin.from('notifications').insert([
        {
          id,
          user_id: a.userId,
          category: CATEGORIA,
          title: a.titolo,
          body: a.corpo,
          link: a.link,
        },
      ]);
      if (scritto.error) {
        // Due giri partiti insieme: il secondo trova la chiave primaria
        // occupata. Non è un guasto, è il freno che ha funzionato.
        if (eUnDoppione(scritto.error.message)) {
          rapporto.giaDetti++;
          rapporto.esiti.push({ chiave: a.chiave, esito: 'gia-detto' });
          continue;
        }
        throw new Error(scritto.error.message);
      }

      rapporto.recapitati++;
      rapporto.esiti.push({ chiave: a.chiave, esito: 'recapitato' });
      registro.info('[avvisi-cancellazione] risposta recapitata all interessato', {
        userId: a.userId, tappa: a.tappa,
      });
    } catch (e) {
      const errore = e instanceof Error ? e.message : 'errore';
      rapporto.falliti++;
      rapporto.esiti.push({ chiave: a.chiave, esito: 'fallito', errore });
      // Una risposta dovuta per legge che non parte non può restare nei log e
      // basta: chi chiama rende rossa la notte e sveglia un amministratore.
      registro.error('[avvisi-cancellazione] la persona non e stata avvisata', {
        userId: a.userId, tappa: a.tappa, errore,
      });
    }
  }

  return rapporto;
}

/** Quello che la pagina dell'account deve poter dire a chi sta aspettando. */
export type AttesaDichiarata = {
  /** `true` quando la cancellazione è ferma e gliel'abbiamo già spiegato. */
  inAttesa: boolean;
  /** La stessa spiegazione che le abbiamo mandato, parola per parola. */
  motivo: string | null;
  /** Quale tappa: un rinvio, oppure il termine di legge già passato. */
  tappa: TappaAvviso | null;
  /** Quando gliel'abbiamo detto. */
  dettoIl: string | null;
};

const NIENTE_DA_DIRE: AttesaDichiarata = {
  inAttesa: false, motivo: null, tappa: null, dettoIl: null,
};

/**
 * Rilegge la risposta che abbiamo già dato a questa persona.
 *
 * Due letture per chiave primaria, non una scansione: gli identificativi si
 * ricavano da `userId` + il giorno della richiesta, che chi chiama ha già in
 * mano. Il ritardo vince sul rinvio, perché è la cosa più grave delle due.
 *
 * Se la lettura non riesce si risponde «niente da dire» e si scrive nel
 * registro: la pagina dell'account non deve rompersi per una notifica, ma il
 * silenzio non deve nemmeno passare per «non c'era niente».
 */
export async function attesaDichiarata(
  admin: ClienteAvvisi,
  userId: string,
  chiestaIl: string | null | undefined,
  registro: RegistroAvvisi,
): Promise<AttesaDichiarata> {
  const tappe: TappaAvviso[] = ['termine-scaduto', 'rinviata'];
  for (const tappa of tappe) {
    const id = identificativoAvviso(chiaveAvviso(userId, chiestaIl, tappa));
    try {
      const { data, error } = await admin.from('notifications').select('body, created_at').eq('id', id);
      if (error) throw new Error(error.message);
      const riga = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
      if (!riga) continue;
      return {
        inAttesa: true,
        motivo: typeof riga.body === 'string' ? riga.body : null,
        tappa,
        dettoIl: typeof riga.created_at === 'string' ? riga.created_at : null,
      };
    } catch (e) {
      registro.warn('[avvisi-cancellazione] non si e potuto rileggere l avviso', {
        userId, tappa, errore: e instanceof Error ? e.message : 'errore',
      });
      return NIENTE_DA_DIRE;
    }
  }
  return NIENTE_DA_DIRE;
}

/* ────────────────────────────────────────────────────────────────────────────
 * I DUE ATTACCHI, RIDOTTI A UNA RIGA L'UNO.
 *
 * Le due rotte che devono chiamare tutto questo — il giro notturno e la pagina
 * dell'account — stanno fuori dal territorio di chi ha scritto questo file, e
 * finché non le tocca qualcuno la persona non riceve niente lo stesso.
 *
 * Queste due funzioni esistono perché l'attacco non si possa sbagliare: una
 * riga, il tipo vero del client di servizio, nessun travestimento da rifare a
 * mano nella rotta. E siccome prendono il tipo vero, il compilatore controlla
 * qui il punto di giunzione che nessuna prova può ancora eseguire.
 * ──────────────────────────────────────────────────────────────────────────── */
import type { getAdminSupabase } from '@/lib/supabase/server';

type Amministrativo = ReturnType<typeof getAdminSupabase>;

/**
 * IL GIRO NOTTURNO — `app/api/cron/process-deletions/route.ts`, subito dopo
 * `const verdetto = verdettoDelGiro(...)`:
 *
 *     const avvisi = await rispondiAChiAspetta(admin, verdetto, logger);
 *
 * e poi `avvisi.falliti` va nel conto che rende rossa la notte, accanto a
 * `potature.fallite`: una risposta dovuta per legge che non parte è un guasto
 * come gli altri.
 */
export async function rispondiAChiAspetta(
  admin: Amministrativo,
  verdetto: { dovuti: AvvisoAllInteressato[] },
  registro: RegistroAvvisi,
): Promise<RapportoAvvisi> {
  return recapitaAvvisi(admin as unknown as ClienteAvvisi, verdetto.dovuti, registro);
}

/**
 * LA PAGINA DELL'ACCOUNT — `app/api/account/delete/route.ts`, nel ramo GET in
 * cui oggi si risponde solo `pending/requestedAt/effectiveAt/daysRemaining`:
 *
 *     const attesa = await motivoDellAttesa(admin, user.id, data.deletion_requested_at, logger);
 *
 * e i tre campi di `attesa` entrano nella risposta. È così che il conto alla
 * rovescia fermo a «tra 0 giorni» smette di essere l'unica cosa che quella
 * persona vede.
 */
export async function motivoDellAttesa(
  admin: Amministrativo,
  userId: string,
  chiestaIl: string | null | undefined,
  registro: RegistroAvvisi,
): Promise<AttesaDichiarata> {
  return attesaDichiarata(admin as unknown as ClienteAvvisi, userId, chiestaIl, registro);
}
