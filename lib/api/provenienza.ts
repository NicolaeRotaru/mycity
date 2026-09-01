import { env } from '@/lib/env';

/**
 * DA DOVE ARRIVA QUESTA RICHIESTA.
 *
 * 30/8/2026 (R022) — CONTRO LA FALSIFICAZIONE DA UN ALTRO SITO NON C'ERA
 * NESSUNA DIFESA NOSTRA.
 *
 * Le rotte che scrivono — annullare un ordine, decidere un reso, confermare un
 * incasso in contanti, moderare — si autenticano col cookie di sessione. Non
 * c'era nessun gettone anti-falsificazione e nessun controllo di provenienza:
 * una pagina ostile aperta in un'altra scheda poteva mandare una richiesta al
 * nostro sito, e il browser ci avrebbe attaccato il cookie di chi era entrato.
 *
 * Oggi non passa niente, ma per un motivo che non è nostro: i cookie di
 * sessione li scrive `@supabase/ssr` con `SameSite=Lax` di suo. È una
 * protezione EREDITATA. Il giorno che quel valore predefinito cambia, o che
 * qualcuno mette `sameSite: 'none'` per far funzionare un incorporamento,
 * cadono insieme tutte le rotte che scrivono — in una volta e senza nessun
 * segnale.
 *
 * Qui la difesa diventa nostra, e sta in un posto solo: `authenticate()`, per
 * cui passano tutte le rotte.
 *
 * COSA SI RIFIUTA, E COSA NO.
 *
 *  · I metodi che leggono (GET, HEAD, OPTIONS) passano sempre: non cambiano
 *    niente, e bloccarli romperebbe i collegamenti che arrivano da fuori.
 *  · `Sec-Fetch-Site: cross-site` è il browser che dichiara «questa richiesta
 *    parte da un altro sito»: su un metodo che scrive, si rifiuta.
 *  · Se c'è `Origin` e non è il nostro sito, si rifiuta.
 *  · Se `Origin` non c'è affatto, si passa. Non è una svista: le chiamate che
 *    non arrivano da un browser — un'app, uno script, un servizio col gettone
 *    nell'intestazione — l'`Origin` non lo mandano, e non sono il pericolo di
 *    cui si parla qui (una pagina ostile non può scegliere che intestazioni
 *    manda il browser).
 *
 * Il confronto si fa con l'indirizzo della richiesta stessa oltre che con
 * quello configurato: così un'anteprima su un dominio diverso continua a
 * funzionare senza che nessuno debba ricordarsi di aggiornare una variabile.
 */

const METODI_CHE_LEGGONO = new Set(['GET', 'HEAD', 'OPTIONS']);

function host(indirizzo: string | null | undefined): string | null {
  if (!indirizzo) return null;
  try {
    return new URL(indirizzo).host.toLowerCase() || null;
  } catch {
    return null;
  }
}

export type RichiestaDaGuardare = {
  method?: string;
  url?: string;
  headers: { get(nome: string): string | null };
};

export function arrivaDaUnAltroSito(req: RichiestaDaGuardare): boolean {
  const metodo = (req.method ?? 'GET').toUpperCase();
  if (METODI_CHE_LEGGONO.has(metodo)) return false;

  if ((req.headers.get('sec-fetch-site') ?? '').toLowerCase() === 'cross-site') return true;

  const origine = host(req.headers.get('origin'));
  // Niente Origin: non è un browser che manda una richiesta da un'altra pagina.
  if (!origine) return false;

  const nostri = new Set(
    [host(req.url), req.headers.get('host')?.toLowerCase() ?? null, host(env.appUrl())].filter(
      (h): h is string => !!h,
    ),
  );
  return !nostri.has(origine);
}
