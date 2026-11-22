/**
 * @vitest-environment jsdom
 */
/**
 * La pagina dei punti parla italiano: niente «streak», «referral» e «checkout» (prova leggera).
 * Disegna la pagina vera e legge il testo che la persona vede; per la lista «Come accumuli punti»
 * (accesa solo quando i punti si riaccendono) legge le frasi dal sorgente di quel solo blocco.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

type Pagina = ComponentType<Record<string, unknown>>;
const g = globalThis as unknown as Record<string, unknown>;
const INGLESE = /streak|referral|checkout/i;
let Punti: Pagina;
const montate: Array<{ smonta: () => void; radice: Element }> = [];

beforeAll(async () => {
  Punti = (await monta('app/profile/loyalty/page.tsx')).default as Pagina;
}, 120000);

afterEach(() => {
  while (montate.length) montate.pop()!.smonta();
  delete g.__DATI_QUERY__;
  delete g.__UTENTE__;
});

async function aspettaChe(vero: () => boolean, ms = 3000): Promise<void> {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    if (vero()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}
const chiave = (o: unknown) => JSON.stringify((o as { queryKey?: unknown })?.queryKey ?? []);

describe('la pagina dei punti, vista da chi la apre', () => {
  it('schede e movimenti dicono «giorni di fila» e «amico invitato», senza parole inglesi', async () => {
    g.__UTENTE__ = { id: 'maria-1', email: 'maria@example.it' };
    g.__DATI_QUERY__ = (o: unknown) => {
      const k = chiave(o);
      if (k.includes('"account"')) {
        return { user_id: 'maria-1', points_balance: 140, lifetime_earned: 140, tier: 'bronze', streak_days: 2, last_visit_date: null, longest_streak: 3 };
      }
      if (k.includes('"txs"')) {
        return [
          { id: 'a', delta: 20, reason: 'streak_7_days', created_at: '2026-11-01T10:00:00Z' },
          { id: 'b', delta: 100, reason: 'streak_30_days', created_at: '2026-11-02T10:00:00Z' },
          { id: 'c', delta: 500, reason: 'streak_100_days', created_at: '2026-11-03T10:00:00Z' },
          { id: 'd', delta: 50, reason: 'referral_bonus', created_at: '2026-11-04T10:00:00Z' },
        ];
      }
      if (k.includes('"wallet"')) return 0;
      return [];
    };
    const s = accendi(Punti);
    montate.push(s);
    await aspettaChe(() => /Amico invitato/.test(testoVisibile(s.radice)));
    const testo = testoVisibile(s.radice);
    expect(testo, 'la pagina dei punti non si è disegnata').toMatch(/140/);
    expect(testo).toMatch(/Giorni di fila/);
    expect(testo).toMatch(/record di giorni di fila/i);
    expect(testo).toMatch(/7 giorni di fila/);
    expect(testo).toMatch(/30 giorni di fila/);
    expect(testo).toMatch(/100 giorni di fila/);
    expect(testo).toMatch(/Amico invitato/);
    expect(testo).not.toMatch(INGLESE);
  });

  it('la lista «Come accumuli punti», quando i punti si riaccendono, dice «in cassa» e «il tuo codice»', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'app', 'profile', 'loyalty', 'page.tsx'), 'utf8');
    const blocco = src.slice(src.indexOf('Come accumuli punti'));
    const frasi = Array.from(blocco.matchAll(/t: [`'](.*?)[`'] \}/g)).map((m) => m[1]);
    expect(frasi.length).toBeGreaterThanOrEqual(6);
    for (const f of frasi) expect(f, f).not.toMatch(INGLESE);
    expect(frasi.join(' | ')).toMatch(/in cassa/);
    expect(frasi.join(' | ')).toMatch(/con il tuo codice( \||$)/);
    expect(frasi.join(' | ')).not.toMatch(/alla cassa|codice di invito/);
  });
});
