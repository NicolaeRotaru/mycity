import { logger } from '@/lib/logger';
import type { Preventivo } from './preventivo';

/**
 * IL PREVENTIVO ACCETTATO VA AL FLUSSO n8n DI MYCITY.
 *
 * 22/11/2026 — Nicola: «sfrutteremo n8n per dargli il servizio di gestione dei
 * social automatico (è già pronto, basta collegarlo)». Quando un cliente accetta
 * il preventivo, il sito manda qui le voci scelte e i contatti, e il flusso
 * n8n parte da solo (per esempio: apre la scheda del cliente e avvia i social).
 *
 * SPENTO FINCHÉ NICOLA NON LO COLLEGA. Senza `N8N_PREVENTIVO_WEBHOOK_URL` non
 * parte niente: resta l'avviso agli amministratori, che è la strada sicura.
 * L'indirizzo lo sceglie Nicola nelle variabili d'ambiente di Vercel, non chi usa il
 * sito: per questo non passa dal controllo anti-SSRF degli indirizzi scritti
 * dagli utenti. Si accetta solo https.
 *
 * Non blocca mai l'accettazione: se n8n non risponde in 5 secondi, o risponde
 * male, il cliente ha comunque il suo «ricevuto» e il log dice cosa non è
 * partito.
 */

const ATTESA_MASSIMA_MS = 5_000;

export type EsitoFlusso = 'spento' | 'inviato' | 'fallito';

/** L'intestazione con cui n8n riconosce il sito. */
const INTESTAZIONE_SEGRETO = 'x-mycity-segreto';

export type DatiPerIlFlusso = {
  idAttivita: string;
  email: string | null;
  telefono: string | null;
  socials: unknown;
};

export async function inviaAlFlusso(p: Preventivo, dati: DatiPerIlFlusso, fetchFn: typeof fetch = fetch): Promise<EsitoFlusso> {
  const indirizzo = process.env.N8N_PREVENTIVO_WEBHOOK_URL?.trim();
  if (!indirizzo) return 'spento';
  if (!/^https:\/\//i.test(indirizzo)) {
    logger.warn('[preventivo] N8N_PREVENTIVO_WEBHOOK_URL non è https: il flusso non parte');
    return 'fallito';
  }
  const segreto = process.env.N8N_PREVENTIVO_SEGRETO?.trim();
  try {
    const risposta = await fetchFn(indirizzo, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(segreto ? { [INTESTAZIONE_SEGRETO]: segreto } : {}),
      },
      body: JSON.stringify({
        tipo: 'preventivo-accettato',
        numero: p.numero,
        data: p.data,
        attivita: { id: dati.idAttivita, nome: p.attivita, tipo: p.tipoAttivita },
        contatti: { email: dati.email, telefono: dati.telefono },
        socials: dati.socials ?? null,
        voci: p.righe.map((r) => ({ id: r.id, titolo: r.titolo, cadenza: r.cadenza, prezzo: r.prezzo, perche: r.perche, partner: r.partner ?? null })),
      }),
      signal: AbortSignal.timeout(ATTESA_MASSIMA_MS),
    });
    if (!risposta.ok) {
      logger.warn('[preventivo] il flusso n8n ha risposto male', { numero: p.numero, status: risposta.status });
      return 'fallito';
    }
    return 'inviato';
  } catch (errore) {
    logger.warn('[preventivo] il flusso n8n non ha risposto', { numero: p.numero, errore: String(errore) });
    return 'fallito';
  }
}

/**
 * UNA NUOVA ATTIVITÀ SU MYCITY ENTRA NELLA SCHEDA CLIENTI DELL'AGENZIA.
 *
 * 24/11/2026 — Nicola: «un nuovo cliente che si collega a MyCity si inserisce nel
 * database dei clienti, e deve sfruttare il modulo 12». Quando un'attività manda
 * la richiesta di entrare (/sell → /api/seller/apply), il sito passa a n8n il
 * nome, il tipo e l'indirizzo dell'attività. Il flusso «16 · Nuovo cliente da
 * MyCity» fa quello che fa il modulo 12: cerca le fonti pubbliche, prepara la
 * scheda, la scrive nel foglio Clienti con attivo = no e avvisa Nicola su Telegram.
 *
 * Partono SOLO i dati dell'attività, quelli che il negozio mostra al pubblico:
 * nome, tipo, indirizzo del negozio, città, descrizione. Niente nome e cognome del
 * titolare, codice fiscale, data di nascita, IBAN, telefono o email: alla scheda
 * del cliente non servono, e il modulo 12 i contatti del titolare li chiede a mano.
 *
 * SPENTO FINCHÉ NICOLA NON LO COLLEGA. Servono tutti e due:
 * `N8N_NUOVO_CLIENTE_WEBHOOK_URL` (solo https) e `N8N_NUOVO_CLIENTE_SEGRETO`.
 * Senza segreto non parte niente: il flusso n8n respinge le richieste che non
 * lo portano, quindi mandarla lo stesso vorrebbe dire una scheda persa in silenzio.
 *
 * Non blocca mai l'iscrizione: se n8n non risponde in 5 secondi, o risponde male,
 * la richiesta del negozio è comunque salvata e il log dice cosa non è partito.
 */

export type NuovaAttivitaPerIlFlusso = {
  idAttivita: string;
  nome: string;
  tipo: string | null;
  tipoDescritto: string | null;
  indirizzo: string | null;
  citta: string | null;
  descrizione: string | null;
};

const corto = (v: string | null | undefined, massimo: number): string | null => {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  return t ? Array.from(t).slice(0, massimo).join('') : null;
};

export async function inviaNuovaAttivitaAlFlusso(
  a: NuovaAttivitaPerIlFlusso,
  fetchFn: typeof fetch = fetch,
): Promise<EsitoFlusso> {
  const indirizzo = process.env.N8N_NUOVO_CLIENTE_WEBHOOK_URL?.trim();
  if (!indirizzo) return 'spento';
  if (!/^https:\/\//i.test(indirizzo)) {
    logger.warn('[nuovo-cliente] N8N_NUOVO_CLIENTE_WEBHOOK_URL non è https: il flusso non parte');
    return 'fallito';
  }
  const segreto = process.env.N8N_NUOVO_CLIENTE_SEGRETO?.trim();
  if (!segreto) {
    logger.warn('[nuovo-cliente] manca N8N_NUOVO_CLIENTE_SEGRETO: n8n respingerebbe la richiesta, il flusso non parte');
    return 'fallito';
  }
  try {
    const risposta = await fetchFn(indirizzo, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [INTESTAZIONE_SEGRETO]: segreto },
      body: JSON.stringify({
        tipo: 'nuovo-cliente',
        origine: 'mycity',
        inviato_il: new Date().toISOString(),
        attivita: {
          id: a.idAttivita,
          nome: corto(a.nome, 80),
          tipo: corto(a.tipo, 40),
          tipo_descritto: corto(a.tipoDescritto, 120),
          indirizzo: corto(a.indirizzo, 200),
          citta: corto(a.citta, 80),
          descrizione: corto(a.descrizione, 500),
        },
      }),
      signal: AbortSignal.timeout(ATTESA_MASSIMA_MS),
    });
    if (!risposta.ok) {
      logger.warn('[nuovo-cliente] il flusso n8n ha risposto male', { idAttivita: a.idAttivita, status: risposta.status });
      return 'fallito';
    }
    return 'inviato';
  } catch (errore) {
    logger.warn('[nuovo-cliente] il flusso n8n non ha risposto', { idAttivita: a.idAttivita, errore: String(errore) });
    return 'fallito';
  }
}
