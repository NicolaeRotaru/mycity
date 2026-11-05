import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { leggiConsegneDelFattorino } from '@/lib/rider/consegne-del-fattorino';

/**
 * Sessione S02 (5/11/2026) — le pagine del fattorino.
 *  · 649: Guadagni e contatore del profilo leggono la vista dello storico (niente taglio dei 7 giorni),
 *         con ripiego su `orders` finché la migrazione 205 non porta la colonna del bonifico;
 *  · 404: niente «bonus giornaliero» che nessuno paga;
 *  · 298: Guadagni, Storico, Recensioni, Profilo e Turni dicono «non riesco a leggere» invece di zero.
 */
type Esito = { data: unknown; error: unknown };
function dbFinto(vista: Esito, orders: Esito) {
  const letti: string[] = [];
  const q = (esito: Esito) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.order = () => Promise.resolve(esito);
    return b;
  };
  return {
    letti,
    from: (t: string) => { letti.push(t); return q(t === 'orders' ? orders : vista); },
  };
}
const CONSEGNA_VECCHIA = { id: 'o-20-giorni-fa', rider_fee_cents: 300, delivered_at: '2026-10-16T10:00:00Z', rider_payout_status: 'PAID' };

describe('649 · le consegne del fattorino', () => {
  it('si leggono dalla vista dello storico (anche quella di 20 giorni fa), non da orders', async () => {
    const db = dbFinto({ data: [CONSEGNA_VECCHIA], error: null }, { data: [], error: null });
    const righe = await leggiConsegneDelFattorino(db as never, 'r1');
    expect(righe.map((r) => r.id)).toEqual(['o-20-giorni-fa']);
    expect(db.letti).toEqual(['rider_consegne_storico']);
  });

  it('senza la colonna del bonifico (migrazione 205 non ancora applicata) ripiega su orders', async () => {
    const db = dbFinto({ data: null, error: { code: '42703', message: 'column does not exist' } }, { data: [CONSEGNA_VECCHIA], error: null });
    expect((await leggiConsegneDelFattorino(db as never, 'r1')).length).toBe(1);
    expect(db.letti).toEqual(['rider_consegne_storico', 'orders']);
  });

  it('un guasto vero non si trasforma in «nessuna consegna»: lancia', async () => {
    const db = dbFinto({ data: null, error: { code: '08006', message: 'giù' } }, { data: [], error: null });
    await expect(leggiConsegneDelFattorino(db as never, 'r1')).rejects.toBeTruthy();
  });

  it('Guadagni e profilo usano la vista; la migrazione 205 aggiunge rider_payout_status in coda', () => {
    expect(readFileSync('app/rider/earnings/page.tsx', 'utf8')).toContain('leggiConsegneDelFattorino(supabase, user.id)');
    const profilo = readFileSync('app/rider/profile/page.tsx', 'utf8');
    expect(profilo).toContain("from('rider_consegne_storico').select('id', { count: 'exact', head: true })");
    const m = readFileSync('migrations/205_i_guadagni_del_fattorino_oltre_i_sette_giorni.sql', 'utf8');
    expect(m).toMatch(/o\.delivery_city,\s*o\.rider_payout_status\s*FROM/);
    expect(m).toContain('security_invoker = off');
    expect(m).toContain('security_barrier = true');
    expect(m).toContain('REVOKE ALL    ON public.rider_consegne_storico FROM PUBLIC, anon;');
  });
});

describe('404 · niente bonus che nessuno paga', () => {
  it('la pagina Guadagni non promette +2,00 €', () => {
    const src = readFileSync('app/rider/earnings/page.tsx', 'utf8');
    expect(src).not.toMatch(/Bonus giornaliero|sbloccati|DAILY_GOAL/);
  });
});

describe('298 · cinque pagine del fattorino dicono l errore prima del vuoto', () => {
  it('ognuna ha un ramo d errore con Riprova', () => {
    for (const f of ['app/rider/earnings/page.tsx', 'app/rider/history/page.tsx', 'app/rider/reviews/page.tsx', 'app/rider/profile/page.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/isError, refetch \} = useQuery/);
      expect(src, f).toContain('<ErrorState');
    }
    const turni = readFileSync('app/rider/availability/page.tsx', 'utf8');
    expect(turni).toContain('if (letturaFallita) {');
    expect(turni).toMatch(/if \(error\) \{\s*setLetturaFallita\(true\);/);
  });
});
