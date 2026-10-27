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
import { sendEmail } from '@/lib/email/client';
import { escapeHtml } from '@/lib/html-escape';
import { indirizzoPubblico } from '@/lib/env';

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
  /**
   * Avvisi scritti nel pannello ma NON partiti anche per email stanotte (posta
   * spenta, indirizzo mancante, invio rifiutato, registro degli invii che non
   * si legge). L'avviso dovuto c'è; manca il canale che lo porta fuori dal
   * sito. L'email resta dovuta: la notte dopo si riprova (`emailDovuta`).
   */
  emailNonPartite: number;
  /**
   * Di quelle, le email che non si sistemano da sole: non partite di nuovo
   * (dal secondo tentativo in poi), oppure non tentate perché il registro
   * degli invii non si legge. Qui si sveglia qualcuno: chi chiama rende rossa
   * la notte, come per `falliti`.
   */
  emailBloccate: number;
  /**
   * 27/10/2026 (quarto giro) — Quali avvisi hanno l'email ferma: i loro
   * identificativi. Chi chiama ne fa UN allarme per avviso, non uno a notte.
   */
  emailBloccateAvvisi: string[];
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
 * `falliti` e `emailBloccate`.
 */
export async function recapitaAvvisi(
  admin: ClienteAvvisi,
  avvisi: AvvisoAllInteressato[],
  registro: RegistroAvvisi,
  posta?: PostaAvvisi,
  /** L'ora del giro: decide se un nuovo tentativo d'invio tocca a questa notte. */
  adesso: number = Date.now(),
): Promise<RapportoAvvisi> {
  const rapporto: RapportoAvvisi = {
    recapitati: 0, giaDetti: 0, falliti: 0, emailNonPartite: 0, emailBloccate: 0, emailBloccateAvvisi: [], esiti: [],
  };

  for (const a of avvisi) {
    const id = identificativoAvviso(a.chiave);
    try {
      if (await giaNelPannello(admin, id)) {
        rapporto.giaDetti++;
        rapporto.esiti.push({ chiave: a.chiave, esito: 'gia-detto' });
      } else if (await scrittoOraNelPannello(admin, a, id)) {
        rapporto.recapitati++;
        rapporto.esiti.push({ chiave: a.chiave, esito: 'recapitato' });
        registro.info('[avvisi-cancellazione] risposta recapitata all interessato', {
          userId: a.userId, tappa: a.tappa,
        });
      } else {
        // Due giri partiti insieme: il secondo trova la chiave primaria
        // occupata. Non è un guasto, è il freno che ha funzionato.
        rapporto.giaDetti++;
        rapporto.esiti.push({ chiave: a.chiave, esito: 'gia-detto' });
      }
    } catch (e) {
      const errore = e instanceof Error ? e.message : 'errore';
      rapporto.falliti++;
      rapporto.esiti.push({ chiave: a.chiave, esito: 'fallito', errore });
      // Una risposta dovuta per legge che non parte non può restare nei log e
      // basta: chi chiama rende rossa la notte e sveglia un amministratore.
      registro.error('[avvisi-cancellazione] la persona non e stata avvisata', {
        userId: a.userId, tappa: a.tappa, errore,
      });
      continue;
    }

    // 27/10/2026 (terzo giro) — L'EMAIL È DOVUTA FINCHÉ NON RISULTA PARTITA.
    // Prima partiva solo nel ramo «scritto ora»: se quella notte la posta
    // diceva di no, dalla notte dopo l'avviso era «già detto» e l'email non
    // ripartiva mai più. Adesso l'email ha il suo lucchetto (`emailDovuta`) e
    // vale per ogni avviso che è nel pannello, scritto stanotte o prima.
    if (posta) {
      const email = await emailDovuta(admin, posta, a, id, registro, adesso);
      if (email === 'non-partita' || email === 'bloccata') rapporto.emailNonPartite++;
      if (email === 'bloccata') {
        rapporto.emailBloccate++;
        rapporto.emailBloccateAvvisi.push(id);
      }
    }
  }

  return rapporto;
}

/** Vero se l'avviso è già nel pannello della persona. Lancia se non si legge. */
async function giaNelPannello(admin: ClienteAvvisi, id: string): Promise<boolean> {
  const gia = await admin.from('notifications').select('id').eq('id', id);
  if (gia.error) throw new Error(gia.error.message);
  return Array.isArray(gia.data) && gia.data.length > 0;
}

/**
 * Scrive l'avviso nel pannello. `false` se un altro giro l'ha scritto un attimo
 * prima (la chiave primaria dice di no); lancia per ogni altro rifiuto.
 */
async function scrittoOraNelPannello(
  admin: ClienteAvvisi,
  a: AvvisoAllInteressato,
  id: string,
): Promise<boolean> {
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
  if (!scritto.error) return true;
  if (eUnDoppione(scritto.error.message)) return false;
  throw new Error(scritto.error.message);
}

/**
 * 27/10/2026 (secondo giro) — IL SECONDO CANALE: L'EMAIL.
 *
 * La spiegazione scritta solo nel pannello la legge chi rientra nel sito. Ma
 * chi ha chiesto di cancellarsi sta cercando di andarsene: può non rientrare
 * mai. Per questo la stessa spiegazione parte anche per email, una volta sola
 * — e se non parte, si riprova la notte dopo (`emailDovuta`).
 * Una prova passa una posta finta; la notte passa quella vera (`postaVera`).
 */
export type PostaAvvisi = {
  indirizzoDi(userId: string): Promise<string | null>;
  invia(lettera: { to: string; subject: string; html: string }): Promise<{ ok: boolean }>;
};

/**
 * 27/10/2026 (terzo giro) — IL LUCCHETTO DELL'EMAIL È SUO, NON QUELLO DEL PANNELLO.
 *
 * L'email partiva solo la notte in cui la notifica veniva scritta per la prima
 * volta. Se quella notte la posta diceva di no (Resend 503, posta spenta,
 * indirizzo che non si legge), dalla notte dopo l'avviso risultava «già detto»
 * e l'email non ripartiva mai più: trenta notti, zero email, notte verde.
 *
 * Adesso l'email ha il suo registro, nel registro delle azioni (`audit_logs`,
 * che scrive solo il client amministrativo): una riga per ogni tentativo e una
 * quando è partita, con l'identificativo dell'avviso in `target_id` e niente
 * dati della persona. Ogni notte:
 *  · se c'è «partita» non si fa niente: trenta notti restano UNA email;
 *  · altrimenti si prende il turno del tentativo N+1 scrivendone la riga.
 *    L'identificativo si ricava dalla chiave e da N, quindi due giri partiti
 *    insieme sbattono sulla chiave primaria e spedisce uno solo;
 *  · si spedisce, e solo se è partita si scrive «partita».
 * Un giro che cade a metà perde al massimo un tentativo: la notte dopo si
 * riprova. Il caso opposto — partita ma non segnata — rimanda la stessa
 * spiegazione una volta in più: meglio due volte che nessuna.
 *
 * `bloccata` è quella che sveglia qualcuno: non parte di nuovo (un intoppo di
 * una notte si sistema da solo, uno che si ripete no), oppure il registro non
 * si legge — e senza un posto dove segnare «partita», spedire vorrebbe dire
 * una email ogni notte.
 */
type EsitoEmail = 'partita' | 'gia-partita' | 'in-corso' | 'non-partita' | 'bloccata';

/**
 * 27/10/2026 (quarto giro) — UN TENTATIVO PER NOTTE, ANCHE CON DUE GIRI SFALSATI.
 *
 * Il lavoro notturno entra da due porte (il lavoro periodico di Vercel e il
 * cron esterno), a qualche minuto di distanza. Il turno del tentativo N+1 si
 * prendeva appena il tentativo N era nel registro, a qualunque ora: il secondo
 * giro vedeva il primo ancora in volo, prendeva il tentativo dopo e spediva.
 * La persona riceveva la stessa spiegazione due volte; e se l'invio del
 * secondo falliva, l'email risultava «ferma» — e un amministratore veniva
 * svegliato — già la prima notte.
 *
 * Adesso un tentativo nuovo si prende solo se l'ultimo è stato preso almeno
 * tante ore fa. Il lucchetto non lascia fessure: il giro che legge DOPO la
 * riga dell'altro la vede e si ferma (`in-corso`); il giro che legge PRIMA
 * calcola lo stesso tentativo, quindi lo stesso identificativo, e il database
 * ne accetta uno solo (chiave primaria).
 *
 * Perché 20: meno di un giorno, così ogni notte si riprova anche quando il
 * lavoro periodico arriva in anticipo (Vercel garantisce l'ora, non il minuto);
 * più di qualunque distanza tra i due giri della stessa notte.
 */
export const ORE_TRA_DUE_TENTATIVI = 20;
const ORA_MS = 3_600_000;

/** Quando è stato preso un tentativo; -Infinity se la riga non lo dice. */
function presoIl(metadata: unknown): number {
  const quando = Date.parse(String((metadata as { presoIl?: unknown } | null | undefined)?.presoIl ?? ''));
  return Number.isFinite(quando) ? quando : -Infinity;
}

const REGISTRO_INVII = 'audit_logs';
const EMAIL_TENTATA = 'privacy.avviso_cancellazione.email_tentata';
const EMAIL_PARTITA = 'privacy.avviso_cancellazione.email_partita';

/** Una riga del registro degli invii. Il giro notturno non è una persona: `actor_id` resta vuoto. */
function rigaDegliInvii(
  a: AvvisoAllInteressato,
  idAvviso: string,
  azione: string,
  quale: string,
  tentativo: number,
  adesso: number,
): Record<string, unknown> {
  return {
    id: identificativoAvviso(`${a.chiave}:email:${quale}`),
    actor_id: null,
    action: azione,
    target_table: 'notifications',
    target_id: idAvviso,
    metadata: { tappa: a.tappa, tentativo, presoIl: new Date(adesso).toISOString() },
  };
}

/** Porta fuori l'email di un avviso che è già nel pannello. Non lancia mai. */
async function emailDovuta(
  admin: ClienteAvvisi,
  posta: PostaAvvisi,
  a: AvvisoAllInteressato,
  idAvviso: string,
  registro: RegistroAvvisi,
  adesso: number,
): Promise<EsitoEmail> {
  let tentativo: number;
  try {
    const letto = await admin.from(REGISTRO_INVII).select('id, action, metadata').eq('target_id', idAvviso);
    if (letto.error) throw new Error(letto.error.message);
    const righe = (Array.isArray(letto.data) ? letto.data : []) as Array<{ action?: unknown; metadata?: unknown }>;
    if (righe.some((r) => r.action === EMAIL_PARTITA)) return 'gia-partita';
    const presi = righe.filter((r) => r.action === EMAIL_TENTATA);
    // Il tentativo di questa notte l'ha già preso un altro giro (in volo, o
    // finito male): non si rispedisce e non si conta come un no in più.
    const ultimo = Math.max(-Infinity, ...presi.map((r) => presoIl(r.metadata)));
    if (adesso - ultimo < ORE_TRA_DUE_TENTATIVI * ORA_MS) return 'in-corso';
    tentativo = presi.length + 1;

    const turno = await admin
      .from(REGISTRO_INVII)
      .insert([rigaDegliInvii(a, idAvviso, EMAIL_TENTATA, `tentativo:${tentativo}`, tentativo, adesso)]);
    if (turno.error) {
      // Un altro giro ha preso questo stesso tentativo un attimo prima: spedisce lui.
      if (eUnDoppione(turno.error.message)) return 'in-corso';
      throw new Error(turno.error.message);
    }
  } catch (e) {
    registro.error('[avvisi-cancellazione] registro degli invii non disponibile: l email non si tenta, per non spedirla ogni notte', {
      userId: a.userId, tappa: a.tappa, errore: e instanceof Error ? e.message : 'errore',
    });
    return 'bloccata';
  }

  if (!(await speditaAncheTramitePosta(posta, a, registro, tentativo))) {
    return tentativo > 1 ? 'bloccata' : 'non-partita';
  }

  try {
    const segno = await admin
      .from(REGISTRO_INVII)
      .insert([rigaDegliInvii(a, idAvviso, EMAIL_PARTITA, 'partita', tentativo, adesso)]);
    if (segno.error && !eUnDoppione(segno.error.message)) throw new Error(segno.error.message);
  } catch (e) {
    registro.error('[avvisi-cancellazione] email partita ma non segnata: la notte dopo puo ripartire una seconda volta', {
      userId: a.userId, tappa: a.tappa, errore: e instanceof Error ? e.message : 'errore',
    });
  }
  return 'partita';
}

/**
 * 27/10/2026 (quarto giro) — L'EMAIL PORTA I COLLEGAMENTI, NON SOLO IL TESTO.
 *
 * Il corpo è scritto per il pannello: senza casella privacy dice «scrivi a noi
 * con il modulo dei contatti del sito (pagina /contact)». Dentro il sito
 * «/contact» è un indirizzo; in una email è una parola, senza dominio e senza
 * niente da cliccare, letta da chi sta cercando di andarsene. Qui «/contact»
 * diventa l'indirizzo intero e cliccabile, e in fondo c'è la pagina
 * dell'account (`a.link`), dove si vede lo stato della richiesta.
 */
const PAGINA_DEI_CONTATTI = '/contact';

function corpoDellEmail(a: AvvisoAllInteressato): string {
  const sito = indirizzoPubblico().url.replace(/\/+$/, '');
  const collegamento = (percorso: string) => {
    const url = escapeHtml(`${sito}${percorso}`);
    return `<a href="${url}">${url}</a>`;
  };
  const testo = a.corpo
    .split(PAGINA_DEI_CONTATTI)
    .map((pezzo) => escapeHtml(pezzo).replace(/\n/g, '<br>'))
    .join(collegamento(PAGINA_DEI_CONTATTI));
  const pagina = a.link ? `<p>La tua richiesta, sul sito: ${collegamento(a.link)}</p>` : '';
  return `<p>${testo}</p>${pagina}`;
}

/** Vero se l'email è partita. Non lancia: un'email persa si conta, non ferma la notte. */
async function speditaAncheTramitePosta(
  posta: PostaAvvisi,
  a: AvvisoAllInteressato,
  registro: RegistroAvvisi,
  tentativo: number,
): Promise<boolean> {
  try {
    const to = await posta.indirizzoDi(a.userId);
    if (!to) throw new Error('nessun indirizzo email per questa persona');
    const esito = await posta.invia({
      to,
      subject: a.titolo,
      html: corpoDellEmail(a),
    });
    if (esito.ok !== true) throw new Error('invio non riuscito o posta non configurata');
    return true;
  } catch (e) {
    registro.error('[avvisi-cancellazione] la spiegazione e nel pannello ma non e partita per email', {
      userId: a.userId, tappa: a.tappa, tentativo, errore: e instanceof Error ? e.message : 'errore',
    });
    return false;
  }
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
 * e poi `avvisi.falliti` e `avvisi.emailBloccate` vanno nel conto che rende
 * rossa la notte, accanto a `potature.fallite`: una risposta dovuta per legge
 * che non parte è un guasto come gli altri.
 */
export async function rispondiAChiAspetta(
  admin: Amministrativo,
  verdetto: { dovuti: AvvisoAllInteressato[] },
  registro: RegistroAvvisi,
): Promise<RapportoAvvisi> {
  return recapitaAvvisi(admin as unknown as ClienteAvvisi, verdetto.dovuti, registro, postaVera(admin));
}

/** La posta vera: l'indirizzo dal servizio di accesso, l'invio da `sendEmail`. */
function postaVera(admin: Amministrativo): PostaAvvisi {
  return {
    async indirizzoDi(userId) {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error) throw new Error(error.message);
      return data.user?.email ?? null;
    },
    // Avviso di servizio dovuto per legge, non promozione: niente piede «annulla l'iscrizione».
    invia: (l) => sendEmail({ ...l, tipo: 'transazionale' }),
  };
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
