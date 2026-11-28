/**
 * @vitest-environment jsdom
 */
/**
 * R07-011 (onda 2) — L'AIUTANTE `attendi()` E IL PERMESSO `permettiSospeso`.
 *
 * 1. `attendi()` dava venti giri di `setTimeout(0)` e poi diceva «sospeso per sempre»: un import
 *    pigro solo lento (la macchina carica che trasforma il modulo) faceva cadere una prova giusta.
 * 2. Il permesso `permettiSospeso` era una variabile sola, riscritta da ogni `accendi`: valeva quello
 *    dell'ultima per tutti gli schermi accesi. Uno schermo sospeso per sempre senza permesso passava
 *    in silenzio se dopo se ne accendeva uno col permesso; e al contrario `attendi()` rigettava a torto.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, lazy } from 'react';
import { accendi, attendi } from './aiuti/schermo';

const SospesoPerSempre = () => {
  throw new Promise(() => undefined);
};
const Pronto = () => createElement('p', { 'data-pronto': '' }, 'pronto');

/** Un import pigro che arriva dopo `ms` millisecondi (orologio vero). */
const lentoDi = (ms: number) =>
  lazy(() => new Promise<{ default: typeof Pronto }>((ok) => setTimeout(() => ok({ default: Pronto }), ms)));

let aperti: Array<{ smonta: () => void }> = [];
afterEach(() => {
  for (const s of aperti) s.smonta();
  aperti = [];
  vi.useRealTimers();
});

describe('R07-011 · attendi() aspetta un import lento invece di dirlo sospeso per sempre', () => {
  it('un import pigro di 300 ms: attendi() aspetta e il componente si disegna', async () => {
    const s = accendi(lentoDi(300));
    aperti.push(s);
    await expect(attendi(), 'un import solo lento e stato preso per «sospeso per sempre»').resolves.toBeUndefined();
    expect(s.radice.querySelector('[data-pronto]')).not.toBeNull();
    expect(s.sospeso()).toBe(0);
  });

  it('anche con l orologio finto acceso dalla prova, l attesa passa sul tempo vero', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const s = accendi(lentoDi(150));
    aperti.push(s);
    await expect(attendi()).resolves.toBeUndefined();
    expect(s.radice.querySelector('[data-pronto]')).not.toBeNull();
  });

  it('uno sospeso davvero per sempre rigetta ancora', async () => {
    const s = accendi(SospesoPerSempre);
    aperti.push(s);
    await expect(attendi()).rejects.toThrow(/ancora sospeso/);
  });
});

describe('R07-011 · il permesso di restare sospeso vale per il suo schermo', () => {
  it('sospeso SENZA permesso, poi uno schermo col permesso: attendi() rigetta lo stesso', async () => {
    aperti.push(accendi(SospesoPerSempre));
    aperti.push(accendi(Pronto, {}, { permettiSospeso: true }));
    await expect(
      attendi(),
      'il permesso dell ultimo schermo ha coperto uno schermo sospeso che non lo aveva',
    ).rejects.toThrow(/ancora sospeso/);
  });

  it('sospeso COL permesso, poi uno schermo normale: attendi() non rigetta', async () => {
    aperti.push(accendi(SospesoPerSempre, {}, { permettiSospeso: true }));
    const normale = accendi(Pronto);
    aperti.push(normale);
    await expect(attendi(), 'lo schermo normale ha tolto il permesso a quello che lo aveva').resolves.toBeUndefined();
    expect(normale.sospeso()).toBe(0);
  });
});
