// lib/ai/tettoSpesa.ts
import { logger } from '@/lib/logger';
import { getAdminSupabase } from '@/lib/supabase/server';

/**
 * Il conto di quanto abbiamo speso oggi verso Anthropic — UNO SOLO per tutto
 * il sito.
 *
 * 27/8/2026 (R135 · R142) — PRIMA ERA UN NUMERO NELLA MEMORIA DI UNA COPIA.
 *
 * `lib/ai/run.ts` teneva `const _aiBudget = { spentEur: 0, resetAt: Date.now() }`,
 * una variabile di file, e il commento accanto dichiarava la cosa
 * «accettabile». Non lo era: su Vercel non esiste «la macchina». Ogni richiesta
 * puo' finire su una copia diversa della funzione, ogni copia nasce col
 * contatore vuoto, e ogni risveglio lo azzera. «Venti euro al giorno»
 * diventava venti euro per copia e per risveglio, cioe' un numero che non
 * frena niente — e il nome della variabile d'ambiente prometteva una garanzia
 * che il codice non dava. E' la stessa lezione che `lib/rate-limit.ts` si
 * scrive in cima al file per se' stesso: qui non era stata applicata.
 *
 * Anche la finestra era sbagliata: ventiquattro ore contate dall'accensione di
 * quella copia. Due copie accese a ore diverse guardavano due giorni diversi.
 * Adesso la casella e' il giorno di CALENDARIO a Piacenza, uguale per tutti.
 *
 * Dove vive il conto: la tabella `ai_spend_daily` (migrazione 131), toccata
 * con una sola istruzione atomica (`registra_spesa_ai`) dal client
 * amministrativo. Se quel giro non risponde — database irraggiungibile,
 * migrazione non ancora applicata — si continua a contare in memoria, perche'
 * un freno largo e' meglio di nessun freno, ma lo si DICE nei registri: un
 * ripiego silenzioso e' peggio del guasto, perche' nessuno sa che il tetto
 * vero non e' piu' quello scritto.
 */

/** La casella del giorno: data di calendario a Piacenza, `AAAA-MM-GG`. */
export function giornoDiSpesa(quando: Date = new Date()): string {
  // 'en-CA' dà proprio AAAA-MM-GG; il fuso è quello del marketplace.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(quando);
}

/** Il ripiego: vale solo per questa copia, e si usa quando il conto vero tace. */
const _ripiego = { giorno: '', cents: 0 };
let _ripieghiSegnalati = 0;

/** Solo per le prove: rimette a zero il contatore di ripiego. */
export function __azzeraRipiegoSpesaAi(): void {
  _ripiego.giorno = '';
  _ripiego.cents = 0;
  _ripieghiSegnalati = 0;
  fallimentiDiFila = 0;
  riprovaDopo = 0;
}

function ripiegoCents(giorno: string): number {
  if (_ripiego.giorno !== giorno) {
    _ripiego.giorno = giorno;
    _ripiego.cents = 0;
  }
  return _ripiego.cents;
}

/**
 * Non si riempie il registro di una riga per chiamata: quando il database
 * tace, tace per tutte. Si segnala la prima e poi una ogni cento.
 */
function segnalaRipiego(motivo: string, giorno: string): void {
  _ripieghiSegnalati++;
  if (_ripieghiSegnalati === 1 || _ripieghiSegnalati % 100 === 0) {
    logger.warn('[ai] il conto della spesa non risponde: conto in memoria, il tetto vero e piu alto', {
      motivo,
      giorno,
      ripieghi: _ripieghiSegnalati,
    });
  }
}

type RispostaRpc = { data: unknown; error: { message?: string } | null };

/**
 * Quando il conto condiviso non c'e' — migrazione non ancora applicata, chiave
 * di servizio assente, database irraggiungibile — non ha senso ritentare a ogni
 * chiamata al modello: sarebbe un giro di rete buttato su OGNI richiesta, e in
 * un momento in cui il database sta gia' soffrendo. Dopo qualche tentativo
 * andato a vuoto si sospende per cinque minuti e si conta in memoria; poi si
 * riprova, perche' il guasto puo' essere passato.
 */
const FALLIMENTI_PRIMA_DI_SOSPENDERE = 3;
const PAUSA_MS = 5 * 60_000;
let fallimentiDiFila = 0;
let riprovaDopo = 0;

function contoCondivisoSospeso(): boolean {
  if (riprovaDopo === 0) return false;
  if (Date.now() < riprovaDopo) return true;
  // Scaduta la pausa: si riparte da capo col conteggio dei fallimenti.
  riprovaDopo = 0;
  fallimentiDiFila = 0;
  return false;
}

function segnaEsito(riuscito: boolean): void {
  if (riuscito) {
    fallimentiDiFila = 0;
    riprovaDopo = 0;
    return;
  }
  fallimentiDiFila++;
  if (fallimentiDiFila >= FALLIMENTI_PRIMA_DI_SOSPENDERE) riprovaDopo = Date.now() + PAUSA_MS;
}

async function chiamaRpc(nome: string, args: Record<string, unknown>): Promise<number | null> {
  if (contoCondivisoSospeso()) return null;
  try {
    const admin = getAdminSupabase();
    const { data, error } = (await admin.rpc(nome, args)) as unknown as RispostaRpc;
    if (error) {
      segnaEsito(false);
      return null;
    }
    const n = Number(data);
    if (!Number.isFinite(n)) {
      segnaEsito(false);
      return null;
    }
    segnaEsito(true);
    return n;
  } catch {
    segnaEsito(false);
    return null;
  }
}

/** Quanti centesimi sono usciti oggi, contando TUTTE le copie del sito. */
export async function spesaDiOggiCents(quando?: Date): Promise<number> {
  const giorno = giornoDiSpesa(quando);
  const condiviso = await chiamaRpc('spesa_ai_di_oggi', { p_giorno: giorno });
  if (condiviso === null) {
    segnalaRipiego('lettura del conto condiviso non riuscita', giorno);
    return ripiegoCents(giorno);
  }
  // Il ripiego non si butta: se il database torna a tacere piu' avanti, si
  // riparte dall'ultimo numero noto invece che da zero.
  _ripiego.giorno = giorno;
  _ripiego.cents = Math.max(_ripiego.cents, condiviso);
  return condiviso;
}

/** Aggiunge una spesa al conto del giorno. Non lancia mai. */
export async function aggiungiSpesaCents(cents: number, quando?: Date): Promise<void> {
  if (!Number.isFinite(cents) || cents <= 0) return;
  const giorno = giornoDiSpesa(quando);
  const arrotondati = Math.max(1, Math.round(cents));
  const totale = await chiamaRpc('registra_spesa_ai', { p_giorno: giorno, p_cents: arrotondati });
  if (totale === null) {
    segnalaRipiego('registrazione della spesa non riuscita', giorno);
    _ripiego.cents = ripiegoCents(giorno) + arrotondati;
    return;
  }
  _ripiego.giorno = giorno;
  _ripiego.cents = Math.max(_ripiego.cents, totale);
}

/** Da euro a centesimi, senza perdere le chiamate che costano pochissimo. */
export function euroInCents(eur: number): number {
  if (!Number.isFinite(eur) || eur <= 0) return 0;
  return Math.max(1, Math.round(eur * 100));
}
