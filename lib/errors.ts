/**
 * Error messages user-friendly — single source of truth.
 *
 * Esperti consultati:
 * - Content Designer: "Codici SQL/HTTP all'utente = perdita di fiducia istantanea.
 *   Italiano semplice, soluzione concreta, no panic tone."
 * - Trust & Safety: "Mai esporre dettagli interni (table name, column name,
 *   stack trace) all'utente esterno."
 */

import { trackErrorShown } from './analytics/events';

const SUPABASE_CODE_MAP: Record<string, string> = {
  '23505': 'Questo valore è già stato usato. Prova con uno diverso.',
  '23503': 'Impossibile completare: l\'elemento collegato non esiste più.',
  '23502': 'Manca un dato obbligatorio.',
  '23514': 'Il valore inserito non è valido.',
  '42501': 'Non hai i permessi per questa azione.',
  'PGRST116': 'Non trovato.',
  'PGRST204': 'Nessun risultato.',
  '22P02': 'Formato non valido.',
};

const GENERIC_FALLBACK = 'Qualcosa non ha funzionato. Riprova fra un momento.';

/**
 * Trasforma errori Supabase/Stripe/fetch in messaggi user-friendly italiani.
 * Logga il messaggio originale per debugging via PostHog.
 */
export function friendlyError(err: unknown, context?: { page?: string; action?: string }): string {
  if (!err) return GENERIC_FALLBACK;

  // Supabase PostgrestError style
  if (typeof err === 'object' && err !== null) {
    const e = err as { code?: string; message?: string; status?: number };
    if (e.code && SUPABASE_CODE_MAP[e.code]) {
      trackErrorShown(e.code, e.message ?? '', context?.page);
      return SUPABASE_CODE_MAP[e.code];
    }
    if (e.message) {
      // Fix #17: trackErrorShown in ogni ramo (era tracciato solo per i codici Supabase mappati).
      if (/duplicate key value/i.test(e.message)) {
        trackErrorShown('duplicate_key', e.message, context?.page);
        return SUPABASE_CODE_MAP['23505'];
      }
      if (/foreign key constraint/i.test(e.message)) {
        trackErrorShown('foreign_key', e.message, context?.page);
        return SUPABASE_CODE_MAP['23503'];
      }
      if (/permission denied|insufficient_privilege|row.level security/i.test(e.message)) {
        trackErrorShown('permission_denied', e.message, context?.page);
        return 'Non hai i permessi per questa azione.';
      }
      if (/network|fetch|timeout|aborted/i.test(e.message)) {
        trackErrorShown('network', e.message, context?.page);
        return 'Problema di connessione. Controlla la rete e riprova.';
      }
      if (/rate.limit|too many/i.test(e.message)) {
        trackErrorShown('rate_limit', e.message, context?.page);
        return 'Troppe richieste in poco tempo. Aspetta qualche secondo.';
      }
      if (/jwt|token|expired|unauthor/i.test(e.message)) {
        trackErrorShown('session_expired', e.message, context?.page);
        return 'La sessione è scaduta. Accedi di nuovo.';
      }
      trackErrorShown(e.code ?? 'unknown', e.message, context?.page);
      // Strip technical details
      const cleaned = e.message
        .replace(/\b[A-Z_]+\s*=\s*[^\s,]+/g, '')
        .replace(/\(.*?\)/g, '')
        .trim();
      // Le righe multiple sono un segnale forte di stack trace → scarta.
      // Il limite di lunghezza scarta i dump tecnici ma deve lasciar passare i
      // messaggi user-facing dei nostri endpoint (es. "<negozio> è chiuso in
      // questo momento. Riprova durante gli orari di apertura…", ~115 char):
      // con un cap a 100 venivano sostituiti dal generico, nascondendo il vero
      // motivo all'utente. 200 copre le frasi UI legittime, i veri stack trace
      // restano più lunghi.
      if (
        cleaned.length > 0 &&
        cleaned.length < 200 &&
        !cleaned.includes('\n') &&
        /^[a-zA-ZÀ-ſ]/.test(cleaned)
      ) {
        return cleaned;
      }
    }
    if (e.status) {
      // Fix #17: trackErrorShown per i codici HTTP (401/403/404/429/5xx).
      const statusLabel = e.status >= 500 ? 'http_5xx' : `http_${e.status}`;
      trackErrorShown(statusLabel, `HTTP ${e.status}`, context?.page);
      if (e.status === 401) return 'Devi accedere per continuare.';
      if (e.status === 403) return 'Non hai i permessi per questa azione.';
      if (e.status === 404) return 'Non trovato.';
      if (e.status === 429) return 'Troppe richieste. Aspetta un attimo.';
      if (e.status >= 500) return 'Problema del server. Riproveremo tra poco.';
    }
  }

  if (typeof err === 'string') return err;
  return GENERIC_FALLBACK;
}

/**
 * Estrae il messaggio d'errore dal body JSON di una API route, gestendo
 * SIA il formato ApiErrors `{ ok: false, error: { code, message } }` SIA
 * il formato legacy `{ error: "stringa" }`.
 *
 * Necessario perché molti endpoint usano ApiErrors (error = oggetto): fare
 * `new Error(body.error)` darebbe "[object Object]". Usare sempre questo.
 *
 *   const body = await res.json().catch(() => ({}));
 *   if (!res.ok) throw new Error(apiErrorMessage(body, 'Operazione fallita'));
 */
export function apiErrorMessage(body: unknown, fallback = 'Operazione non riuscita'): string {
  if (!body || typeof body !== 'object') return fallback;
  const e = (body as { error?: unknown }).error;
  if (typeof e === 'string' && e.trim()) return e;
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}
