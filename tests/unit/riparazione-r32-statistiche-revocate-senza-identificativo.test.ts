import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R32-011 — CHI RIFIUTAVA LE STATISTICHE DOPO AVERLE ACCETTATE SI TENEVA L'IDENTIFICATIVO DI UN
 * ANNO, E AL SÌ SUCCESSIVO LE VISITE NUOVE SI RIATTACCAVANO A QUELLE DI PRIMA.
 *
 * `mc_vid` lo mette il server, dura un anno ed è httpOnly: il browser non lo può togliere. Col no
 * la rotta delle visite smetteva di leggerlo, ma nessuno lo cancellava; al sì successivo tornava
 * buono e le visite nuove finivano sotto lo stesso identificativo di quelle di prima della revoca.
 *
 * La prova fa il giro intero con un barattolo di cookie che si comporta come il browser: sì,
 * visita, no, di nuovo sì, visita. L'identificativo della seconda visita non deve essere il primo.
 */

const scritte: Array<Record<string, unknown>> = [];
const registro: { righe: Record<string, unknown>[]; errore: { message: string } | null } = { righe: [], errore: null };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: async () => null,
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  getAdminSupabase: () => ({
    from: () => ({
      insert: async (righe: Record<string, unknown>[]) => {
        registro.righe.push(...righe);
        return { error: registro.errore };
      },
    }),
  }),
}));
vi.mock('@/lib/activity', () => ({
  recordActivity: async (riga: Record<string, unknown>) => { scritte.push(riga); },
  accessoGiaRegistrato: async () => false,
}));

import { POST as traccia } from '@/app/api/track/route';
import { POST as consenso } from '@/app/api/consent/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { CONSENT_COOKIE, CONSENT_VERSION } from '@/lib/consent';

/** Il barattolo dei cookie del browser: legge le risposte come le legge lui. */
class Barattolo {
  private cookie = new Map<string, string>();
  metti(nome: string, valore: string) { this.cookie.set(nome, valore); }
  leggi(nome: string) { return this.cookie.get(nome); }
  intestazione() { return [...this.cookie].map(([k, v]) => `${k}=${v}`).join('; '); }
  ricevi(res: Response) {
    for (const riga of res.headers.getSetCookie()) {
      const [coppia, ...attributi] = riga.split(';').map((x) => x.trim());
      const uguale = coppia.indexOf('=');
      const nome = coppia.slice(0, uguale);
      const scaduto = attributi.some((a) => /^max-age=0$/i.test(a) || (/^expires=/i.test(a) && new Date(a.slice(8)).getTime() <= Date.now()));
      if (scaduto) this.cookie.delete(nome);
      else this.cookie.set(nome, coppia.slice(uguale + 1));
    }
  }
}

const sceltaNelCookie = (statistiche: boolean) => encodeURIComponent(`${CONSENT_VERSION}:0${statistiche ? 1 : 0}0`);

let porta = 0;
function richiesta(url: string, barattolo: Barattolo, corpo: unknown) {
  porta++;
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `93.40.20.${porta % 250}`,
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15',
      cookie: barattolo.intestazione(),
    },
    body: JSON.stringify(corpo),
  });
}

async function visita(b: Barattolo) {
  const res = await traccia(richiesta('https://mycity.test/api/track', b, { event_type: 'page_view', path: '/negozi', session_id: 's-1' }));
  b.ricevi(res);
  return res;
}

async function scegli(b: Barattolo, statistiche: boolean) {
  // Come writeConsent: prima il cookie della scelta nel browser, poi la registrazione sul server.
  b.metti(CONSENT_COOKIE, sceltaNelCookie(statistiche));
  const res = await consenso(richiesta('https://mycity.test/api/consent', b, {
    functional: false, analytics: statistiche, marketing: false, versione: String(CONSENT_VERSION),
  }));
  b.ricevi(res);
  return res;
}

beforeEach(() => {
  scritte.length = 0;
  registro.righe = [];
  registro.errore = null;
  __resetRateLimitBuckets();
});

describe('R32-011 · il no alle statistiche toglie l\'identificativo', () => {
  it('IL CASO CHE ROMPEVA — sì, visita, no, sì, visita: la seconda visita non si riattacca alla prima', async () => {
    const b = new Barattolo();
    await scegli(b, true);
    await visita(b);
    const primo = b.leggi('mc_vid');
    expect(primo, 'col sì la rotta delle visite non ha messo nessun identificativo').toBeTruthy();
    expect(scritte.at(-1)?.anonId).toBe(primo);

    await scegli(b, false);
    expect(b.leggi('mc_vid'), 'dopo il no il browser si tiene l\'identificativo di un anno').toBeUndefined();

    await scegli(b, true);
    await visita(b);
    expect(scritte.at(-1)?.anonId, 'la visita dopo il nuovo sì è finita sotto l\'identificativo di prima della revoca').not.toBe(primo);
    expect(b.leggi('mc_vid')).toBeTruthy();
    expect(b.leggi('mc_vid')).not.toBe(primo);
  });

  it('il no toglie l\'identificativo anche se la scrittura nel registro non riesce', async () => {
    const b = new Barattolo();
    b.metti('mc_vid', 'vecchio-identificativo');
    registro.errore = { message: 'giù' };
    const res = await scegli(b, false);
    expect(res.status).toBe(500);
    expect(b.leggi('mc_vid')).toBeUndefined();
  });

  it('il sì non tocca l\'identificativo che c\'è', async () => {
    const b = new Barattolo();
    b.metti('mc_vid', 'identificativo-buono');
    await scegli(b, true);
    expect(b.leggi('mc_vid')).toBe('identificativo-buono');
  });

  it('IL CASO CHE ROMPEVA — se un identificativo arriva alla rotta delle visite senza consenso (scaduto, rifiutato), la rotta lo cancella', async () => {
    const b = new Barattolo();
    b.metti(CONSENT_COOKIE, sceltaNelCookie(false));
    b.metti('mc_vid', 'vecchio-identificativo');
    // Accesso e disconnessione arrivano anche senza consenso (sono sicurezza).
    const res = await traccia(richiesta('https://mycity.test/api/track', b, { event_type: 'logout', session_id: 's-2' }));
    b.ricevi(res);
    expect(res.status).toBe(204);
    expect(b.leggi('mc_vid'), 'senza consenso l\'identificativo resta nel browser per un anno').toBeUndefined();
    expect(scritte.at(-1)?.anonId ?? null).toBeNull();
    // E con la pagina vista, che senza consenso non si registra.
    b.metti('mc_vid', 'vecchio-identificativo');
    b.ricevi(await visita(b));
    expect(b.leggi('mc_vid')).toBeUndefined();
  });
});
