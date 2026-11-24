/**
 * @vitest-environment jsdom
 */
/**
 * R12-004 — L'aiutante `accendi` rendeva vuoto in silenzio un componente rimasto sospeso per sempre:
 * una prova che controlla un'assenza passava senza aver provato niente. Ora `attendi()` rigetta,
 * salvo `{ permettiSospeso: true }` per chi aspetta davvero un componente sospeso.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { accendi, attendi } from './aiuti/schermo';

const Sospeso = () => {
  throw new Promise(() => undefined);
};

let aperti: Array<{ smonta: () => void }> = [];
afterEach(() => {
  for (const s of aperti) s.smonta();
  aperti = [];
});

describe('R12-004 · lo schermo sospeso per sempre non passa in silenzio', () => {
  it('attendi() rigetta se il componente resta sospeso', async () => {
    const s = accendi(Sospeso);
    aperti.push(s);
    await expect(attendi()).rejects.toThrow(/ancora sospeso/);
  });

  it('con permettiSospeso: true non rigetta', async () => {
    const s = accendi(Sospeso, {}, { permettiSospeso: true });
    aperti.push(s);
    await expect(attendi()).resolves.toBeUndefined();
  });
});
