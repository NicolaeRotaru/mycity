/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * 5/11/2026 (S04, scheda 260) — Il controllo giornaliero dei punti contava il giorno con la data di
 * Greenwich. Venerdì 6/11 alle 00:30 a Piacenza è ancora giovedì 5/11 a Greenwich: il browser
 * diceva «già fatto oggi», non chiamava il database, e il giorno dopo la serie ripartiva da 1.
 * La metà nel database (touch_loyalty_streak con CURRENT_DATE) la chiude la migrazione 215.
 */
const g = globalThis as Record<string, unknown>;

afterEach(() => {
  vi.useRealTimers();
  for (const k of ['__PROFILO__', '__CLIENT_SUPABASE__']) delete g[k];
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('il controllo giornaliero', () => {
  // 5/11/2026 (unione delle dieci sessioni) — Al lancio inviti e punti sono spenti
  // (INVITI_E_PUNTI_ACCESI = false, S07 scheda 2429): il controllo giornaliero non chiama il
  // database. La correzione del giorno di Piacenza resta nel codice per quando si riaccendono,
  // e si prova sulla funzione che il componente usa.
  it('coi punti spenti al lancio non chiama il database, nemmeno a giorno nuovo', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-11-05T23:30:00Z')); // venerdì 6/11, 00:30 a Piacenza
    localStorage.setItem('mc_last_checkin', JSON.stringify('2026-11-05')); // giovedì sera
    const chiamate: string[] = [];
    g.__CLIENT_SUPABASE__ = {
      from: () => { throw new Error('nessuna tabella qui'); },
      rpc: async (nome: string) => { chiamate.push(nome); return { data: { streak: 2, bonus: 0, already_today: false }, error: null }; },
    };
    g.__PROFILO__ = { isAuthenticated: true, isBuyer: true };
    const mod = await monta('components/DailyCheckIn.tsx');
    accendi(mod.default);
    await attendi();
    await attendi();
    await vi.advanceTimersByTimeAsync(2000);
    expect(chiamate).toEqual([]);
  });

  it('a mezzanotte e mezza di Piacenza è già il giorno nuovo, e il componente conta così', async () => {
    const { giornoPiacenza } = await import('@/lib/tempo-piacenza');
    expect(giornoPiacenza(new Date('2026-11-05T23:30:00Z'))).toBe('2026-11-06');
    expect(giornoPiacenza(new Date('2026-07-05T22:30:00Z'))).toBe('2026-07-06'); // d'estate, UTC+2
    const { readFileSync } = await import('node:fs');
    const sorgente = readFileSync('components/DailyCheckIn.tsx', 'utf8');
    expect(sorgente).toMatch(/const today = giornoPiacenza\(\)/);
    expect(sorgente).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/);
  });

  it('nello stesso giorno di Piacenza non richiama il database', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-11-05T23:30:00Z'));
    localStorage.setItem('mc_last_checkin', JSON.stringify('2026-11-06'));
    const chiamate: string[] = [];
    g.__CLIENT_SUPABASE__ = { from: () => ({}), rpc: async (nome: string) => { chiamate.push(nome); return { data: null, error: null }; } };
    g.__PROFILO__ = { isAuthenticated: true, isBuyer: true };
    const mod = await monta('components/DailyCheckIn.tsx');
    accendi(mod.default);
    await attendi();
    await attendi();
    await vi.advanceTimersByTimeAsync(2000);
    expect(chiamate).toEqual([]);
  });
});
