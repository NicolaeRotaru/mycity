import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

/**
 * R04-007 (onda 2, 28/11/2026) — CHI CONFERMA LA NEWSLETTER VEDE L'ESITO.
 *
 * La rotta di conferma rimandava a `/?newsletter=confermata` (o `link-non-valido`), e nessuna
 * pagina leggeva quel parametro: la home si apriva come sempre, senza una parola. Ora la rotta
 * porta a /newsletter, che dice com'è andata. Rotta vera, database finto; pagina vera, disegnata.
 */
const db = vi.hoisted(() => ({ trovata: true }));

vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://mycity.test' } }));
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: async () => ({ allowed: true }), getClientIp: () => '1.2.3.4' }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      update: () => q, eq: () => q, select: () => q,
      maybeSingle: async () => ({ data: db.trovata ? { id: 'iscritto-1' } : null, error: null }),
    });
    return { from: () => q };
  },
}));

import { GET as conferma } from '@/app/api/newsletter/confirm/route';
import NewsletterPage from '@/app/newsletter/page';

async function dove(url: string): Promise<URL> {
  const res = await conferma(new Request(url));
  expect([302, 307, 308]).toContain(res.status);
  return new URL(res.headers.get('location') ?? '');
}

async function testoDellaPagina(cerca: Record<string, string>): Promise<string> {
  const el = (await NewsletterPage({ searchParams: Promise.resolve(cerca) })) as ReactElement;
  return renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ');
}

beforeEach(() => { db.trovata = true; });

describe('R04-007 · la conferma della newsletter dice com’è andata', () => {
  it('IL CASO CHE ROMPEVA — link buono: si arriva a una pagina che dice «confermata»', async () => {
    const u = await dove('https://mycity.test/api/newsletter/confirm?token=abc');
    expect(u.pathname, 'la conferma rimanda alla home, dove nessuno legge l’esito').toBe('/newsletter');
    const testo = await testoDellaPagina(Object.fromEntries(u.searchParams));
    expect(testo).toContain('l’iscrizione è confermata');
  });

  it('IL CASO CHE ROMPEVA — link scaduto o già usato: la pagina dice che non è valido', async () => {
    db.trovata = false;
    const u = await dove('https://mycity.test/api/newsletter/confirm?token=vecchio');
    expect(u.pathname).toBe('/newsletter');
    const testo = await testoDellaPagina(Object.fromEntries(u.searchParams));
    expect(testo).toContain('Questo link non è valido');
    expect(testo).not.toContain('confermata');
  });

  it('senza gettone: link non valido, e la pagina offre i Contatti', async () => {
    const u = await dove('https://mycity.test/api/newsletter/confirm');
    const html = renderToStaticMarkup((await NewsletterPage({ searchParams: Promise.resolve(Object.fromEntries(u.searchParams)) })) as ReactElement);
    expect(html).toContain('href="/contact"');
  });

  it('controprova: un esito inventato nell’indirizzo non fa dire «confermata»', async () => {
    expect(await testoDellaPagina({ esito: 'qualsiasi' })).not.toContain('confermata');
  });
});
