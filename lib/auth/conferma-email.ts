/**
 * 15/10/2026 (R43) — CHI NON TROVA L'EMAIL DI CONFERMA DEVE POTERSELA FAR RIMANDARE.
 *
 * IL DIFETTO. In produzione la conferma dell'email e' accesa, quindi subito dopo
 * l'iscrizione Supabase non apre nessuna sessione. La pagina «Verifica la tua
 * email» ricavava l'indirizzo SOLO dalla sessione: email = null, il testo diceva
 * «a la tua email» e il pulsante «Reinvia» restava grigio per sempre. E chi
 * provava ad accedere leggeva «Email o password non corretti», perche' la rotta
 * di accesso trasformava QUALSIASI errore di Supabase in quella frase — anche
 * «email non confermata». Nessuna strada rimandava il link.
 *
 * LA RIPARAZIONE.
 *  ① La registrazione lascia l'email nella memoria della scheda del browser
 *    (non nell'indirizzo, che finisce nei registri), e la pagina di verifica la
 *    legge; se non c'e', chiede l'email in un campo. «Reinvia» funziona sempre.
 *  ② La rotta di accesso riconosce «email non confermata» e lo dice; la pagina
 *    di accesso porta alla verifica con l'email gia' scritta.
 *  ③ «Esci» compare solo a chi e' davvero entrato.
 *
 * Qui sta la logica che decide; le pagine e la rotta la chiamano.
 */
import { traduciErroreAuth } from '@/lib/errors';
import { ritornoDopoLaConferma } from '@/lib/analytics/porta-di-ingresso';
import { safeInternalPath } from '@/lib/safe-redirect';

/** La chiave nella memoria della scheda (`sessionStorage`). */
export const CHIAVE_EMAIL_DA_CONFERMARE = 'mycity:email-da-confermare';

/** Lo stesso controllo della rotta di accesso: un'email che Supabase accetterebbe. */
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function emailPlausibile(email: string | null | undefined): boolean {
  const e = (email ?? '').trim();
  return e.length > 0 && e.length <= 254 && EMAIL_RE.test(e);
}

/**
 * La memoria della scheda, se il browser la concede. Leggerla puo' lanciare
 * (finestra privata, dati del sito bloccati): allora `null`, e si va avanti.
 */
export function memoriaDellaScheda(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

type MemoriaScrivibile = { setItem(chiave: string, valore: string): void };
type MemoriaLeggibile = { getItem(chiave: string): string | null };

/**
 * Lascia l'email per la pagina di verifica. La memoria del browser puo' non
 * esserci o rifiutare (finestra privata, dati bloccati): allora si va avanti
 * senza, e la pagina chiedera' l'email in un campo.
 */
export function ricordaEmailDaConfermare(memoria: MemoriaScrivibile | null | undefined, email: string): void {
  const e = email.trim();
  if (!memoria || !emailPlausibile(e)) return;
  try {
    memoria.setItem(CHIAVE_EMAIL_DA_CONFERMARE, e);
  } catch {
    /* niente memoria: la pagina chiede l'email */
  }
}

export function leggiEmailDaConfermare(memoria: MemoriaLeggibile | null | undefined): string | null {
  if (!memoria) return null;
  try {
    const e = memoria.getItem(CHIAVE_EMAIL_DA_CONFERMARE);
    return emailPlausibile(e) ? e!.trim() : null;
  } catch {
    return null;
  }
}

/** La pagina di verifica, con la strada da cui si veniva (es. il checkout). */
export function percorsoVerificaEmail(returnTo?: string | null): string {
  const dove = safeInternalPath(returnTo ?? '/', '/');
  return dove !== '/' ? `/auth/verify-email?returnTo=${encodeURIComponent(dove)}` : '/auth/verify-email';
}

/**
 * Supabase ha risposto «email non confermata»? Il codice c'e' nelle versioni
 * recenti; il messaggio resta come rete per le altre. Supabase lo dice solo
 * DOPO aver controllato la password: chi non la conosce legge sempre «email o
 * password non corrette», e non scopre niente su chi e' iscritto.
 */
export function eEmailNonConfermata(errore: { code?: unknown; message?: unknown } | null | undefined): boolean {
  if (!errore) return false;
  if (errore.code === 'email_not_confirmed') return true;
  return typeof errore.message === 'string' && /email not confirmed/i.test(errore.message);
}

/** Il codice che la rotta di accesso usa per dirlo alla pagina. */
export const CODICE_EMAIL_DA_CONFERMARE = 'EMAIL_NOT_VERIFIED';

/** Cosa fa la pagina di accesso con la risposta della rotta. */
export type EsitoAccesso =
  | { tipo: 'ok' }
  | { tipo: 'email-da-confermare' }
  | { tipo: 'errore'; messaggio: string };

export function esitoDellaRispostaDiAccesso(ok: boolean, corpo: unknown): EsitoAccesso {
  if (ok) return { tipo: 'ok' };
  const errore = (corpo as { error?: unknown } | null)?.error;
  if (errore && typeof errore === 'object' && (errore as { code?: unknown }).code === CODICE_EMAIL_DA_CONFERMARE) {
    return { tipo: 'email-da-confermare' };
  }
  const messaggio =
    (errore && typeof errore === 'object' && typeof (errore as { message?: unknown }).message === 'string'
      ? ((errore as { message: string }).message)
      : undefined) ??
    (typeof errore === 'string' ? errore : undefined) ??
    'Accesso non riuscito';
  return { tipo: 'errore', messaggio };
}

/** Quello che la pagina di verifica sa di chi la sta guardando. */
export type StatoVerifica = {
  /** L'email della sessione, se la persona e' entrata. */
  emailDellaSessione: string | null;
  /** L'email lasciata dalla registrazione o dall'accesso. */
  emailRicordata: string | null;
  /** Quello che la persona ha scritto nel campo. */
  emailScritta: string;
  inCorso: boolean;
};

export type VistaVerifica = {
  /** A chi si rimanda il link. */
  emailPerIlReinvio: string;
  /** Il pulsante «Reinvia» si puo' premere. */
  puoReinviare: boolean;
  /** Serve il campo email (nessuna sessione). */
  chiediEmail: boolean;
  /** «Esci» ha senso solo per chi e' entrato. */
  mostraEsci: boolean;
};

export function vistaDellaVerifica(s: StatoVerifica): VistaVerifica {
  const haSessione = !!s.emailDellaSessione;
  const emailPerIlReinvio = (haSessione ? s.emailDellaSessione! : s.emailScritta || s.emailRicordata || '').trim();
  return {
    emailPerIlReinvio,
    puoReinviare: !s.inCorso && emailPlausibile(emailPerIlReinvio),
    chiediEmail: !haSessione,
    mostraEsci: haSessione,
  };
}

/** Il minimo del client Supabase che serve per rimandare il link. */
export type ClientPerReinvio = {
  auth: {
    resend(credenziali: {
      type: 'signup';
      email: string;
      options?: { emailRedirectTo?: string };
    }): PromiseLike<{ error: { message?: string } | null }>;
  };
};

export type EsitoReinvio = { esito: 'inviato' | 'email-non-valida' | 'errore'; messaggio: string };

/**
 * Rimanda il link di conferma. Non serve una sessione: basta l'email.
 *
 * Il link nuovo torna alla stessa strada del primo (`ritornoDopoLaConferma`),
 * cosi' chi si stava registrando dal checkout torna al suo ordine.
 */
export async function rimandaLinkDiConferma(
  client: ClientPerReinvio,
  dati: { email: string; base: string; returnTo?: string | null },
): Promise<EsitoReinvio> {
  const email = dati.email.trim();
  if (!emailPlausibile(email)) {
    return { esito: 'email-non-valida', messaggio: 'Scrivi l’email con cui ti sei registrato.' };
  }
  const { error } = await client.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: ritornoDopoLaConferma(dati.base, dati.returnTo, 'email') },
  });
  if (error) {
    return {
      esito: 'errore',
      messaggio: traduciErroreAuth(error.message ?? '') ?? 'Non siamo riusciti a mandare l’email. Riprova tra qualche minuto.',
    };
  }
  return {
    esito: 'inviato',
    messaggio:
      'Fatto. Se questa email ha un account da confermare, il nuovo link sta arrivando: controlla anche lo spam. Se l’avevi già confermata, puoi accedere.',
  };
}
