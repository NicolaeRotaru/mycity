import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * OGNI ACQUISTO SI CONTA UNA VOLTA SOLA (radiografia del 21/8/2026).
 *
 * Da quando `order_placed` parte anche dal server (#208), lo stesso acquisto
 * veniva mandato due volte: una dal browser e una dal server. Il commento nel
 * codice diceva che `$insert_id` toglieva i doppioni. Non è vero fra i due:
 * PostHog li toglie a parità di istante, e browser e server mandano in due
 * momenti diversi.
 *
 * Fatturato e numero di acquisti risultavano DOPPI rispetto al vero, e nessuno
 * dei due riconciliava con la tabella degli ordini. Ogni tasso di conversione,
 * scontrino medio e ritorno di campagna poggia su quel numero: diventa denaro
 * vero il giorno in cui parte spesa pubblicitaria.
 *
 * Fra i due si tiene il server, dove il fatto è certo e dove il consenso viene
 * rispettato.
 */

const RADICE = resolve(__dirname, '..', '..');
const leggi = (f: string) => readFileSync(resolve(RADICE, f), 'utf8');

/** Le righe che MANDANO l'evento, non quelle che lo nominano in un commento. */
function emettitori(sorgente: string): string[] {
  return sorgente
    .split('\n')
    .filter((r) => !/^\s*(\/\/|\*|\/\*)/.test(r))
    .filter((r) => /track\(\s*'order_placed'|event:\s*'order_placed'/.test(r));
}

describe('l evento dell acquisto', () => {
  it('parte dal server', () => {
    expect(emettitori(leggi('lib/analytics/server.ts')).length).toBe(1);
  });

  it('NON parte anche dal browser: sarebbe contato due volte', () => {
    const daBrowser = [
      ...emettitori(leggi('lib/analytics/events.ts')),
      ...emettitori(leggi('app/checkout/page.tsx')),
      ...emettitori(leggi('app/orders/page.tsx')),
    ];
    expect(daBrowser, 'il browser è tornato a mandare l acquisto: il fatturato raddoppia').toEqual([]);
  });

  it('il server non manda niente senza consenso dichiarato', () => {
    const server = leggi('lib/analytics/server.ts');
    expect(server, 'il consenso non è più obbligatorio nel tipo').toMatch(/consensoAnalytics: boolean;/);
    expect(server, 'il cancello del consenso non è più dentro contaAcquisto')
      .toMatch(/if \(a\.consensoAnalytics !== true\) return;/);
  });
});
