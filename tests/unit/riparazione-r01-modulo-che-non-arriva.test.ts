import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 27/11/2026 — L'INFORMATIVA (VERSIONI PRECEDENTI) E LA COOKIE POLICY PROPONEVANO IL MODULO DEI
 * CONTATTI ANCHE QUANDO NON ARRIVA A NESSUNO.
 *
 * Senza la chiave di servizio il modulo non salva niente, e arriva a una persona solo se puo'
 * inoltrare per email (`stradaDeiDiritti` in lib/legal/titolare.ts). Le sezioni 1 e 5
 * dell'informativa lo sapevano gia'; la sezione 9 («le versioni precedenti si chiedono…») e la
 * cookie policy («Conserviamo le versioni precedenti su richiesta…») mandavano al modulo sempre.
 * La prova disegna le due pagine vere e legge quelle frasi.
 */

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

const testo = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

function ambiente(o: { chiave: boolean; casella: boolean; posta: boolean; pec?: string }) {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://esempio.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', o.chiave ? 'chiave-di-prova' : '');
  vi.stubEnv('NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY', o.casella ? 'privacy@esempio.it' : '');
  vi.stubEnv('NEXT_PUBLIC_TITOLARE_PEC', o.pec ?? '');
  vi.stubEnv('SUPPORT_EMAIL', o.posta ? 'aiuto@mycity-marketplace.com' : '');
  vi.stubEnv('RESEND_API_KEY', o.posta ? 're_prova' : '');
  vi.stubEnv('RESEND_FROM', o.posta ? 'MyCity <noreply@mycity-marketplace.com>' : '');
}

async function sezione9Informativa(): Promise<{ html: string; testo: string }> {
  const { default: PrivacyPage } = await import('@/app/privacy/page');
  const pagina = renderToStaticMarkup(createElement(PrivacyPage));
  const inizio = pagina.indexOf('9. Modifiche all');
  expect(inizio, 'manca la sezione 9').toBeGreaterThan(-1);
  const html = pagina.slice(inizio);
  return { html, testo: testo(html) };
}

async function aggiornamentiCookie(): Promise<{ html: string; testo: string }> {
  const { default: CookiesPage } = await import('@/app/cookies/page');
  const pagina = renderToStaticMarkup(createElement(CookiesPage));
  const inizio = pagina.indexOf('5. Aggiornamenti');
  expect(inizio, 'manca la sezione Aggiornamenti').toBeGreaterThan(-1);
  const html = pagina.slice(inizio);
  return { html, testo: testo(html) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('informativa, sezione 9: le versioni precedenti si chiedono da un canale che arriva', () => {
  it('IL CASO CHE ROMPEVA — senza chiave, casella e posta non propone il modulo', async () => {
    ambiente({ chiave: false, casella: false, posta: false });
    const { html, testo } = await sezione9Informativa();
    expect(html, 'il modulo qui non arriva a nessuno').not.toContain('href="/contact"');
    expect(testo).not.toMatch(/modulo dei contatti/);
    expect(testo).toMatch(/non abbiamo un canale attivo/);
  });

  it('senza modulo che arriva ma con la PEC, si chiedono alla PEC', async () => {
    ambiente({ chiave: false, casella: false, posta: false, pec: 'titolare@pec.example' });
    const { html, testo } = await sezione9Informativa();
    expect(html).toContain('href="mailto:titolare@pec.example"');
    expect(html).not.toContain('href="/contact"');
    expect(testo).not.toMatch(/non abbiamo un canale attivo/);
  });

  it('senza chiave ma con l’inoltro per email il modulo arriva, e resta', async () => {
    ambiente({ chiave: false, casella: false, posta: true });
    expect((await sezione9Informativa()).html).toContain('href="/contact"');
  });

  it('con la chiave di servizio il modulo arriva, e resta', async () => {
    ambiente({ chiave: true, casella: false, posta: false });
    expect((await sezione9Informativa()).html).toContain('href="/contact"');
  });

  it('con la casella privacy si scrive alla casella', async () => {
    ambiente({ chiave: false, casella: true, posta: false });
    const { html } = await sezione9Informativa();
    expect(html).toContain('href="mailto:privacy@esempio.it"');
    expect(html).not.toContain('href="/contact"');
  });
});

describe('cookie policy, aggiornamenti: non promette il modulo dei contatti', () => {
  it('IL CASO CHE ROMPEVA — senza casella non manda al modulo, ma alla sezione dell’informativa che decide', async () => {
    ambiente({ chiave: false, casella: false, posta: false });
    const { html, testo } = await aggiornamentiCookie();
    expect(html, 'il modulo puo’ non arrivare a nessuno').not.toContain('href="/contact"');
    expect(testo).not.toMatch(/modulo dei contatti/);
    expect(html).toContain('href="/privacy#modifiche"');
  });

  it('con la casella privacy si scrive alla casella', async () => {
    ambiente({ chiave: false, casella: true, posta: false });
    const { html } = await aggiornamentiCookie();
    expect(html).toContain('href="mailto:privacy@esempio.it"');
    expect(html).not.toContain('href="/contact"');
  });
});
