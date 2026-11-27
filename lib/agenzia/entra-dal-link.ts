import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { requireSupabasePublic } from '@/lib/env';
import { logger } from '@/lib/logger';
import { conDurataMassima } from '@/lib/auth/cookie-di-sessione';

/**
 * IL TITOLARE ENTRA SUBITO DOPO LA CONFERMA, COL CODICE DELL'EMAIL — 27/11/2026.
 *
 * Nicola: «dopo il click entra nella sua pagina venditore con l'abbonamento che ha scelto». Il collaudo della
 * sicurezza ha bocciato la prima versione: chi aveva il link poteva scrivere l'email vera del titolare ed
 * entrare al suo posto, senza possederla. Nicola ha scelto «codice dall'email»: il titolare scrive nella
 * pagina il codice che gli arriva per email (lib/agenzia/preventivo-col-codice.ts, `mandaCodiceDalLink`) e
 * qui `verifyOtp` lo controlla. Se è giusto la sessione si apre nella stessa risposta: i cookie si
 * raccolgono in `scritti` e chi risponde li copia. Entra solo chi possiede l'email, come prima col link
 * dell'email, ma senza lasciare la pagina.
 *
 * Una regola di prudenza: se in questo browser c'è già dentro un ALTRO account (Nicola, o un venditore che
 * prova il link dal suo telefono), la sua sessione non si tocca. Nel dubbio (la domanda «chi c'è dentro?»
 * non risponde in tempo, o torna con un errore) vale la stessa regola.
 */

export type CookieScritto = { name: string; value: string; options: CookieOptions };

export type SessioneDalLink = {
  /** Vero se in questo browser c'è dentro un altro account, o se non si riesce a saperlo in tempo. */
  dentroUnAltro: (sellerId: string) => Promise<boolean>;
  /** Verifica il codice dell'email e apre la sessione. L'id dell'utente entrato, o null se il codice non va. */
  entraColCodice: (email: string, codice: string) => Promise<string | null>;
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
    async entraColCodice(email: string, codice: string) {
      const { data, error } = await supabase.auth.verifyOtp({ email, token: codice, type: 'email' });
      if (error || !data?.session || !data.user) {
        logger.warn('[preventivo-codice] codice non verificato', { codice: error?.code ?? null });
        return null;
      }
      return data.user.id;
    },
  };
}
