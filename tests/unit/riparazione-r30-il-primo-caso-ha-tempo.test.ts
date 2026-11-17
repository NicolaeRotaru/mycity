import { describe, expect, it } from 'vitest';
import config from '../../vitest.config';

/**
 * R30-021 — Il primo caso di ~85 file di prove monta un componente e paga la prima
 * compilazione di react, react-dom e delle icone. Con 5 s di tempo, sotto il carico della
 * suite intera, cadeva a caso. Il tempo di ogni caso deve essere almeno 15 s.
 */
describe('il primo caso che monta un componente ha il tempo di compilarlo', () => {
  it('il tempo di ogni prova unitaria è di almeno 15 secondi', () => {
    const test = (config as { test?: { testTimeout?: number } }).test;
    expect(test?.testTimeout ?? 5000).toBeGreaterThanOrEqual(15000);
  });

  it('resta un tempo: un caso davvero bloccato si ferma comunque', () => {
    const test = (config as { test?: { testTimeout?: number } }).test;
    expect(test?.testTimeout).toBeLessThanOrEqual(30000);
  });
});
