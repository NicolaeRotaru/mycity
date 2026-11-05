import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getAccountMenuItems } from '@/lib/account-menu';
import { INVITI_E_PUNTI_ACCESI } from '@/lib/funzioni-al-lancio';

describe('S07 · l\'interruttore «inviti e punti» spegne anche i punti', () => {
  it('al lancio è spento', () => {
    expect(INVITI_E_PUNTI_ACCESI).toBe(false);
  });
  it('il menu del cliente non mostra «Punti & Livello»', () => {
    const voci = getAccountMenuItems('buyer').map((v) => v.label);
    expect(voci).not.toContain('Punti & Livello');
    expect(voci).toContain('I miei ordini');
  });
  it('il passaggio giornaliero che assegna i punti legge l\'interruttore prima di chiamare il database', () => {
    const src = readFileSync('components/DailyCheckIn.tsx', 'utf8');
    const freno = src.indexOf('if (!INVITI_E_PUNTI_ACCESI) return;');
    expect(freno).toBeGreaterThan(-1);
    expect(freno).toBeLessThan(src.indexOf('touchLoyaltyStreak()'));
  });
  it('il commento degli interruttori nomina tutte le eccezioni senza rotta', () => {
    const src = readFileSync('lib/funzioni-al-lancio.ts', 'utf8');
    expect(src).not.toMatch(/Due eccezioni/);
    for (const nome of ['INVITI_E_PUNTI_ACCESI', 'APP_INSTALLABILE_ACCESA', 'POSTHOG_ACCESO']) {
      expect(src.slice(0, src.indexOf('export const')), nome).toContain(nome);
    }
  });
});
