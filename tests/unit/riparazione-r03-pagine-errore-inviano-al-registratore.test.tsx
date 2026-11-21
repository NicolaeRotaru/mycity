// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R03-014 — Le pagine d'errore dicono «Abbiamo registrato il problema»: l'errore mostrato deve
 * davvero arrivare a Sentry nel browser, anche quando il registratore non è ancora acceso (la
 * cattura di un registratore spento non va da nessuna parte). Col DSN presente, si prova sempre.
 */

const sentry = vi.hoisted(() => ({
  clienteAcceso: false,
  init: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  getClient: () => (sentry.clienteAcceso ? {} : undefined),
  init: (...a: unknown[]) => { sentry.init(...a); sentry.clienteAcceso = true; },
  captureException: (...a: unknown[]) => {
    // Come l'SDK vero: senza cliente acceso la cattura si perde.
    if (sentry.clienteAcceso) sentry.captureException(...a);
  },
}));
vi.mock('@/lib/analytics/sentry-config', () => ({
  SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/2',
  opzioniSentry: () => ({ dsn: 'https://abc@o1.ingest.sentry.io/2' }),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let c: HTMLDivElement;

beforeEach(() => {
  vi.resetModules();
  sentry.clienteAcceso = false;
  sentry.init.mockClear();
  sentry.captureException.mockClear();
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
});
afterEach(() => {
  act(() => root.unmount());
  c.remove();
});

const pagine = {
  'app/error': () => import('@/app/error'),
  'app/global-error': () => import('@/app/global-error'),
  'app/admin/error': () => import('@/app/admin/error'),
} as const;

describe.each(Object.keys(pagine) as Array<keyof typeof pagine>)('R03-014 — %s', (nome) => {
  it('l’errore mostrato dalla pagina arriva a Sentry anche se il registratore non era ancora acceso', async () => {
    const mod = await pagine[nome]();
    const errore = Object.assign(new Error('guasto-nel-telefono'), { digest: 'd1' });
    await act(async () => {
      root.render(createElement(mod.default, { error: errore, reset: () => {} }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(sentry.captureException, 'l’errore non è stato mandato al registratore').toHaveBeenCalledTimes(1);
    expect(sentry.captureException.mock.calls[0][0]).toBe(errore);
  });
});
