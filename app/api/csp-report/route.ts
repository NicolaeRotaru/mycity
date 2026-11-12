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

export async function POST(req: Request): Promise<Response> {
  const vuota = new NextResponse(null, { status: 204 });
  const lunghezza = Number(req.headers.get('content-length') ?? '0');
  if (lunghezza > CORPO_MASSIMO) return vuota;

  const freno = await rateLimitAsync({ key: `csp-report:${getClientIp(req)}`, max: 30, windowMs: 60_000 });
  if (!freno.allowed) return vuota;

  let testo = '';
  try {
    testo = await req.text();
  } catch {
    return vuota;
  }
  if (!testo || testo.length > CORPO_MASSIMO) return vuota;

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
    logger.warn('[csp] il browser ha bloccato una risorsa', riassunto(s));
  }
  return vuota;
}
