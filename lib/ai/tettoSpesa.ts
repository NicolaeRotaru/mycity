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

/**
 * 3/9/2026 (R-lotto) — IL RIPIEGO ERA NATO PER UN'ASSENZA DI MINUTI E IN
 * PRODUZIONE DURAVA DA SEMPRE.
 *
 * In produzione le due funzioni del conto condiviso non ci sono (la migrazione
 * 131 non e' mai stata applicata la'). Ogni chiamata falliva, ogni chiamata
 * ripiegava sul contatore in memoria della singola copia, e il tetto
 * `AI_GLOBAL_DAILY_BUDGET_EUR` tornava a essere quello che il commento in cima
 * a questo file dichiara inaccettabile: venti euro PER COPIA.
 *
 * Perche' nessuno se ne accorgeva: `chiamaRpc` buttava via il messaggio
 * dell'errore. Con quel messaggio in mano le due situazioni si distinguono a
 * occhio, e sono opposte:
 *
 * · «database irraggiungibile» → passa da solo. Ripiegare e' giusto.
 * · «questa funzione non esiste» → non passa MAI da solo. Ripiegare per sempre
 *   vuol dire che il tetto scritto nella variabile d'ambiente e' una promessa
 *   che il codice non mantiene, e nessuno lo sa.
 *
 * Il codice buttava via l'unico dato che le separa. Adesso lo tiene, lo dice
 * col registro giusto (un'assenza permanente e' `error`, non un `warn` ogni
 * cento), e lo espone con `statoContoCondiviso()` perche' un allarme possa
 * diventare rosso quando il ripiego dura da piu' di un'ora.
 */
const _stato = {
  /** Da quando il conto condiviso non risponde. 0 = risponde. */
  ripiegoDa: 0,
  /** L'ultima volta che l'abbiamo detto forte. */
  dettoAlle: 0,
  /** Vero quando l'errore dice che il conto condiviso non esiste proprio. */
  permanente: false,
  /** Il messaggio vero del database, per chi legge i registri. */
  motivo: '',
};

/** Ogni quanto si ripete l'allarme, quando l'assenza non passa. */
const RIPETI_ALLARME_MS = 60 * 60_000;

/** Solo per le prove: rimette a zero il contatore di ripiego. */
export function __azzeraRipiegoSpesaAi(): void {
  _ripiego.giorno = '';
  _ripiego.cents = 0;
  _ripieghiSegnalati = 0;
  fallimentiDiFila = 0;
  riprovaDopo = 0;
  _stato.ripiegoDa = 0;
  _stato.dettoAlle = 0;
  _stato.permanente = false;
  _stato.motivo = '';
}

/**
 * Com'e' messo il conto condiviso, adesso. Serve a chi sorveglia: un ripiego
 * che dura da piu' di un'ora e' un allarme, perche' vuol dire che il tetto
 * giornaliero non e' piu' quello scritto.
 */
export function statoContoCondiviso(adesso: number = Date.now()): {
  condiviso: boolean;
  permanente: boolean;
  motivo: string;
  daMinuti: number;
} {
  if (_stato.ripiegoDa === 0) {
    return { condiviso: true, permanente: false, motivo: '', daMinuti: 0 };
  }
  return {
    condiviso: false,
    permanente: _stato.permanente,
    motivo: _stato.motivo,
    daMinuti: Math.floor((adesso - _stato.ripiegoDa) / 60_000),
  };
}

/**
 * L'errore dice che il conto condiviso NON ESISTE (funzione o tabella
 * mancante), non che il database e' occupato o irraggiungibile.
 *
 * PostgREST risponde `PGRST202` quando non trova la funzione e `PGRST205`
 * quando non trova la tabella; Postgres usa `42883` e `42P01` per le stesse due
 * cose. Il testo lo si guarda lo stesso, perche' il codice non arriva sempre.
 */
export function assenzaPermanente(errore: { code?: string; message?: string } | null): boolean {
  if (!errore) return false;
  const codice = errore.code ?? '';
  if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(codice)) return true;
  const testo = (errore.message ?? '').toLowerCase();
  return (
    testo.includes('could not find the function') ||
    testo.includes('does not exist') ||
    testo.includes('schema cache')
  );
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
 * tace, tace per tutte.
 *
 * Ma un guasto di passaggio e un conto che non esiste non si dicono nello
 * stesso modo. Il primo e' un `warn` ogni cento chiamate: passera'. Il secondo
 * e' un `error` ripetuto ogni ora finche' dura, perche' finche' dura il tetto
 * giornaliero del sito NON e' quello scritto — e la prima notizia, altrimenti,
 * arriva con la fattura.
 */
function segnalaRipiego(motivo: string, giorno: string, adesso: number = Date.now()): void {
  _ripieghiSegnalati++;
  if (_stato.ripiegoDa === 0) _stato.ripiegoDa = adesso;
  // Il motivo NON si sovrascrive qui: `chiamaRpc` ci ha appena messo le parole
  // vere del database («Could not find the function…»), e questa e' la frase
  // generica di chi sta a valle. Rimpiazzarla rifarebbe il difetto di prima —
  // buttare via l'unica informazione utile — un piano piu' su.
  if (!_stato.motivo) _stato.motivo = motivo;

  if (_stato.permanente) {
    if (adesso - _stato.dettoAlle < RIPETI_ALLARME_MS) return;
    _stato.dettoAlle = adesso;
    logger.error(
      '[ai] il conto della spesa condiviso NON ESISTE: il tetto giornaliero vale per copia, non per il sito. Applicare la migrazione 131.',
      {
        motivo,
        detto_dal_database: _stato.motivo,
        giorno,
        daMinuti: Math.floor((adesso - _stato.ripiegoDa) / 60_000),
        ripieghi: _ripieghiSegnalati,
      },
    );
    return;
  }
  if (_ripieghiSegnalati === 1 || _ripieghiSegnalati % 100 === 0) {
    logger.warn('[ai] il conto della spesa non risponde: conto in memoria, il tetto vero e piu alto', {
      motivo,
      giorno,
      ripieghi: _ripieghiSegnalati,
    });
  }
}

type RispostaRpc = { data: unknown; error: { code?: string; message?: string } | null };

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
    // Il conto condiviso ha risposto: il ripiego e' finito, e l'allarme con lui.
    _stato.ripiegoDa = 0;
    _stato.dettoAlle = 0;
    _stato.permanente = false;
    _stato.motivo = '';
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
      // Il messaggio non si butta: e' l'unica cosa che distingue «il database e'
      // occupato adesso» da «questo conto qui non esiste». Prima finiva nel
      // cestino, e le due cose diventavano la stessa riga di registro.
      if (assenzaPermanente(error)) _stato.permanente = true;
      _stato.motivo = error.message ?? `${nome}: errore senza messaggio`;
      segnaEsito(false);
      return null;
    }
    const n = Number(data);
    if (!Number.isFinite(n)) {
      _stato.motivo = `${nome} ha risposto qualcosa che non e un numero`;
      segnaEsito(false);
      return null;
    }
    segnaEsito(true);
    return n;
  } catch (errore) {
    _stato.motivo = errore instanceof Error ? errore.message : String(errore);
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
