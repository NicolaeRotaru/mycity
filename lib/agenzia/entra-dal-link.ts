import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { requireSupabasePublic } from '@/lib/env';
import { logger } from '@/lib/logger';
import { conDurataMassima } from '@/lib/auth/cookie-di-sessione';

/**
 * IL TITOLARE ENTRA SUBITO DOPO LA CONFERMA — 27/11/2026.
 *
 * Nicola: «dopo il click entra nella sua pagina venditore con l'abbonamento che ha scelto». Prima il
 * titolare confermava dal link e poi doveva aprire l'email per entrare. Ora la conferma apre anche la sua
 * sessione, nella stessa risposta: il server crea un gettone d'accesso monouso per l'utente del negozio
 * (lib/agenzia/preventivo-col-codice.ts) e lo consuma qui con `verifyOtp`, come /auth/confirm. I cookie
 * della sessione si raccolgono in `scritti` e chi risponde li copia sulla risposta.
 *
 * Non è un accesso in più rispetto a prima: chi ha il link poteva già dare una sua email e ricevere lì il
 * link per entrare (collaudo del 24/11). Cambia solo che non serve aprire la posta.
 *
 * Una regola di prudenza: se in questo browser c'è già dentro un ALTRO account (Nicola, o un venditore che
 * prova il link dal suo telefono), la sua sessione non si tocca. Il titolare entra dall'email, come prima.
 * Nel dubbio (la domanda «chi c'è dentro?» non risponde in tempo) vale la stessa regola.
 */

export type CookieScritto = { name: string; value: string; options: CookieOptions };

export type SessioneDalLink = {
  /** Vero se in questo browser c'è dentro un altro account, o se non si riesce a saperlo in tempo. */
  dentroUnAltro: (sellerId: string) => Promise<boolean>;
  /** Consuma il gettone monouso e apre la sessione. Vero solo se la sessione c'è davvero. */
  entra: (gettone: string) => Promise<boolean>;
  /** I cookie da copiare sulla risposta, comprese le cancellazioni. */
  scritti: CookieScritto[];
};

/** Il tetto della domanda «chi c'è dentro?»: oltre, si resta dalla parte prudente. */
export const TETTO_CHI_CE_MS = 3000;

function leggiCookie(intestazione: string | null): Map<string, string> {
  const presenti = new Map<string, string>();
  for (const pezzo of (intestazione ?? '').split(';')) {
    const uguale = pezzo.indexOf('=');
    if (uguale <= 0) continue;
    const nome = pezzo.slice(0, uguale).trim();
    const grezzo = pezzo.slice(uguale + 1).trim();
    let valore = grezzo;
    try { valore = decodeURIComponent(grezzo); } catch { /* resta com'è */ }
    if (nome) presenti.set(nome, valore);
  }
  return presenti;
}

/** Senza le chiavi pubbliche di Supabase non si apre niente: `null`, e il titolare entra dall'email. */
export function sessioneDalLink(intestazioneCookie: string | null, tetto = TETTO_CHI_CE_MS): SessioneDalLink | null {
  let chiavi: { url: string; key: string };
  try {
    chiavi = requireSupabasePublic();
  } catch {
    return null;
  }
  const presenti = leggiCookie(intestazioneCookie);
  const scritti: CookieScritto[] = [];
  const supabase = createServerClient(chiavi.url, chiavi.key, {
    cookies: {
      get(name: string) {
        return presenti.get(name);
      },
      set(name: string, value: string, options: CookieOptions) {
        presenti.set(name, value);
        scritti.push({ name, value, options: conDurataMassima(options) });
      },
      remove(name: string, options: CookieOptions) {
        presenti.delete(name);
        scritti.push({ name, value: '', options: conDurataMassima(options) });
      },
    },
  });

  return {
    scritti,
    async dentroUnAltro(sellerId: string) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const scaduto = new Promise<'scaduto'>((risolvi) => { timer = setTimeout(() => risolvi('scaduto'), tetto); });
        const risposta = await Promise.race([supabase.auth.getUser(), scaduto]);
        if (risposta === 'scaduto') {
          logger.warn('[preventivo-codice] chi c è dentro non si sa in tempo: il titolare entra dall email');
          return true;
        }
        const id = risposta.data?.user?.id ?? null;
        if (id !== null) return id !== sellerId;
        // Nessun utente. Se è perché non c'è nessuna sessione, si entra. Se è un errore (rete giù, 5xx:
        // la libreria non lancia, lo restituisce), una sessione di un altro potrebbe esserci: prudenza
        // (collaudo del 27/11, minore M1).
        const errore = risposta.error as { name?: string } | null;
        if (errore && errore.name !== 'AuthSessionMissingError') {
          logger.warn('[preventivo-codice] chi c è dentro non si sa: il titolare entra dall email', { errore: errore.name ?? 'sconosciuto' });
          return true;
        }
        return false;
      } catch (e) {
        logger.warn('[preventivo-codice] chi c è dentro non si sa: il titolare entra dall email', { errore: String(e) });
        return true;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async entra(gettone: string) {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: gettone, type: 'magiclink' });
      if (error || !data?.session) {
        logger.warn('[preventivo-codice] sessione del titolare non aperta', { codice: error?.code ?? null });
        return false;
      }
      return true;
    },
  };
}
