import { describe, it, expect, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

/**
 * R10-001 — Il manifest (e l'icona Apple) devono stare nel <head>.
 *
 * Il layout è force-dynamic e Next 15.5 manda in streaming i metadata: tutto
 * quello che sta in `metadata` esce nel <body>, dove Chrome il manifest non lo
 * cerca («no-manifest»), quindi niente pulsante «Installa». Qui l'interruttore
 * dell'app installabile è finto acceso: il link deve essere un figlio del
 * <head> scritto a mano, e non deve tornare nei metadata (sarebbe un doppione
 * nel body).
 */

vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<typeof import('@/lib/funzioni-al-lancio')>()),
  APP_INSTALLABILE_ACCESA: true,
}));
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: 'font-inter', className: '' }),
  Fraunces: () => ({ variable: 'font-serif', className: '' }),
}));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'it', getMessages: async () => ({}) }));

const modulo = await import('@/app/layout');

type El = ReactElement<{ children?: ReactNode; rel?: string; href?: string }>;

function figliDi(el: El): El[] {
  const out: El[] = [];
  const visita = (n: ReactNode) => {
    if (Array.isArray(n)) n.forEach(visita);
    else if (n && typeof n === 'object' && 'type' in n) out.push(n as El);
  };
  visita(el.props.children);
  return out;
}

async function testa(): Promise<El[]> {
  const html = (await modulo.default({ children: null })) as El;
  const head = figliDi(html).find((f) => f.type === 'head');
  expect(head, 'il layout non scrive un <head>').toBeTruthy();
  return figliDi(head as El);
}

describe('R10-001 — Chrome trova il manifest', () => {
  it('con l’app installabile accesa il manifest è un figlio del <head>', async () => {
    const links = (await testa()).filter((f) => f.type === 'link');
    expect(links.some((l) => l.props.rel === 'manifest' && l.props.href === '/manifest.json')).toBe(true);
  });

  it('l’icona Apple sta nel <head>', async () => {
    const links = (await testa()).filter((f) => f.type === 'link');
    expect(links.some((l) => l.props.rel === 'apple-touch-icon')).toBe(true);
  });

  it('manifest e icona Apple non escono anche dai metadata (finirebbero nel body)', () => {
    expect(modulo.metadata.manifest).toBeUndefined();
    const icone = modulo.metadata.icons as { apple?: unknown } | undefined;
    expect(icone?.apple).toBeUndefined();
  });
});
