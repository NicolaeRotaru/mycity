import { describe, it, expect } from 'vitest';
import { staleCrons } from '@/lib/cron-health';

/**
 * Dead-man's switch dei cron (🟠-25): la logica che decide quali cron sono
 * "fermi" è pura e deterministica → testabile senza DB.
 */
describe('staleCrons', () => {
  const now = Date.parse('2026-06-15T12:00:00Z');
  const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

  it('segnala un cron fermo oltre la soglia', () => {
    expect(staleCrons([{ name: 'send-emails', last_run_at: minsAgo(200) }], now)).toEqual([
      { name: 'send-emails', staleMin: 200, thresholdMin: 120 },
    ]);
  });

  it('non segnala un cron entro soglia', () => {
    expect(staleCrons([{ name: 'send-emails', last_run_at: minsAgo(30) }], now)).toEqual([]);
  });

  it('ignora i cron senza battito FINCHE non si sa da quando esiste il sistema', () => {
    // Senza la data d'installazione non si puo' distinguere «mai partito» da
    // «appena installato»: si tace, ed e' giusto.
    expect(staleCrons([], now)).toEqual([]);
    expect(staleCrons([{ name: 'send-emails', last_run_at: null }], now)).toEqual([]);
  });

  /**
   * 22/8/2026 — IL CASO PEGGIORE ERA QUELLO CHE NON SEGNALAVA NIENTE.
   *
   * Un lavoro periodico configurato male, che non e' partito NEMMENO UNA VOLTA,
   * non ha nessun battito da confrontare: il sorvegliante lo guardava e taceva.
   * Il pagamento ai negozi, le email, la scadenza dei carrelli potevano essere
   * fermi dal primo giorno senza che nessuno lo sapesse.
   *
   * La prova che c'era certificava proprio quel comportamento («ignora i cron
   * senza alcun heartbeat»). Restava vera nel suo caso — senza sapere da quando
   * esiste il sistema si deve tacere — ma non copriva questo, che e' il caso
   * che conta.
   */
  it('un lavoro che non e MAI partito, con il sistema in piedi da due giorni, si segnala', () => {
    const dueGiorniFa = now - 48 * 60 * 60_000;
    const esito = staleCrons([], now, undefined, dueGiorniFa);
    expect(esito.length).toBeGreaterThan(0);
    expect(esito.every((c) => c.staleMin > 60)).toBe(true);
  });

  it('ma appena installato non si segnala: quella e la finestra di prima accensione', () => {
    const dieciMinutiFa = now - 10 * 60_000;
    expect(staleCrons([], now, undefined, dieciMinutiFa)).toEqual([]);
  });

  it('ignora i cron non monitorati (es. operational-alerts, self-watch)', () => {
    expect(staleCrons([{ name: 'operational-alerts', last_run_at: minsAgo(9999) }], now)).toEqual([]);
  });

  it('process-deletions tollera fino a 26h (gira 1×/giorno)', () => {
    expect(staleCrons([{ name: 'process-deletions', last_run_at: minsAgo(60 * 25) }], now)).toEqual([]);
    const stale = staleCrons([{ name: 'process-deletions', last_run_at: minsAgo(60 * 27) }], now);
    expect(stale[0]?.name).toBe('process-deletions');
  });
});
