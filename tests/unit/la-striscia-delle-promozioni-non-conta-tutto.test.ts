/**
 * 27/8/2026 (R084) — UN CONTEGGIO COMPLETO PER RISPONDERE SÌ O NO, SU OGNI PAGINA DEL SITO.
 *
 * La striscia in cima («Promozioni attive») doveva sapere una cosa sola: ce n'è almeno una?
 * Lo chiedeva con `count: 'exact'`, che obbliga il database a contare TUTTE le righe che passano il
 * filtro invece di fermarsi alla prima. E la striscia sta nella barra di navigazione, cioè su ogni
 * pagina, per ogni visitatore.
 *
 * La prova esegue la lettura contro un finto PostgREST che registra COME è stata chiesta: se
 * qualcuno rimette il conteggio esatto, diventa rossa.
 */
import { describe, it, expect } from 'vitest';
import { fintoDb } from './aiuti/finto-postgrest';
import { ciSonoPromoAttive } from '@/lib/queries/promo-attive';
import type { SupabaseClient } from '@supabase/supabase-js';

const ORA = new Date('2026-08-27T12:00:00Z');
const promo = (id: string, dal: string, al: string, status = 'active') => ({
  id, status, starts_at: dal, ends_at: al,
});

const conPromozioni = (righe: ReturnType<typeof promo>[]) => fintoDb({ seller_promotions: righe });

describe('la striscia delle promozioni', () => {
  it('dice di sì quando ce n è almeno una attiva', async () => {
    const db = conPromozioni([promo('1', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z')]);
    expect(await ciSonoPromoAttive(db.client as unknown as SupabaseClient, ORA)).toBe(true);
  });

  it('dice di no quando non ce ne sono', async () => {
    const db = conPromozioni([]);
    expect(await ciSonoPromoAttive(db.client as unknown as SupabaseClient, ORA)).toBe(false);
  });

  it('una promozione scaduta ieri non accende la striscia', async () => {
    const db = conPromozioni([promo('1', '2026-07-01T00:00:00Z', '2026-08-26T00:00:00Z')]);
    expect(await ciSonoPromoAttive(db.client as unknown as SupabaseClient, ORA)).toBe(false);
  });

  it('e nemmeno una che comincia domani', async () => {
    const db = conPromozioni([promo('1', '2026-08-28T00:00:00Z', '2026-09-30T00:00:00Z')]);
    expect(await ciSonoPromoAttive(db.client as unknown as SupabaseClient, ORA)).toBe(false);
  });

  it('per rispondere non fa contare tutte le righe al database', async () => {
    const db = conPromozioni([
      promo('1', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      promo('2', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      promo('3', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
    ]);

    await ciSonoPromoAttive(db.client as unknown as SupabaseClient, ORA);

    expect(db.chiamate).toHaveLength(1);
    expect(db.chiamate[0].conteggioEsatto, 'il database conta tutte le promozioni per dire sì o no, su ogni pagina').toBe(false);
    expect(db.chiamate[0].tetto, 'senza tetto il database non si ferma alla prima riga utile').toBe(1);
  });
});
