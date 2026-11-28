// lib/ai/tettoSpesa.ts
import { logger } from '@/lib/logger';
import { getAdminSupabase } from '@/lib/supabase/server';
import { AI_NEGOZI_ACCESA } from '@/lib/funzioni-al-lancio';
import {
  RIPIEGO_TOLLERATO_MINUTI as TOLLERANZA_RIPIEGO_MINUTI,
  allarmiTettoSpesaAi as allarmiDelTetto,
  leggiCopieAttese as copieDaAmbiente,
  type AllarmeTetto,
} from '@/lib/ai/decisioneTettoSpesa';

/**
 * 8/9/2026 (lotto gravi, corsia 11) — QUI STA DOVE IL NUMERO E' CONSERVATO.
 * La decisione «posso ancora spendere?» sta invece in
 * `lib/ai/decisioneTettoSpesa.ts`, che non importa niente e si puo' ESEGUIRE in
 * una prova. Erano la stessa cosa, e la parte che decide non si poteva provare
 * senza un database finto.
 */
export {
  euroInCents,
  decidiSpesaAi,
  allarmiTettoSpesaAi,
  leggiCopieAttese,
  ripiegoDurevole,
  COPIE_ATTESE_PREDEFINITE,
  RIPIEGO_TOLLERATO_MINUTI,
  TIPO_ALLARME_TETTO_AI,
} from '@/lib/ai/decisioneTettoSpesa';
export type { ContoCondivisoStato, DecisioneSpesa, AllarmeTetto } from '@/lib/ai/decisioneTettoSpesa';

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
 * migrazione non ancora applicata — sul computer di chi sviluppa si continua a
 * contare in memoria, perche' li' la copia e' una sola, ma lo si DICE nei
 * registri: un ripiego silenzioso e' peggio del guasto, perche' nessuno sa che
 * il tetto vero non e' piu' quello scritto. In rete il conto in memoria non
 * vale come tetto: vedi `contoCondivisoObbligatorio` qui sotto.
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
 * 27/11/2026 — IN RETE IL CONTO IN MEMORIA NON E' UN TETTO.
 *
 * In produzione il conto condiviso non c'e' (migrazione 131 mai applicata la')
 * e ogni copia ripiegava sul suo contatore in memoria. La quota divisa per
 * `AI_COPIE_ATTESE` non bastava: su Vercel le copie sono quante ne servono e
 * ogni risveglio nasce col contatore a zero, quindi la somma passava il tetto.
 *
 * Adesso, in una build di produzione (Vercel, anteprime comprese), se il conto
 * condiviso non si legge, o la spesa di questa copia non ci si scrive, quanto si
 * e' speso oggi e' «non lo so» (`NaN`): `decidiSpesaAi` lo tratta come «basta»
 * (`spesa_sconosciuta`) e l'AI a pagamento si ferma, uguale per tutte le copie,
 * finche' il conto non risponde. Con `next dev` (anche sotto `vercel dev`) e
 * nelle prove la copia e' una sola: li' il contatore in memoria E' il conto del
 * sito, e il ripiego resta com'era.
 */
function contoCondivisoObbligatorio(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV !== 'development';
}

/**
 * In rete: la spesa che questa copia ha fatto ma non e' riuscita a scrivere nel
 * conto condiviso. Le altre copie non la vedono, quindi prima di leggere il
 * conto la si scrive; finche' non ci si riesce, la spesa di oggi e' «non lo so».
 */
const _daScrivere = { giorno: '', cents: 0 };
let _scritturaInVolo: Promise<boolean> | null = null;

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

/**
 * La riga che ricorda, per TUTTE le copie, quando e' partito l'ultimo `error` del ripiego.
 * Sta nella tabella che il cron degli avvisi usa gia' (`operational_alert_log`): nessuna
 * tabella nuova. Una riga sola, che si aggiorna: chi la aggiorna per primo in quell'ora parla.
 */
export const CHIAVE_ERRORE_RIPIEGO = 'ai-tetto-condiviso:errore-ripiego';

/**
 * Il freno «un `error` all'ora» non puo' vivere solo nella memoria della copia: su Vercel
 * ogni giro del cron nasce su una copia nuova, che crede di non aver mai parlato. Prima di
 * parlare si chiede alla riga condivisa se qualcuno ha gia' parlato nell'ultima ora.
 * Se la riga non risponde si parla comunque: meglio un doppione che il silenzio.
 */
async function nessunoHaParlatoNellOra(adesso: number): Promise<boolean> {
  try {
    const admin = getAdminSupabase();
    const ora = new Date(adesso).toISOString();
    const nuova = await admin
      .from('operational_alert_log')
      .upsert({ alert_key: CHIAVE_ERRORE_RIPIEGO, last_sent_at: ora }, { onConflict: 'alert_key', ignoreDuplicates: true })
      .select('alert_key');
    if (nuova.error) return true;
    if ((nuova.data ?? []).length > 0) return true;
    const presa = await admin
      .from('operational_alert_log')
      .update({ last_sent_at: ora })
      .eq('alert_key', CHIAVE_ERRORE_RIPIEGO)
      .lt('last_sent_at', new Date(adesso - RIPETI_ALLARME_MS).toISOString())
      .select('alert_key');
    if (presa.error) return true;
    if ((presa.data ?? []).length > 0) return true;
    // La pulizia della memoria degli allarmi (migrazione 660) scatta anche sull'inserimento che
    // non inserisce niente e toglie le righe di piu' di 24 ore: la riga vecchia sparisce fra
    // l'inserimento e l'aggiornamento, che allora non trova niente. «Nessuna riga» non vuol dire
    // «qualcuno ha gia' parlato»: si riprova a scriverla, e chi la scrive parla.
    const dinuovo = await admin
      .from('operational_alert_log')
      .upsert({ alert_key: CHIAVE_ERRORE_RIPIEGO, last_sent_at: ora }, { onConflict: 'alert_key', ignoreDuplicates: true })
      .select('alert_key');
    if (dinuovo.error) return true;
    return (dinuovo.data ?? []).length > 0;
  } catch {
    return true;
  }
}

/** Solo per le prove: rimette a zero il contatore di ripiego. */
export function __azzeraRipiegoSpesaAi(): void {
  _ripiego.giorno = '';
  _ripiego.cents = 0;
  _ripieghiSegnalati = 0;
  _daScrivere.giorno = '';
  _daScrivere.cents = 0;
  _scritturaInVolo = null;
  fallimentiDiFila = 0;
  riprovaDopo = 0;
  _stato.ripiegoDa = 0;
  _stato.dettoAlle = 0;
  _stato.permanente = false;
  _stato.motivo = '';
  _prenotazioneAssenteDetta = 0;
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
async function segnalaRipiego(motivo: string, giorno: string, adesso: number = Date.now()): Promise<void> {
  _ripieghiSegnalati++;
  if (_stato.ripiegoDa === 0) _stato.ripiegoDa = adesso;
  // Il motivo NON si sovrascrive qui: `chiamaRpc` ci ha appena messo le parole
  // vere del database («Could not find the function…»), e questa e' la frase
  // generica di chi sta a valle. Rimpiazzarla rifarebbe il difetto di prima —
  // buttare via l'unica informazione utile — un piano piu' su.
  if (!_stato.motivo) _stato.motivo = motivo;
  // In rete il ripiego non conta per copia: l'AI a pagamento e' ferma, e il registro dice quello.
  const fermo = contoCondivisoObbligatorio();

  if (_stato.permanente) {
    if (adesso - _stato.dettoAlle < RIPETI_ALLARME_MS) return;
    _stato.dettoAlle = adesso;
    if (!(await nessunoHaParlatoNellOra(adesso))) return;
    logger.error(
      fermo
        ? '[ai] il conto della spesa condiviso NON ESISTE: l AI a pagamento resta ferma finche non risponde. Applicare la migrazione 131.'
        : '[ai] il conto della spesa condiviso NON ESISTE: il tetto giornaliero vale per copia, non per il sito. Applicare la migrazione 131.',
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
  // 1/11/2026 (ondata 7) — UN GUASTO CHE DURA NON E' PIU' UN GUASTO.
  // Oltre l'ora di tolleranza `decidiSpesaAi` tratta il ripiego come durevole
  // e stringe la quota di questa copia; il registro invece restava a un `warn`
  // ogni cento chiamate per sempre. Il tetto cambiava e nessuno lo sapeva.
  // Adesso, passata l'ora, e' un `error` (Sentry) una volta per finestra.
  const daMinuti = Math.floor((adesso - _stato.ripiegoDa) / 60_000);
  if (daMinuti > TOLLERANZA_RIPIEGO_MINUTI) {
    if (adesso - _stato.dettoAlle < RIPETI_ALLARME_MS) return;
    _stato.dettoAlle = adesso;
    if (!(await nessunoHaParlatoNellOra(adesso))) return;
    logger.error(
      fermo
        ? '[ai] il conto della spesa condiviso non risponde da oltre un ora: l AI a pagamento resta ferma finche non risponde.'
        : '[ai] il conto della spesa condiviso non risponde da oltre un ora: il tetto giornaliero vale per copia, non per il sito (quota ridotta per copia).',
      { motivo, detto_dal_database: _stato.motivo, giorno, daMinuti, ripieghi: _ripieghiSegnalati },
    );
    return;
  }
  if (_ripieghiSegnalati === 1 || _ripieghiSegnalati % 100 === 0) {
    const testo = fermo
      ? '[ai] il conto della spesa non risponde: l AI a pagamento si ferma finche non risponde'
      : '[ai] il conto della spesa non risponde: conto in memoria, il tetto vero e piu alto';
    logger.warn(testo, {
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

/** Il giro di rete vero, senza il cancello della pausa. Lo usa anche la sonda. */
async function eseguiRpc(nome: string, args: Record<string, unknown>): Promise<number | null> {
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

/** Come sopra, ma rispetta la pausa: e' la strada di chi sta per spendere. */
async function chiamaRpc(nome: string, args: Record<string, unknown>): Promise<number | null> {
  if (contoCondivisoSospeso()) return null;
  return eseguiRpc(nome, args);
}

/**
 * Scrive il resto nel conto condiviso; vero se ci e' riuscita. Una scrittura
 * alla volta (le letture parallele aspettano quella, se no il resto entra due
 * volte) e si toglie solo quanto si e' scritto: una spesa non scritta arrivata
 * intanto resta da scrivere.
 */
function scriviResto(): Promise<boolean> {
  if (_scritturaInVolo) return _scritturaInVolo;
  const { giorno, cents } = _daScrivere;
  _scritturaInVolo = chiamaRpc('registra_spesa_ai', { p_giorno: giorno, p_cents: cents })
    .then((totale) => {
      if (totale === null) return false;
      // Intanto una prenotazione restituita puo' averne gia' coperta una parte
      // (`prenotaSpesaNelContoCondiviso`): mai sotto zero.
      _daScrivere.cents = Math.max(0, _daScrivere.cents - cents);
      return true;
    })
    .finally(() => {
      _scritturaInVolo = null;
    });
  return _scritturaInVolo;
}

/**
 * Quanti centesimi sono usciti oggi, contando TUTTE le copie del sito.
 * In rete, se il conto condiviso non risponde, `NaN`: «non lo so».
 */
export async function spesaDiOggiCents(quando?: Date): Promise<number> {
  const giorno = giornoDiSpesa(quando);
  const inRete = contoCondivisoObbligatorio();
  // In rete la spesa che questa copia non e' riuscita a scrivere va nel conto
  // condiviso PRIMA di leggerlo, anche quella arrivata durante la scrittura.
  while (inRete && _daScrivere.cents > 0) {
    if (!(await scriviResto())) {
      await segnalaRipiego('registrazione della spesa non riuscita', giorno);
      return Number.NaN;
    }
  }
  const condiviso = await chiamaRpc('spesa_ai_di_oggi', { p_giorno: giorno });
  if (condiviso === null) {
    await segnalaRipiego('lettura del conto condiviso non riuscita', giorno);
    // In rete il contatore di una copia non e' il conto del sito: «non lo so».
    return inRete ? Number.NaN : ripiegoCents(giorno);
  }
  // Il ripiego non si butta: se il database torna a tacere piu' avanti, si
  // riparte dall'ultimo numero noto invece che da zero.
  // ripiegoCents azzera il numero se il giorno e' cambiato: la spesa di ieri
  // non deve diventare quella di oggi.
  _ripiego.cents = Math.max(ripiegoCents(giorno), condiviso);
  return condiviso;
}

/**
 * 12/11/2026 (R04-017, revisione K02) — L'ULTIMO TOTALE CHE QUESTA COPIA CONOSCE.
 *
 * Una lettura del conto partita prima puo' arrivare dopo che un'altra chiamata
 * ha gia' speso e registrato: il numero letto e' vecchio. Chi decide prende il
 * piu' alto fra la lettura e questo, che sale a ogni registrazione e lettura.
 */
export function ultimaSpesaNotaCents(quando?: Date): number {
  return ripiegoCents(giornoDiSpesa(quando));
}

/** Aggiunge una spesa al conto del giorno. Non lancia mai. */
export async function aggiungiSpesaCents(cents: number, quando?: Date): Promise<void> {
  if (!Number.isFinite(cents) || cents <= 0) return;
  const giorno = giornoDiSpesa(quando);
  const arrotondati = Math.max(1, Math.round(cents));
  const totale = await chiamaRpc('registra_spesa_ai', { p_giorno: giorno, p_cents: arrotondati });
  if (totale === null) {
    // In rete la spesa non scritta resta da scrivere: la prossima lettura la
    // scrive prima di leggere, e finche' non ci riesce l'AI di questa copia e'
    // ferma. Un resto di ieri passa su oggi: contato in piu', mai in meno.
    if (contoCondivisoObbligatorio()) {
      _daScrivere.giorno = giorno;
      _daScrivere.cents += arrotondati;
    }
    await segnalaRipiego('registrazione della spesa non riuscita', giorno);
    _ripiego.cents = ripiegoCents(giorno) + arrotondati;
    return;
  }
  _ripiego.cents = Math.max(ripiegoCents(giorno), totale);
}

/**
 * 28/11/2026 (R02-002, onda 2) — IN RETE LA STIMA SI SCRIVE NEL CONTO PRIMA DELLA CHIAMATA.
 *
 * Il controllo leggeva il conto condiviso e confrontava col tetto; la spesa vera
 * entrava nel conto solo a chiamata finita. In mezzo ogni copia vedeva soltanto
 * le sue chiamate in volo (Upstash a parte): tre copie che partivano insieme
 * leggevano lo stesso numero e passavano tutte fino al tetto, e con la scrittura
 * del conto rotta e la lettura viva una copia nuova si fermava solo dopo la
 * prima scrittura fallita, a chiamata finita (tetto 1 €, tre copie da duecento
 * chiamate parallele: 1,725 € spesi e il conto a zero).
 *
 * Adesso, in rete, prima della chiamata la stima entra nel conto del giorno con
 * un passo solo del database che controlla il tetto e scrive (`prenota_spesa_ai`):
 * di due copie quella che arriva seconda vede la prima. Se la scrittura non
 * riesce l'AI a pagamento non parte (`guasto`), come quando il conto non si
 * legge. A chiamata finita, registrata la spesa vera, la stima si toglie
 * (`restituisci_spesa_ai`); se non si toglie il conto resta piu' alto del vero,
 * mai piu' basso. Una spesa vera che non si e' potuta scrivere la copre la
 * prenotazione gia' scritta: quella parte non si toglie.
 *
 * Senza la funzione nel database (la migrazione non ancora applicata) si torna
 * alla strada di prima (`assente`): stessa protezione di ieri, non meno. Sul
 * computer di chi sviluppa e nelle prove la copia e' una sola: `non_serve`.
 */
export type PrenotazioneNelConto =
  | { esito: 'non_serve' }
  | { esito: 'assente' }
  | { esito: 'guasto' }
  | { esito: 'tetto' }
  | { esito: 'prenotata'; restituisci: () => Promise<void> };

/** L'ultima volta che si e' detto che la funzione della prenotazione manca (un `error` all'ora). */
let _prenotazioneAssenteDetta = 0;

export async function prenotaSpesaNelContoCondiviso(
  stimaCents: number,
  tettoCents: number,
  quando?: Date,
): Promise<PrenotazioneNelConto> {
  if (!contoCondivisoObbligatorio()) return { esito: 'non_serve' };
  const giorno = giornoDiSpesa(quando);
  // Anche una chiamata senza stima prenota un centesimo: in rete si parte solo
  // se il conto condiviso accetta una scrittura.
  const cents = Math.max(1, Math.ceil(Number.isFinite(stimaCents) ? stimaCents : 0));
  let risposta: RispostaRpc;
  try {
    risposta = (await getAdminSupabase().rpc('prenota_spesa_ai', {
      p_giorno: giorno,
      p_cents: cents,
      p_tetto_cents: Math.max(0, Math.floor(tettoCents)),
    })) as unknown as RispostaRpc;
  } catch (errore) {
    logger.warn('[ai] prenotazione della spesa non riuscita: l AI a pagamento non parte', {
      motivo: errore instanceof Error ? errore.message : String(errore),
    });
    return { esito: 'guasto' };
  }
  if (risposta.error) {
    if (assenzaPermanente(risposta.error)) {
      const adesso = Date.now();
      if (adesso - _prenotazioneAssenteDetta >= RIPETI_ALLARME_MS) {
        _prenotazioneAssenteDetta = adesso;
        logger.error(
          '[ai] la prenotazione della spesa nel conto condiviso NON ESISTE: le copie non vedono le chiamate in volo delle altre. Applicare la migrazione della prenotazione (999l).',
          { detto_dal_database: risposta.error.message ?? '' },
        );
      }
      return { esito: 'assente' };
    }
    logger.warn('[ai] prenotazione della spesa non riuscita: l AI a pagamento non parte', {
      motivo: risposta.error.message ?? '',
      codice: risposta.error.code ?? '',
    });
    return { esito: 'guasto' };
  }
  const totale = Number(risposta.data);
  if (!Number.isFinite(totale)) return { esito: 'guasto' };
  if (totale < 0) return { esito: 'tetto' };

  let restituita = false;
  return {
    esito: 'prenotata',
    restituisci: async () => {
      if (restituita) return;
      restituita = true;
      let daTogliere = cents;
      // La spesa vera che questa copia non e' riuscita a scrivere e' gia' nel
      // conto dentro la prenotazione: quella parte resta, e non e' piu' da scrivere.
      if (_daScrivere.cents > 0) {
        const coperti = Math.min(daTogliere, _daScrivere.cents);
        _daScrivere.cents -= coperti;
        daTogliere -= coperti;
      }
      if (daTogliere <= 0) return;
      try {
        const { error } = (await getAdminSupabase().rpc('restituisci_spesa_ai', {
          p_giorno: giorno,
          p_cents: daTogliere,
        })) as unknown as RispostaRpc;
        if (error) {
          logger.warn('[ai] prenotazione della spesa non restituita: il conto di oggi resta piu alto del vero', {
            giorno,
            cents: daTogliere,
            motivo: error.message ?? '',
          });
        }
      } catch (errore) {
        logger.warn('[ai] prenotazione della spesa non restituita: il conto di oggi resta piu alto del vero', {
          giorno,
          cents: daTogliere,
          motivo: errore instanceof Error ? errore.message : String(errore),
        });
      }
    },
  };
}

/**
 * LA SONDA: il conto condiviso c'e' o no, chiesto adesso al database.
 *
 * Serve a chi sorveglia da un'altra copia. `statoContoCondiviso()` racconta
 * quello che ha visto QUESTA copia servendo le richieste AI; ma il lavoro
 * periodico degli avvisi gira su una copia diversa, che di quelle richieste non
 * sa niente e nasce col contatore pulito. Chiedendolo al database la risposta
 * vale da qualunque copia: se la funzione non esiste, non esiste per nessuno.
 *
 * Non passa dalla pausa del circuito (`contoCondivisoSospeso`): quella serve a
 * non buttare un giro di rete su OGNI chiamata al modello, mentre qui il giro
 * di rete e' esattamente il lavoro — una volta ogni passata del cron.
 */
export async function sondaContoCondiviso(
  quando?: Date,
  /**
   * 12/11/2026 (R04-018) — Da quando il guasto e' noto, detto da chi lo ricorda
   * FUORI dalla memoria di questa copia (es. la prima riga d'allarme salvata dal
   * cron). Senza, l'ora di tolleranza ripartiva da zero a ogni copia nuova e su
   * Vercel, dove le copie vivono poco, l'allarme poteva non arrivare mai.
   */
  ripiegoNotoDaMs?: number,
): Promise<{
  condiviso: boolean;
  permanente: boolean;
  motivo: string;
  daMinuti: number;
}> {
  const giorno = giornoDiSpesa(quando);
  const letto = await eseguiRpc('spesa_ai_di_oggi', { p_giorno: giorno });
  if (letto === null) {
    const adesso = Date.now();
    if (
      typeof ripiegoNotoDaMs === 'number' &&
      Number.isFinite(ripiegoNotoDaMs) &&
      ripiegoNotoDaMs > 0 &&
      ripiegoNotoDaMs <= adesso &&
      (_stato.ripiegoDa === 0 || ripiegoNotoDaMs < _stato.ripiegoDa)
    ) {
      _stato.ripiegoDa = ripiegoNotoDaMs;
    }
    await segnalaRipiego('sonda del conto condiviso non riuscita', giorno, adesso);
  }
  return statoContoCondiviso();
}

/**
 * 12/11/2026 (R04-018, revisione K02) — L'ALLARME DEL TETTO PRONTO PER IL CRON.
 *
 * L'ora di tolleranza si contava dalla memoria della copia che serve le
 * richieste AI: su Vercel le copie vivono poco e l'allarme poteva non arrivare
 * mai. Qui l'inizio del guasto si ricorda nel database, nella tabella che il
 * cron degli avvisi usa gia' (`operational_alert_log`, colonne `alert_key` e
 * `last_sent_at`): una riga dedicata, scritta solo la PRIMA volta che il conto
 * non risponde (upsert che ignora i doppioni) e tolta quando risponde di nuovo.
 * Il cron deve solo fare `alerts.push(...(await allarmiTettoSpesaAiPerIlCron()))`.
 */
export const CHIAVE_RIPIEGO_DA = 'ai-tetto-condiviso:ripiego-da';

export async function allarmiTettoSpesaAiPerIlCron(opzioni: {
  tettoEur?: number;
  copieAttese?: number;
  quando?: Date;
} = {}): Promise<AllarmeTetto[]> {
  const allarmi = allarmiDelTetto;
  const copie = copieDaAmbiente;
  const tettoEur = opzioni.tettoEur ?? Number(process.env.AI_GLOBAL_DAILY_BUDGET_EUR ?? 0);
  // 22/11/2026 (R13-004) — Il cron la chiama a ogni giro (ogni 5 minuti). Senza
  // tetto configurato non c'e' niente da dire (allarmiDelTetto torna vuoto): niente
  // sonda, niente righe in operational_alert_log, niente errori nel registro.
  // Con l'AI dei negozi spenta (lib/funzioni-al-lancio.ts) lib/ai/client.ts ferma ogni chiamata
  // al modello: spendere e' impossibile, e l'allarme sul conto condiviso sarebbe solo rumore
  // sull'unico canale degli allarmi. Niente sonda e niente righe, come senza tetto.
  // R08-002: un giro che non guarda il conto non ne ricorda il guasto. Se la riga dell'inizio di
  // un guasto vecchio restasse, al primo guasto nuovo l'allarme direbbe «non risponde da tre
  // giorni». Si toglie (best-effort); nessun limite d'eta': un guasto vero lungo conta tutti i suoi minuti.
  if (!(tettoEur > 0) || !AI_NEGOZI_ACCESA) {
    try {
      await getAdminSupabase().from('operational_alert_log').delete().eq('alert_key', CHIAVE_RIPIEGO_DA);
    } catch {
      // Se non si cancella, resta com'era: nessun danno nuovo.
    }
    return [];
  }
  const copieAttese = opzioni.copieAttese ?? copie(process.env.AI_COPIE_ATTESE);
  // In rete, senza conto condiviso, l'AI si ferma: l'allarme non parla di quota per copia.
  const fermoSenzaConto = contoCondivisoObbligatorio();
  const primo = await sondaContoCondiviso(opzioni.quando);
  try {
    const admin = getAdminSupabase();
    if (primo.condiviso) {
      await admin.from('operational_alert_log').delete().eq('alert_key', CHIAVE_RIPIEGO_DA);
      return allarmi(primo, { tettoEur, copieAttese, fermoSenzaConto });
    }
    await admin
      .from('operational_alert_log')
      .upsert({ alert_key: CHIAVE_RIPIEGO_DA, last_sent_at: new Date().toISOString() }, { onConflict: 'alert_key', ignoreDuplicates: true });
    const { data } = await admin
      .from('operational_alert_log')
      .select('last_sent_at')
      .eq('alert_key', CHIAVE_RIPIEGO_DA)
      .maybeSingle();
    const da = data && typeof (data as { last_sent_at?: unknown }).last_sent_at === 'string'
      ? Date.parse((data as { last_sent_at: string }).last_sent_at)
      : NaN;
    const conto = Number.isFinite(da) ? await sondaContoCondiviso(opzioni.quando, da) : primo;
    return allarmi(conto, { tettoEur, copieAttese, fermoSenzaConto });
  } catch {
    // Se anche questa tabella non risponde, vale quello che sa la copia.
    return allarmi(primo, { tettoEur, copieAttese, fermoSenzaConto });
  }
}
