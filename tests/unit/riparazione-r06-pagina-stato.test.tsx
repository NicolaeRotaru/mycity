// @vitest-environment jsdom
/**
 * R06-004 (12/11/2026) — Nella pagina «Stato dei servizi» il link «Contattaci»
 * si distingueva dal testo solo per il colore (sottolineato solo al passaggio
 * del mouse). Chi non distingue i colori non lo trovava.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock('@/lib/health/checks', () => ({
  getSystemHealth: async () => ({
    checkedAt: '2026-11-12T10:00:00Z',
    overall: 'operational',
    services: [{ id: 'web', name: 'Marketplace web', description: 'Applicazione', status: 'operational', latencyMs: null, detail: null }],
  }),
}));

describe('R06-004 · il link «Contattaci» della pagina Stato', () => {
  it('e\' sottolineato sempre, non solo col colore', async () => {
    const { default: StatusPage } = await import('@/app/status/page');
    const html = renderToStaticMarkup(await (StatusPage as () => Promise<React.ReactElement>)());
    const host = document.createElement('div');
    host.innerHTML = html;
    const link = [...host.querySelectorAll('a')].find((a) => a.textContent === 'Contattaci');
    expect(link).toBeTruthy();
    const classi = (link!.getAttribute('class') ?? '').split(/\s+/);
    expect(classi, 'Il link si riconosceva solo dal colore: va sottolineato sempre').toContain('underline');
  });
});
