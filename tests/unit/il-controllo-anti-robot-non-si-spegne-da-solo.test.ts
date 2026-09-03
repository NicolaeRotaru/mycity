import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * IL CONTROLLO ANTI-ROBOT NON SI SPEGNE DA SOLO.
 *
 * 3/9/2026 — LA DIFESA CHE SPARIVA IN SILENZIO AL PRIMO ERRORE DI
 * CONFIGURAZIONE.
 *
 * La funzione che verifica il controllo anti-robot (Cloudflare Turnstile) era
 * fatta cosi': se in produzione la chiave segreta non c'era, scriveva una riga
 * di errore nei registri e poi rispondeva «va bene» a QUALSIASI token, anche
 * vuoto. Il controllo si spegneva invece di fermarsi.
 *
 * Le porte che ci si appoggiano sono quattro — accesso, registrazione, modulo
 * contatti, iscrizione alla newsletter — e da quel momento restavano difese dal
 * solo contatore per indirizzo di rete: dieci tentativi ogni cinque minuti
 * sull'accesso. Un ambiente di anteprima costruito con NODE_ENV=production ma
 * senza quella variabile diventava una porta d'accesso senza controllo
 * anti-robot puntata sugli account veri: migliaia di password provate, account
 * finti in massa, e nessun allarme — solo una riga in un registro.
 *
 * Questa prova mette la macchina in produzione senza la chiave e pretende un
 * rifiuto. Diventa rossa il giorno in cui la difesa torna a lasciar passare.
 */

vi.mock('@/lib/env', () => ({
  env: { turnstileSecretKey: vi.fn(() => '') },
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { verifyTurnstileToken } from '@/lib/captcha';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

const envMock = env as unknown as { turnstileSecretKey: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('in produzione, senza la chiave segreta', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    envMock.turnstileSecretKey.mockReturnValue('');
  });

  it('IL CASO CHE ROMPEVA — un token vuoto non passa', async () => {
    const esito = await verifyTurnstileToken('');

    expect(esito.ok, 'la porta e rimasta aperta ai robot').toBe(false);
  });

  it('IL CASO CHE ROMPEVA — nemmeno un token inventato passa', async () => {
    const esito = await verifyTurnstileToken('token-qualunque-inventato');

    expect(esito.ok).toBe(false);
    expect(fetchMock, 'senza chiave non c e niente da verificare con Cloudflare').not.toHaveBeenCalled();
  });

  it('chi arriva legge un motivo in parole sue, non un errore tecnico', async () => {
    const esito = await verifyTurnstileToken('x');

    expect(esito.ok).toBe(false);
    if (!esito.ok) {
      expect(esito.reason).toMatch(/anti-robot/i);
      expect(esito.reason, 'niente nomi di variabili nel messaggio che legge la gente').not.toMatch(/TURNSTILE|SECRET|KEY|env/);
    }
  });

  it('il guasto resta scritto nei registri: chi lo cerca lo trova', async () => {
    await verifyTurnstileToken('x');

    expect(logger.error).toHaveBeenCalled();
  });
});

describe('quello che non si deve rompere', () => {
  it('in sviluppo, senza chiave, si continua a lavorare senza integrazione', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    envMock.turnstileSecretKey.mockReturnValue('');

    const esito = await verifyTurnstileToken('qualunque');

    expect(esito.ok).toBe(true);
    if (esito.ok) expect(esito.skipped).toBe(true);
  });

  it('in produzione, con la chiave, un token valido passa come prima', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    envMock.turnstileSecretKey.mockReturnValue('la-chiave-vera');
    fetchMock.mockResolvedValue({ json: () => Promise.resolve({ success: true }) } as unknown as Response);

    const esito = await verifyTurnstileToken('token-buono');

    expect(esito.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('in produzione, con la chiave, un token falso viene respinto come prima', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    envMock.turnstileSecretKey.mockReturnValue('la-chiave-vera');
    fetchMock.mockResolvedValue({ json: () => Promise.resolve({ success: false }) } as unknown as Response);

    const esito = await verifyTurnstileToken('token-falso');

    expect(esito.ok).toBe(false);
  });
});
