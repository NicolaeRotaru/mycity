/**
 * 3/9/2026 — L'ACCESSO CON GOOGLE NON LASCIAVA NESSUNA RIGA NEL REGISTRO.
 *
 * Il registro degli accessi è quello che si va a guardare quando a qualcuno
 * rubano l'account: dice da quale indirizzo, con quale dispositivo, a che ora è
 * entrato. Nell'informativa è difeso come sicurezza, e infatti si tiene anche
 * per chi rifiuta i cookie statistici.
 *
 * Dentro però c'era solo una parte delle persone. L'unico a scriverci era il
 * tracker del browser, che manda «accesso» quando vede la sessione passare da
 * «nessuno» a «qualcuno» DENTRO la pagina. Con Google — e con il link di
 * conferma della mail — la sessione la crea il server in `/auth/callback`, e la
 * pagina riparte con la persona già dentro: quel passaggio non avviene mai.
 *
 * Risultato: per ogni accesso con Google non c'era né indirizzo, né dispositivo,
 * né ora. Chi doveva indagare un furto d'account non aveva niente da guardare.
 *
 * Due prove, perché il difetto ha due facce:
 *  ① chi entra con Google adesso lascia la riga (prima: nessuna);
 *  ② chi entra con email e password ne lascia UNA SOLA, non due — perché per lui
 *    i segnali sono due e il fatto è uno.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/analytics/posthog', () => ({ track: async () => {} }));

/** Le righe che sarebbero finite in `activity_events`. */
const scritte: Record<string, unknown>[] = [];
/** Gli accessi già presenti nel database, dal più recente, come li legge la rotta. */
let accessiNelDatabase: Array<{ created_at: string; session_id: string | null }> = [];

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: async () => ({ id: 'chi-e-appena-entrato' }),
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: async (quanti: number) => ({ data: accessiNelDatabase.slice(0, quanti), error: null }),
            }),
          }),
        }),
      }),
      insert: async (riga: Record<string, unknown>) => {
        scritte.push(riga);
        if (riga.event_type === 'login') {
          accessiNelDatabase.unshift({
            created_at: new Date().toISOString(),
            session_id: (riga.session_id as string) ?? null,
          });
        }
        return { error: null };
      },
    }),
  }),
}));

import { trackSignedIn, trackSignupCompleted } from '@/lib/analytics/events';
import { CHIAVE_SESSIONE_BROWSER, ROTTA_DEL_REGISTRO } from '@/lib/analytics/registro-accessi';
import { __riaccendiRegistrazione } from '@/lib/activity';
import { POST } from '@/app/api/track/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

/** Quello che il browser spedirebbe alla rotta. */
const spediti: Array<{ url: string; corpo: Record<string, unknown> }> = [];

/** Blob finto: si ricorda il testo che gli è stato dato. */
class BlobFinto {
  testo: string;
  constructor(pezzi: string[]) { this.testo = pezzi.join(''); }
}

beforeEach(() => {
  spediti.length = 0;
  scritte.length = 0;
  accessiNelDatabase = [];
  __riaccendiRegistrazione();
  __resetRateLimitBuckets();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => (k === CHIAVE_SESSIONE_BROWSER ? 'sessione-di-questo-browser' : null),
  });
  vi.stubGlobal('Blob', BlobFinto);
  vi.stubGlobal('navigator', {
    sendBeacon: (url: string, corpo: BlobFinto) => {
      spediti.push({ url, corpo: JSON.parse(corpo.testo) });
      return true;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chi entra dal pulsante Google', () => {
  it('IL CASO CHE ROMPEVA — lascia una riga nel registro degli accessi', () => {
    trackSignedIn('utente-google', 'google');

    expect(spediti.length, "l'accesso con Google non lascia nessuna traccia: un furto d'account resta invisibile")
      .toBe(1);
    expect(spediti[0].url).toBe(ROTTA_DEL_REGISTRO);
    expect(spediti[0].corpo.event_type).toBe('login');
    expect((spediti[0].corpo.metadata as Record<string, unknown>).metodo).toBe('google');
  });

  it('anche chi si registra dal link di conferma della mail, che passa dalla stessa porta', () => {
    trackSignupCompleted('utente-nuovo', 'buyer', 'email');

    expect(spediti.length).toBe(1);
    expect(spediti[0].corpo.event_type).toBe('login');
  });

  it("porta con sé la sessione del browser: serve a non contare due volte lo stesso accesso", () => {
    trackSignedIn('utente-email', 'email');
    expect(spediti[0].corpo.session_id).toBe('sessione-di-questo-browser');
  });
});

/**
 * L'ALTRA FACCIA: il segnale in più non deve diventare una riga in più.
 *
 * Chi entra con email e password fa partire due segnali quasi insieme — quello
 * del catalogo eventi e quello del tracker che vede cambiare la sessione. Il
 * fatto però è uno solo: nel registro deve restare una riga sola, altrimenti
 * ogni accesso viene contato doppio e il cruscotto mente al contrario.
 */
describe('lo stesso accesso che arriva due volte alla rotta', () => {
  const segnale = (corpo: Record<string, unknown>) =>
    POST(new Request('https://mycity.test/api/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '93.40.20.7' },
      body: JSON.stringify(corpo),
    }));

  const accessiScritti = () => scritte.filter((r) => r.event_type === 'login').length;

  it('la seconda copia non diventa una seconda riga', async () => {
    // ① il catalogo eventi (la strada nuova, quella che copre Google)
    await segnale({ event_type: 'login', session_id: 'sessione-A', metadata: { metodo: 'email' } });
    // ② il tracker che vede cambiare la sessione nel browser (la strada vecchia)
    await segnale({ event_type: 'login', session_id: 'sessione-A' });

    expect(accessiScritti(), 'lo stesso accesso è finito due volte nel registro: gli accessi si contano doppi')
      .toBe(1);
  });

  it("un accesso da un altro dispositivo si vede: è proprio quello da guardare dopo un furto", async () => {
    await segnale({ event_type: 'login', session_id: 'sessione-A' });
    await segnale({ event_type: 'login', session_id: 'sessione-B' });

    expect(accessiScritti()).toBe(2);
  });

  it('la riga porta indirizzo, dispositivo e metodo: senza, non c\'è niente da guardare', async () => {
    await segnale({ event_type: 'login', session_id: 'sessione-A', metadata: { metodo: 'google' } });

    const riga = scritte.find((r) => r.event_type === 'login');
    expect(riga?.ip).toBe('93.40.20.7');
    expect(riga?.user_id).toBe('chi-e-appena-entrato');
    expect((riga?.metadata as Record<string, unknown>).metodo).toBe('google');
  });

  it("la pagina vista non passa da questo controllo: si scrive sempre", async () => {
    await segnale({ event_type: 'login', session_id: 'sessione-A' });
    const prima = scritte.length;
    await segnale({ event_type: 'page_view', path: '/', session_id: 'sessione-A' });
    // Senza consenso statistico la pagina vista non si registra: è la regola di
    // R064, e va lasciata in pace. Qui basta che il controllo dei doppioni non
    // abbia toccato nulla d'altro.
    expect(scritte.length).toBe(prima);
  });
});
