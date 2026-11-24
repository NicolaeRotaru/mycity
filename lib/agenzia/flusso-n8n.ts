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
        ...(segreto ? { 'x-mycity-segreto': segreto } : {}),
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
