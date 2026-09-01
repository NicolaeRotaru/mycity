import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CHI RIFIUTA I COOKIE NON VIENE SCHEDATO PER SEI MESI.
 *
 * 27/8/2026 (R061) — «Rifiuta tutto» fa partire la stessa registrazione lato
 * server di «Accetta»: la rotta creava un cookie `mc_cid` da 180 giorni e
 * scriveva nel registro una riga per categoria con indirizzo di rete e browser.
 *
 * L'art. 7.1 del GDPR chiede di poter dimostrare il CONSENSO. Per il rifiuto
 * non c'è un obbligo di prova equivalente, e tenere per sei mesi un
 * identificatore persistente più IP e browser di chi ha appena detto no è il
 * contrario della minimizzazione (art. 5.1.c).
 *
 * È il dettaglio che in un'ispezione sui cookie ribalta il giudizio: il banner
 * è fatto bene — pulsanti di pari peso, X che rifiuta, categorie spente di
 * default — e poi si scopre che chi rifiuta viene comunque schedato.
 *
 * Quello che DEVE restare è la scelta stessa: categoria, valore, data e
 * versione del testo. Senza quella riga la scelta non si può nemmeno rispettare.
 */

const stato: { righe: Record<string, unknown>[] } = { righe: [] };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  getAdminSupabase: () => ({
    from: () => ({
      insert: async (righe: Record<string, unknown>[]) => {
        stato.righe.push(...righe);
        return { error: null };
      },
    }),
  }),
}));

import { POST } from '@/app/api/consent/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

let contatore = 0;
function scegli(scelta: Record<string, unknown>) {
  contatore++;
  return POST(new Request('https://mycity.test/api/consent', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `93.40.10.${contatore % 250}`,
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    },
    body: JSON.stringify(scelta),
  }));
}

const cookieMessi = (res: Response) => res.headers.get('set-cookie') ?? '';

beforeEach(() => {
  stato.righe = [];
  __resetRateLimitBuckets();
});

describe('quando qualcuno rifiuta tutto', () => {
  it('IL CASO CHE ROMPEVA — niente identificatore da sei mesi', async () => {
    const res = await scegli({ functional: false, analytics: false, marketing: false, versione: '1' });

    expect(res.status).toBe(200);
    expect(
      cookieMessi(res),
      'a chi ha appena detto no viene messo un identificatore che dura 180 giorni',
    ).not.toContain('mc_cid');
  });

  it('IL CASO CHE ROMPEVA — niente indirizzo di rete e niente browser nel registro', async () => {
    await scegli({ functional: false, analytics: false, marketing: false, versione: '1' });

    expect(stato.righe.length).toBeGreaterThan(0);
    for (const riga of stato.righe) {
      expect(riga.ip, 'l indirizzo di chi ha rifiutato resta a verbale per sei mesi').toBeNull();
      expect(riga.user_agent, 'il browser di chi ha rifiutato resta a verbale').toBeNull();
    }
  });

  it('la scelta però si registra: senza, non si potrebbe nemmeno rispettarla', async () => {
    await scegli({ functional: false, analytics: false, marketing: false, versione: '1' });

    const categorie = stato.righe.map((r) => r.categoria).sort();
    expect(categorie).toEqual(['analytics', 'functional', 'marketing']);
    expect(stato.righe.every((r) => r.valore === false)).toBe(true);
    expect(stato.righe.every((r) => r.versione_testo === '1')).toBe(true);
  });
});

describe('quando qualcuno accetta, la prova resta completa', () => {
  it('un sì porta con sé indirizzo, browser e identificatore: è la prova che il GDPR chiede', async () => {
    const res = await scegli({ functional: true, analytics: true, marketing: true, versione: '1' });

    expect(stato.righe.every((r) => typeof r.ip === 'string' && r.ip)).toBe(true);
    expect(stato.righe.every((r) => typeof r.user_agent === 'string')).toBe(true);
    expect(cookieMessi(res)).toContain('mc_cid');
  });

  it('un sì anche parziale resta una prova completa', async () => {
    await scegli({ functional: true, analytics: false, marketing: false, versione: '1' });
    expect(stato.righe.every((r) => typeof r.ip === 'string' && r.ip)).toBe(true);
  });
});
