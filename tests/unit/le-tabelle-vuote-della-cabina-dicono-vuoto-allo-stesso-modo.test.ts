import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vistaDelleCampagne, type ElencoCampagne } from '@/lib/admin/vista-delle-campagne';

/**
 * 31/10/2026 — TRE TABELLE SORELLE DELLA CABINA DICEVANO «È VUOTO» IN TRE MODI DIVERSI.
 *
 * Coupon: «Nessun codice sconto: ho guardato e non ce n'è ancora nessuno.» Sponsorizzati:
 * «Nessuna campagna.» Ordini: «Nessun ordine». La regola delle tre è la stessa — «vuoto» si dice
 * solo dopo una lettura riuscita, la lettura caduta ha il suo avviso — quindi la forma è la stessa:
 * «Nessun X.». Col filtro, gli sponsorizzati scrivevano anche «Nessuna campagna attive.».
 * La frase degli ordini la prova `la-cabina-admin-non-scambia-un-guasto-per-un-vuoto` (pagina aperta).
 * Difetto minore: per i coupon basta leggere la frase scritta nella pagina.
 */

const FRASE = /^Nessun[a]? [^.:]+\.$/;
const vuoto: ElencoCampagne = { campagne: [], totale: 0 };

describe('sponsorizzati: la tabella vuota parla come le sorelle', () => {
  it('senza filtro', () => {
    const v = vistaDelleCampagne({ isPending: false, isError: false, data: vuoto }, 'all');
    expect(v.mostraVuoto).toBe(true);
    expect(v.frasePerTabellaVuota).toMatch(FRASE);
  });

  it('col filtro, al singolare', () => {
    const attive = vistaDelleCampagne({ isPending: false, isError: false, data: vuoto }, 'active');
    expect(attive.frasePerTabellaVuota).toBe('Nessuna campagna attiva.');
    const finite = vistaDelleCampagne({ isPending: false, isError: false, data: vuoto }, 'ended');
    expect(finite.frasePerTabellaVuota).toBe('Nessuna campagna finita.');
  });
});

describe('coupon: stessa forma', () => {
  it('la frase della tabella vuota è «Nessun codice sconto.»', () => {
    const pagina = readFileSync(join(process.cwd(), 'app/admin/coupons/page.tsx'), 'utf8');
    const frase = /(Nessun codice sconto[^<{]*)/.exec(pagina)?.[1]?.trim();
    expect(frase).toMatch(FRASE);
  });
});
