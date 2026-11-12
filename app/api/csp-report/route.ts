import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';

/**
 * 12/11/2026 (R06-025) — DOVE ARRIVANO LE VIOLAZIONI DELLA POLITICA DI SICUREZZA.
 *
 * La Content-Security-Policy del middleware ora dichiara `report-uri` e
 * `report-to`: quando il browser blocca uno script (di terzi che cambia
 * indirizzo, o un'iniezione tentata) manda qui una segnalazione. Qui la si
 * scrive nei log, in forma corta: quale regola, quale risorsa bloccata, su quale
 * pagina. Niente di quello che arriva si rimanda indietro.
 *
 * Chiunque puo' scrivere a questo indirizzo, quindi: corpo massimo 10 KB, un
 * freno per indirizzo, e si risponde sempre 204 (anche a un corpo illeggibile),
 * cosi' non diventa una porta per sondare il sito.
 */
const CORPO_MASSIMO = 10 * 1024;

type Segnalazione = Record<string, unknown>;

/** Il pezzo che serve di una segnalazione, nei due formati (report-uri e report-to). */
function riassunto(s: Segnalazione): Record<string, string> {
  const dentro = (s['csp-report'] ?? s.body ?? s) as Segnalazione;
  const prendi = (...chiavi: string[]) => {
    for (const k of chiavi) {
      const v = dentro?.[k];
      if (typeof v === 'string' && v) return v.slice(0, 300);
    }
    return '';
  };
  // Della pagina si tiene solo la strada: i parametri possono portare dati personali.
  const pagina = prendi('document-uri', 'documentURL').split(/[?#]/)[0];
  const bloccato = prendi('blocked-uri', 'blockedURL').split(/[?#]/)[0];
  return {
    regola: prendi('effective-directive', 'effectiveDirective', 'violated-directive'),
    bloccato,
    pagina,
  };
}

/** Legge il corpo fermandosi al tetto: oltre, torna null senza scaricare il resto. */
async function leggiFinoA(req: Request, tetto: number): Promise<string | null> {
  if (!req.body) return null;
  const lettore = req.body.getReader();
  const pezzi: Uint8Array[] = [];
  let letti = 0;
  try {
    for (;;) {
      const { done, value } = await lettore.read();
      if (done) break;
      letti += value.byteLength;
      if (letti > tetto) {
        await lettore.cancel().catch(() => {});
        return null;
      }
      pezzi.push(value);
    }
  } catch {
    return null;
  }
  const tutto = new Uint8Array(letti);
  let da = 0;
  for (const p of pezzi) { tutto.set(p, da); da += p.byteLength; }
  return new TextDecoder().decode(tutto);
}

export async function POST(req: Request): Promise<Response> {
  const vuota = new NextResponse(null, { status: 204 });
  const lunghezza = Number(req.headers.get('content-length') ?? '0');
  if (!Number.isFinite(lunghezza) || lunghezza > CORPO_MASSIMO) return vuota;

  const freno = await rateLimitAsync({ key: `csp-report:${getClientIp(req)}`, max: 30, windowMs: 60_000 });
  if (!freno.allowed) return vuota;

  // Il tetto vale anche mentre si legge: un corpo senza content-length (o con uno
  // falso) non si scarica intero prima del controllo.
  const testo = await leggiFinoA(req, CORPO_MASSIMO);
  if (!testo) return vuota;

  let corpo: unknown;
  try {
    corpo = JSON.parse(testo);
  } catch {
    return vuota;
  }
  // report-to manda un elenco, report-uri un oggetto solo.
  const elenco = (Array.isArray(corpo) ? corpo : [corpo]).slice(0, 10) as Segnalazione[];
  for (const s of elenco) {
    if (!s || typeof s !== 'object') continue;
    const r = riassunto(s);
    // Una segnalazione senza nessun campo utile e' rumore, non si scrive.
    if (!r.regola && !r.bloccato && !r.pagina) continue;
    logger.warn('[csp] il browser ha bloccato una risorsa', r);
  }
  return vuota;
}
