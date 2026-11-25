import { logger } from '@/lib/logger';

const ATTESA_MASSIMA_MS = 5_000;

/** L'intestazione con cui n8n riconosce il sito. */
const INTESTAZIONE_SEGRETO = 'x-mycity-segreto';

export type EsitoFlusso = 'spento' | 'inviato' | 'fallito';

// Sta in un file suo, fuori dal preventivo dell'agenzia (flusso-n8n.ts): l'iscrizione di un'attività
// deve arrivare a n8n anche se il preventivo cambia o sparisce dal sito.

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
  /**
   * 25/11/2026 — Facoltativi. `sito`: il sito pubblico del locale (solo https). `dalModulo12`: l'attività l'ha
   * appena iscritta il modulo 12 (porta /api/agenzia/nuova-attivita), quindi la sua riga Clienti c'è già e il
   * 16 non la tratta come un doppione sospetto.
   */
  sito?: string | null;
  dalModulo12?: boolean;
};

/**
 * 25/11/2026 — LA CITTÀ DALL'INDIRIZZO DEL NEGOZIO.
 *
 * Il modulo di iscrizione corto (/sell, mycity#320) non chiede più la sede legale, e la città
 * che arrivava al flusso 16 veniva da lì: arrivava vuota. Nicola: «sistema la città vuota verso
 * n8n». La si ricava dall'indirizzo che il negoziante scrive accanto alla mappa, quasi sempre
 * «via, numero, città»: «Via Roma 1, 29121 Piacenza» → «Piacenza». Si guarda da destra, perché
 * il comune sta dopo la frazione («Via Emilia 10, San Lazzaro, Piacenza» → «Piacenza»). Paese,
 * regione, provincia, CAP da solo e numeri civici si saltano. Senza una virgola non si indovina:
 * meglio vuota che sbagliata, la scheda del cliente la completa a mano chi la rilegge.
 */
const PAESI_E_REGIONI = /^(italia|italy|emilia[- ]romagna|lombardia|piemonte|liguria|veneto|toscana)$/i;

export function cittaDallIndirizzo(indirizzo: string | null | undefined): string | null {
  const parti = (indirizzo ?? '').split(',').map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (parti.length < 2) return null;
  for (const parte of parti.slice(1).reverse()) {
    const senzaProvincia = parte.replace(/\s*\(?\b[A-Z]{2}\)?$/, '').trim();
    const conCap = senzaProvincia.match(/^\d{5}\s+(.+)$/);
    const candidata = (conCap ? conCap[1] : senzaProvincia).trim();
    if (!candidata || /\d/.test(candidata)) continue;
    if (PAESI_E_REGIONI.test(candidata) || /^provincia\b/i.test(candidata)) continue;
    return candidata.slice(0, 80);
  }
  return null;
}

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
          ...(a.sito && /^https:\/\//i.test(a.sito) ? { sito: corto(a.sito, 300) } : {}),
        },
        ...(a.dalModulo12 ? { provenienza: 'modulo-12' } : {}),
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
