/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * R14-025 — la pagina d'errore dice «abbiamo registrato il problema» solo se il registratore c'e'.
 *
 * `captureError` (lib/analytics/sentry.tsx) senza la chiave del servizio scrive solo nella console del
 * telefono: non lo registra nessuno. Con la chiave consegna l'errore al registratore e lo dice. Le
 * pagine d'errore (app/error.tsx, app/admin/error.tsx) chiamano captureError e non promettono quello
 * che non succede.
 */
const sentry = {
  captureException: vi.fn(),
  init: vi.fn(),
  getClient: vi.fn(() => ({})),
};
vi.mock('@sentry/nextjs', () => sentry);

const DSN = 'https://chiave@o1.ingest.sentry.io/2';

function erroreCon(digest = 'abc123'): Error & { digest?: string } {
  const e = new Error('boom') as Error & { digest?: string };
  e.digest = digest;
  return e;
}

beforeEach(() => {
  sentry.captureException.mockReset();
  sentry.init.mockReset();
  sentry.getClient.mockReset();
  sentry.getClient.mockReturnValue({});
});

describe('R14-025 senza la chiave del servizio', () => {
  it('captureError dice che non ha registrato, e le pagine non lo promettono', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const lib = await monta('lib/analytics/sentry.tsx', { veri: ['senza-chiave'] });
    const errore = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await (lib.captureError as (e: unknown) => Promise<boolean>)(new Error('x'))).toBe(false);
    expect(sentry.captureException).not.toHaveBeenCalled();
    errore.mockRestore();

    for (const file of ['app/error.tsx', 'app/admin/error.tsx']) {
      const pagina = await monta(file, { veri: ['senza-chiave'] });
      const s = accendi(pagina.default, { error: erroreCon(), reset: () => {} });
      expect(testoVisibile(s.radice).toLowerCase(), `${file} promette una registrazione che non c'e'`).not.toContain('registrato');
      s.smonta();
    }
  }, 60000);
});

describe('R14-025 con la chiave del servizio', () => {
  it('captureError consegna l’errore al registratore, e non rompe la pagina se il registratore cade', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = DSN;
    const lib = await monta('lib/analytics/sentry.tsx', { veri: ['con-chiave'] });
    const cattura = lib.captureError as (e: unknown, c?: Record<string, unknown>) => Promise<boolean>;
    const errore = new Error('boom');
    expect(await cattura(errore, { digest: 'abc123' })).toBe(true);
    expect(sentry.captureException).toHaveBeenCalledWith(errore, { extra: { digest: 'abc123' } });

    sentry.captureException.mockImplementation(() => { throw new Error('rete'); });
    expect(await cattura(errore)).toBe(false);
  }, 60000);

  it('le pagine chiamano captureError con l’errore e dicono che e’ registrato', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = DSN;
    for (const file of ['app/error.tsx', 'app/admin/error.tsx']) {
      sentry.captureException.mockReset();
      const pagina = await monta(file, { veri: ['con-chiave'] });
      const errore = erroreCon();
      const s = accendi(pagina.default, { error: errore, reset: () => {} });
      await vi.waitFor(() => expect(sentry.captureException, `${file} non manda l'errore al registratore`).toHaveBeenCalled());
      expect(sentry.captureException.mock.calls[0][0]).toBe(errore);
      expect(testoVisibile(s.radice).toLowerCase()).toContain('registrato');
      s.smonta();
    }
  }, 60000);
});
