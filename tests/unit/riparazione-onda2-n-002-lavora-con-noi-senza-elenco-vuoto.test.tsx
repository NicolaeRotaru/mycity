import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * N-002 (onda 2) — «Lavora con noi», senza posizioni aperte, disegnava un <ul> vuoto (un lettore di
 * schermo dice «elenco, 0 elementi») e in fondo chiedeva ancora «Non trovi il ruolo giusto?», come se
 * ci fosse un elenco di ruoli fra cui scegliere. La candidatura spontanea resta, una volta, nel testo
 * delle posizioni.
 */

vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});

import LavoraConNoiPage from '@/app/lavora-con-noi/page';

describe('N-002 · senza posizioni aperte niente elenco vuoto né «Non trovi il ruolo giusto?»', () => {
  const pagina = renderToStaticMarkup(createElement(LavoraConNoiPage));
  const inizio = pagina.indexOf('id="posizioni"');
  const sezione = pagina.slice(inizio, pagina.indexOf('</section>', inizio));

  it('la sezione delle posizioni non ha un elenco vuoto', () => {
    expect(inizio).toBeGreaterThan(-1);
    expect(sezione).toMatch(/Oggi non abbiamo posizioni aperte/);
    expect(sezione).not.toMatch(/<ul[\s>]/);
  });

  it('non chiede «Non trovi il ruolo giusto?» quando non c\'è nessun ruolo', () => {
    expect(pagina).not.toMatch(/Non trovi il ruolo giusto/);
    expect(sezione).toMatch(/candidatura spontanea/);
  });
});
