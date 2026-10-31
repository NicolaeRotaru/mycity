import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { env, requireSupabasePublic } from '@/lib/env';
import { getAdminSupabase } from '@/lib/supabase/server';
import { getClientIp } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  destinazioneDopoLaConferma,
  leggiLinkDiConferma,
  rimandoLinkNonRiuscito,
  type LinkDiConferma,
} from '@/lib/auth/link-email';
import { vaChiestaSenzaTrattenere, verbalizzaSenzaTrattenere, versioneAccettata } from '@/lib/auth/accettazione-testi';

export const runtime = 'nodejs';

/**
 * 15/10/2026 (R13) — LA CONFERMA CHE FUNZIONA DA QUALUNQUE DISPOSITIVO.
 *
 * Il link dell'email porta un `token_hash`. Qui il server lo verifica con
 * `verifyOtp` e scrive i cookie della sessione: non serve nessun segreto
 * rimasto nel browser che ha fatto la richiesta, quindi la password chiesta dal
 * computer si cambia anche aprendo l'email dal telefono, e l'iscrizione fatta
 * dal telefono si conferma anche dal computer.
 *
 * Diventa la strada di tutti quando i modelli «Reset password» e «Confirm
 * signup» su Supabase puntano qui. Finche' non lo fanno, /auth/callback resta
 * in servizio per i link di oggi.
 *
 * La logica che decide sta in `lib/auth/link-email.ts`; qui solo i fili.
 *
 * 31/10/2026 — Aprire il link (GET) mostra un pulsante; premerlo (POST) lo
 * consuma. Un filtro antivirus che apre il link in anteprima non lo brucia.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const link = leggiLinkDiConferma(url.searchParams);
  if (!link.valido) {
    return NextResponse.redirect(new URL(rimandoLinkNonRiuscito(link.tipo, 'link_non_valido', link.next), env.appUrl()));
  }
  // 31/10/2026 — L'APERTURA NON CONSUMA IL LINK. I filtri della posta
  // aziendale (Microsoft 365 con la protezione dei link, i gateway antivirus)
  // aprono ogni link in anteprima con una GET: se la GET chiamasse
  // `verifyOtp`, il link monouso sarebbe gia' usato quando la persona clicca.
  // Quindi la GET mostra solo un pulsante; la verifica parte dal POST.
  return new NextResponse(paginaColPulsante(link), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Il token non deve restare in nessuna cache, ne' uscire col Referer.
      'Cache-Control': 'no-store, max-age=0',
      // `same-origin`, non `no-referrer`: con `no-referrer` il browser manda
      // «Origin: null» anche sul POST del nostro stesso modulo, e il controllo
      // qui sotto chiuderebbe fuori la persona vera.
      'Referrer-Policy': 'same-origin',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/** Il pulsante che consuma il link: lo preme una persona, non un filtro. */
export async function POST(req: NextRequest) {
  // Il modulo parte solo dalla pagina qui sopra, cioe' dallo stesso indirizzo.
  // Un POST da un altro sito non apre sessioni (niente accesso a sorpresa).
  const origine = req.headers.get('origin');
  const nostre = new Set([new URL(req.url).origin, new URL(env.appUrl()).origin]);
  if (origine && !nostre.has(origine)) {
    logger.warn('[auth/confirm] modulo arrivato da un altro sito', { origine });
    return NextResponse.redirect(new URL(rimandoLinkNonRiuscito(null, 'link_non_valido'), env.appUrl()), 303);
  }
  const campi = new URLSearchParams();
  try {
    const modulo = await req.formData();
    for (const nome of CAMPI_DEL_MODULO) {
      const valore = modulo.get(nome);
      if (typeof valore === 'string') campi.set(nome, valore);
    }
  } catch (e) {
    logger.warn('[auth/confirm] modulo illeggibile', { e });
  }
  const link = leggiLinkDiConferma(campi);
  if (!link.valido) {
    return NextResponse.redirect(new URL(rimandoLinkNonRiuscito(link.tipo, 'link_non_valido', link.next), env.appUrl()), 303);
  }
  return verificaIlLink(req, link);
}

const CAMPI_DEL_MODULO = ['token_hash', 'type', 'next'] as const;

function testoSicuro(v: string): string {
  return v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function paginaColPulsante(link: Extract<LinkDiConferma, { valido: true }>): string {
  const password = link.tipo === 'recovery';
  const titolo = password ? 'Scegli la nuova password' : 'Conferma il tuo indirizzo email';
  const campo = (nome: string, valore: string) =>
    `<input type="hidden" name="${nome}" value="${testoSicuro(valore)}">`;
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${titolo} · MyCity</title></head>
<body style="font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;text-align:center;color:#1f1d1a">
<h1 style="font-size:1.4rem">${titolo}</h1>
<p>Premi il pulsante per continuare. Il link si attiva solo adesso, cosi' i filtri della posta che lo aprono in anteprima non lo usano al posto tuo.</p>
<form method="post" action="/auth/confirm">
${campo('token_hash', link.tokenHash)}
${campo('type', link.tipo)}
${campo('next', link.next)}
<button type="submit" style="font-size:1.05rem;font-weight:700;padding:.8rem 1.6rem;border:0;border-radius:.6rem;background:#1f6f43;color:#fff;cursor:pointer">Continua</button>
</form>
</body></html>`;
}

async function verificaIlLink(req: NextRequest, link: Extract<LinkDiConferma, { valido: true }>) {
  const { url: supaUrl, key: supaKey } = requireSupabasePublic();
  // Raccoglie i cookie che Supabase scrive durante la verifica: vanno copiati
  // su qualunque risposta parta da qui, altrimenti la sessione si perde.
  const raccolta = NextResponse.redirect(new URL(link.next, env.appUrl()));
  const supabase = createServerClient(supaUrl, supaKey, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        raccolta.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        raccolta.cookies.set({ name, value: '', ...options });
      },
    },
  });

  const { data, error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.tipo });
  if (error || !data?.session) {
    logger.warn('[auth/confirm] link non verificato', { tipo: link.tipo, codice: error?.code ?? null });
    return NextResponse.redirect(new URL(rimandoLinkNonRiuscito(link.tipo, 'link_scaduto', link.next), env.appUrl()), 303);
  }

  const conICookie = (dove: URL) => {
    // 303: dopo il POST del pulsante il browser apre la destinazione con una GET.
    const r = NextResponse.redirect(dove, 303);
    for (const c of raccolta.cookies.getAll()) r.cookies.set(c);
    return r;
  };

  const utente = data.user;
  if (link.tipo !== 'recovery' && utente) {
    // Lo stesso verbale del ritorno da /auth/callback: chi conferma da qui non
    // deve restare operativo senza una riga che dica cosa ha accettato.
    const versione = versioneAccettata(utente, null);
    try {
      const admin = getAdminSupabase();
      if (versione) {
        // Mai oltre `TETTO_VERBALE_MS`: un database muto non trattiene l'ingresso.
        const verbale = await verbalizzaSenzaTrattenere(() => admin, {
          utenteId: utente.id,
          versione,
          ip: getClientIp(req),
          userAgent: req.headers.get('user-agent'),
        });
        if (verbale === 'scaduto' || verbale === 'rotto' || verbale === 'non-scritta') {
          logger.warn('[auth/confirm] accettazione dei testi non registrata', { esito: verbale });
        }
      } else {
        // Anche la domanda «ha gia' accettato?» si ferma a `TETTO_VERBALE_MS`:
        // il link e' gia' consumato, e una pagina appesa lo brucerebbe.
        const domanda = await vaChiestaSenzaTrattenere(() => admin, utente.id);
        if (domanda === 'chiedi') {
          const chiedi = new URL('/accetta-condizioni', env.appUrl());
          chiedi.searchParams.set('next', link.next);
          return conICookie(chiedi);
        }
        if (domanda === 'scaduto' || domanda === 'rotto') {
          logger.warn('[auth/confirm] accettazione dei testi non controllata', { esito: domanda });
        }
      }
    } catch (e) {
      logger.warn('[auth/confirm] accettazione dei testi non registrata', { e });
    }
  }

  return conICookie(destinazioneDopoLaConferma(env.appUrl(), link));
}
