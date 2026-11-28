// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R24 — Le pagine d'errore del sito e dell'amministrazione mandano l'errore al registratore
 * (captureError) e dicono «Abbiamo registrato il problema» solo se il registratore è acceso.
 */

const captureError = vi.hoisted(() => vi.fn());
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/analytics/sentry', () => ({ captureError }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let c: HTMLDivElement;

beforeEach(() => {
  vi.resetModules();
  captureError.mockClear();
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
});
afterEach(() => {
  act(() => root.unmount());
  c.remove();
});

async function disegna(file: 'sito' | 'admin', dsn: string | undefined): Promise<string> {
  vi.doMock('@/lib/analytics/sentry-config', () => ({ SENTRY_DSN: dsn }));
  // R08-002 (onda 2) — La pagina lo dice solo se il registratore conferma di aver preso l'errore:
  // acceso conferma, spento no (captureError vero, lib/analytics/sentry.tsx).
  captureError.mockResolvedValue(Boolean(dsn));
  const mod = file === 'sito' ? await import('@/app/error') : await import('@/app/admin/error');
  await act(async () => {
    root.render(createElement(mod.default, { error: Object.assign(new Error('x'), { digest: 'd1' }), reset: () => {} }));
  });
  return c.textContent ?? '';
}

describe.each(['sito', 'admin'] as const)('R24 — pagina d errore: %s', (area) => {
  it('manda l errore al registratore', async () => {
    await disegna(area, 'https://abc@o1.ingest.sentry.io/2');
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('registratore acceso: dice che il problema è registrato', async () => {
    const testo = await disegna(area, 'https://abc@o1.ingest.sentry.io/2');
    expect(testo).toContain('Abbiamo registrato il problema');
  });

  it('registratore spento: non dice una cosa non vera, ma invita a riprovare', async () => {
    const testo = await disegna(area, undefined);
    expect(testo).not.toContain('registrato');
    expect(testo).toContain('Riprova fra un momento');
  });
});
