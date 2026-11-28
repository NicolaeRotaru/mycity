// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R03-004 — Le pagine d'errore del venditore e del fattorino dicono «Abbiamo registrato il
 * problema» solo se il registratore è acceso. Spento, la frase sarebbe falsa.
 */

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
const captureError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics/sentry', () => ({ captureError }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let c: HTMLDivElement;

beforeEach(() => {
  vi.resetModules();
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
});
afterEach(() => {
  act(() => root.unmount());
  c.remove();
});

async function disegna(file: 'seller' | 'rider', dsn: string | undefined): Promise<string> {
  vi.doMock('@/lib/analytics/sentry-config', () => ({ SENTRY_DSN: dsn }));
  // R08-002 (onda 2) — La pagina lo dice solo se il registratore conferma di aver preso l'errore:
  // acceso conferma, spento no (captureError vero, lib/analytics/sentry.tsx).
  captureError.mockResolvedValue(Boolean(dsn));
  const mod = file === 'seller' ? await import('@/app/seller/error') : await import('@/app/rider/error');
  await act(async () => {
    root.render(createElement(mod.default, { error: Object.assign(new Error('x'), { digest: 'd1' }), reset: () => {} }));
  });
  return c.textContent ?? '';
}

describe.each(['seller', 'rider'] as const)('R03-004 — pagina d errore: %s', (area) => {
  it('registratore acceso: dice che il problema è registrato', async () => {
    const testo = await disegna(area, 'https://abc@o1.ingest.sentry.io/2');
    expect(testo).toContain('Abbiamo registrato il problema');
    expect(testo).toContain('Riprova fra un momento');
  });

  it('registratore spento: non dice una cosa non vera, ma invita a riprovare', async () => {
    const testo = await disegna(area, undefined);
    expect(testo).not.toContain('registrato');
    expect(testo).toContain('Riprova fra un momento');
  });
});
