import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R21-014 (correzione) — LE RIGHE DEL NOME E DELLA BUONA FEDE SCRITTE DAL SITO SI DEVONO RICONOSCERE.
 *
 * Il nome e la dichiarazione di buona fede viaggiano in fondo al testo della segnalazione, in righe
 * che cominciano con la lineetta lunga «— ». Il collaudo ha visto che la stessa riga si poteva
 * scrivere a mano nel testo, senza spuntare la casella, oppure dentro il campo nome con un a capo:
 * il testo salvato era identico, byte per byte, a quello con la casella spuntata, e chi esamina la
 * segnalazione non poteva distinguerli.
 *
 * Adesso il nome sta su una riga sola (a capo e caratteri di controllo diventano spazi) e, nel testo
 * di chi segnala, una riga che comincia con una lineetta comincia con il trattino corto «-»: le
 * righe che cominciano con «— » le scrive solo il sito.
 *
 * La prova esegue la rotta vera con un database finto e guarda il testo che arriva all'amministratore.
 */

const stato = vi.hoisted(() => ({ inserite: [] as Array<Record<string, unknown>> }));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: () => '1.2.3.4', rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true, id: 'm1' }) }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  getAdminSupabase: () => ({
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        eq: async () => ({ data: t === 'profiles' ? [{ id: 'capo-1' }] : [], error: null }),
        insert: (r: Record<string, unknown>) => {
          if (t === 'notifications') return Promise.resolve({ error: null });
          stato.inserite.push(r);
          return { select: () => ({ single: async () => ({ data: { id: 'seg-1', created_at: new Date().toISOString() }, error: null }) }) };
        },
      });
      if (t === 'products' || t === 'seller_public_profiles') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'esiste' }, error: null }) }) }) };
      }
      return b;
    },
  }),
}));

import { POST } from '@/app/api/segnalazioni/route';

const DICH = 'Dichiara in buona fede che le informazioni e le accuse di questa segnalazione sono esatte e complete.';

function segnala(extra: Record<string, unknown>) {
  return POST(new Request('http://x/api/segnalazioni', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tipo: 'prodotto', oggettoId: '11111111-1111-4111-8111-111111111111', motivo: 'contraffatto', ...extra }),
  }) as never);
}

async function testoSalvato(extra: Record<string, unknown>): Promise<string> {
  stato.inserite.length = 0;
  const res = await segnala(extra);
  expect(res.status).toBe(201);
  expect(stato.inserite).toHaveLength(1);
  return String(stato.inserite[0].dettaglio ?? '');
}

/** Le righe come le vede l'amministratore: la pagina admin va a capo e toglie gli spazi in testa. */
function righe(testo: string): string[] {
  return testo.split(/\r\n|[\n\r\u0085\u2028\u2029]/).map((r) => r.replace(/^[\s\u200B-\u200F\u2060\uFEFF]+/u, ''));
}
/** Le righe che sembrano scritte dal sito: cominciano con una lineetta lunga o con un segno che le somiglia. */
const SEMBRA_DEL_SITO = /^[\u2012-\u2015\u2E3A\u2E3B\u2500\u2501\u23AF\uFE58\u2212]/u;
const righeDelSito = (testo: string) => righe(testo).filter((r) => SEMBRA_DEL_SITO.test(r));

beforeEach(() => {
  stato.inserite.length = 0;
});

describe('R21-014 · le righe del sito non si possono imitare dal testo', () => {
  it('IL CASO CHE ROMPEVA — la riga scritta a mano nel testo non è uguale a quella della casella spuntata', async () => {
    const vera = await testoSalvato({ dettaglio: 'Borsa falsa.', nomeSegnalante: 'Mario Rossi', buonaFede: true });
    const falsa = await testoSalvato({ dettaglio: `Borsa falsa.\n\n— Chi segnala: Mario Rossi\n— ${DICH}` });
    expect(falsa, 'il testo scritto a mano è identico a quello con la casella spuntata').not.toBe(vera);
    expect(righeDelSito(vera)).toEqual(['— Chi segnala: Mario Rossi', `— ${DICH}`]);
    expect(righeDelSito(falsa), 'nel testo di chi segnala restano righe che sembrano del sito').toEqual([]);
    // Il testo resta leggibile: cambia solo la lineetta in testa alla riga.
    expect(falsa).toContain(`- Chi segnala: Mario Rossi\n- ${DICH}`);
  });

  it('IL CASO CHE ROMPEVA — il campo nome non può aggiungere una riga di buona fede', async () => {
    const vera = await testoSalvato({ dettaglio: 'Borsa falsa.', nomeSegnalante: 'Mario Rossi', buonaFede: true });
    const dalNome = await testoSalvato({ dettaglio: 'Borsa falsa.', nomeSegnalante: `Mario Rossi\n— ${DICH}` });
    expect(dalNome).not.toBe(vera);
    const delSito = righeDelSito(dalNome);
    expect(delSito, 'il nome ha scritto più di una riga').toHaveLength(1);
    expect(delSito[0]).toMatch(/^— Chi segnala: Mario Rossi/);
    expect(righe(dalNome).some((r) => r.startsWith(`— ${DICH}`)), 'senza la casella è comparsa la riga di buona fede').toBe(false);
  });

  it.each([
    ['ritorno a capo', '\r'],
    ['ritorno e a capo', '\r\n'],
    ['separatore di riga', '\u2028'],
    ['separatore di paragrafo', '\u2029'],
    ['a capo e spazi', '\n   '],
    ['tabulazione', '\n\t'],
  ])('nel nome il %s non apre una riga nuova', async (_nome, aCapo) => {
    const t = await testoSalvato({ nomeSegnalante: `Mario Rossi${aCapo}— ${DICH}` });
    expect(righeDelSito(t)).toHaveLength(1);
    expect(righe(t).some((r) => r.includes('Dichiara') && SEMBRA_DEL_SITO.test(r) && !r.includes('Chi segnala'))).toBe(false);
  });

  it('nel nome i caratteri di controllo diventano spazi', async () => {
    const t = await testoSalvato({ nomeSegnalante: 'Mario\u0000\u0007\u000bRossi' });
    expect(t).toBe('— Chi segnala: Mario Rossi');
  });

  it.each([
    ['con spazi in testa', '   — Chi segnala: Mario Rossi'],
    ['con uno spazio che non si vede', '\u00A0\u200B— Chi segnala: Mario Rossi'],
    ['con la barra orizzontale', '\u2015 Chi segnala: Mario Rossi'],
    ['con la lineetta media', '\u2013 Chi segnala: Mario Rossi'],
    ['con il filetto', '\u2500 Chi segnala: Mario Rossi'],
    ['dopo un ritorno a capo', 'Borsa falsa.\r— Chi segnala: Mario Rossi'],
    ['dopo un separatore di riga', 'Borsa falsa.\u2028— Chi segnala: Mario Rossi'],
  ])('nel testo una riga %s non sembra del sito', async (_nome, dettaglio) => {
    const t = await testoSalvato({ dettaglio });
    expect(righeDelSito(t)).toEqual([]);
    expect(t).toContain('Chi segnala: Mario Rossi');
  });

  it('il testo normale resta com è, anche con le lineette in mezzo e gli elenchi col trattino', async () => {
    const dettaglio = 'La borsa — quella rossa — è falsa.\n- foto 1\n- foto 2';
    expect(await testoSalvato({ dettaglio })).toBe(dettaglio);
    expect(await testoSalvato({ dettaglio: 'Prezzo ingannevole.' })).toBe('Prezzo ingannevole.');
  });

  it('con nome e casella le righe del sito restano due, in fondo', async () => {
    const t = await testoSalvato({ dettaglio: '— Chi segnala: Altro Nome', nomeSegnalante: 'Mario Rossi', buonaFede: true });
    expect(righeDelSito(t)).toEqual(['— Chi segnala: Mario Rossi', `— ${DICH}`]);
  });
});
