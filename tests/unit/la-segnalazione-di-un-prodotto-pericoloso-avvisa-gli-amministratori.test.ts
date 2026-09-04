import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * LA SEGNALAZIONE DI UN PRODOTTO PERICOLOSO AVVISA GLI AMMINISTRATORI.
 *
 * 3/9/2026 — LA SEGNALAZIONE ARRIVAVA E NON SUONAVA NIENTE.
 *
 * Chi trova sul sito un prodotto contraffatto o pericoloso lo segnala dal
 * modulo pubblico. La segnalazione veniva salvata, ma la riga di avviso agli
 * amministratori nasceva con categoria «moderation», e il database ne ammette
 * cinque sole (migrazione 115): la scrittura veniva rifiutata. E il codice non
 * guardava il campo `error` che il client Supabase restituisce — quel client
 * non solleva eccezioni, quindi il try/catch attorno non scattava mai. La rotta
 * rispondeva «ricevuto», l'avviso non c'era e nei registri non compariva
 * niente: la segnalazione restava li' finche' qualcuno non apriva a mano la
 * pagina delle segnalazioni. E' il canale che il regolamento europeo sui
 * servizi digitali obbliga ad avere e a lavorare in tempi ragionevoli.
 *
 * Questa prova ESEGUE la rotta con un database che si comporta come quello
 * vero: rifiuta la categoria sbagliata e restituisce l'errore invece di
 * sollevarlo.
 */

/** Le cinque che il database accetta (migrazione 115). */
const AMMESSE = ['order', 'promo', 'group', 'newsletter', 'system'];

const registrate: Array<Record<string, unknown>> = [];
const avvisiScritti: Array<Record<string, unknown>> = [];

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '1.2.3.4',
  rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }),
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'segnalazioni') {
        return {
          insert: (riga: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                registrate.push(riga);
                return { data: { id: 'seg-1' }, error: null };
              },
            }),
          }),
        };
      }
      if (tabella === 'profiles') {
        return { select: () => ({ eq: async () => ({ data: [{ id: 'capo-1' }], error: null }) }) };
      }
      if (tabella === 'notifications') {
        return {
          // Il database vero si comporta cosi': RIFIUTA la categoria fuori
          // elenco e restituisce l'errore, senza sollevarlo.
          insert: async (righe: Array<Record<string, unknown>>) => {
            const fuori = righe.find((r) => !AMMESSE.includes(String(r.category)));
            if (fuori) {
              return {
                error: {
                  code: '23514',
                  message: `new row for relation "notifications" violates check constraint "notifications_category_check"`,
                },
              };
            }
            avvisiScritti.push(...righe);
            return { error: null };
          },
        };
      }
      return { insert: async () => ({ error: null }) };
    },
  }),
}));

import { POST } from '@/app/api/segnalazioni/route';
import { logger } from '@/lib/logger';

function segnala() {
  const req = new Request('http://localhost/api/segnalazioni', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tipo: 'prodotto',
      oggettoId: '11111111-1111-1111-1111-111111111111',
      motivo: 'pericoloso',
      dettaglio: 'Il giocattolo si sfalda e le parti piccole si staccano.',
    }),
  });
  return POST(req as never);
}

beforeEach(() => {
  registrate.length = 0;
  avvisiScritti.length = 0;
  vi.clearAllMocks();
});

describe('un cliente segnala un prodotto pericoloso', () => {
  it('la segnalazione viene registrata e la rotta risponde ricevuto', async () => {
    const res = await segnala();

    expect(res.status).toBe(201);
    expect(registrate).toHaveLength(1);
    expect(registrate[0].motivo).toBe('pericoloso');
  });

  it('IL CASO CHE ROMPEVA — l avviso arriva davvero agli amministratori', async () => {
    await segnala();

    expect(
      avvisiScritti,
      'la riga di avviso non e stata scritta: il database ha rifiutato la categoria',
    ).toHaveLength(1);
    expect(avvisiScritti[0].user_id).toBe('capo-1');
    expect(avvisiScritti[0].link).toBe('/admin/segnalazioni');
  });

  it('IL CASO CHE ROMPEVA — la categoria e una di quelle che il database accetta', async () => {
    await segnala();

    expect(avvisiScritti.map((a) => a.category)).toEqual(['system']);
  });

  it('e non si puo spegnere dalle preferenze: e un avviso di servizio', async () => {
    await segnala();

    // `vuole_notifica` (migrazione 115) lascia passare sempre «system»: una
    // segnalazione di prodotto pericoloso non deve poter essere silenziata.
    expect(avvisiScritti[0].category).toBe('system');
  });
});

describe('se un giorno la scrittura fallisce lo stesso, non sparisce', () => {
  it('IL CASO CHE ROMPEVA — il rifiuto del database finisce nei registri', async () => {
    // Rimetto la categoria sbagliata dal di fuori, come se qualcuno la
    // reintroducesse: la rotta deve LEGGERE l'errore, non ignorarlo.
    const admin = (await import('@/lib/supabase/server')).getAdminSupabase();
    const originale = admin.from;
    const finto = {
      ...admin,
      from: (tabella: string) => {
        if (tabella === 'notifications') {
          return { insert: async () => ({ error: { code: '23514', message: 'categoria rifiutata' } }) };
        }
        return (originale as (t: string) => unknown)(tabella);
      },
    };
    vi.spyOn(await import('@/lib/supabase/server'), 'getAdminSupabase').mockReturnValue(
      finto as ReturnType<typeof admin extends never ? never : () => never>,
    );

    await segnala();

    expect(logger.error, 'il fallimento e sparito: nessuno sapra mai che l avviso non e partito').toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
