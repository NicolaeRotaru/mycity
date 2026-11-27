import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 26/11/2026 — L'INFORMATIVA PROPONEVA IL MODULO DEI CONTATTI COME CONTATTO DEL TITOLARE ANCHE
 * QUANDO IL MODULO NON ARRIVA A NESSUNO.
 *
 * La sezione 5 dice già la strada vera (`stradaDeiDiritti`): senza la casella privacy, il modulo
 * vale solo se arriva a una persona (database su con la chiave di servizio, oppure inoltro per
 * email). La sezione 1, «Contatti del Titolare», mandava al modulo sempre. La prova disegna la
 * pagina /privacy vera e legge la sezione 1 nei casi che contano.
 */

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

import PrivacyPage from '@/app/privacy/page';

function sezioneDelTitolare(): { html: string; testo: string } {
  const pagina = renderToStaticMarkup(createElement(PrivacyPage));
  const inizio = pagina.indexOf('1. Titolare del trattamento');
  const fine = pagina.indexOf('2. Categorie di dati trattati');
  expect(inizio, 'manca la sezione del titolare').toBeGreaterThan(-1);
  expect(fine).toBeGreaterThan(inizio);
  const html = pagina.slice(inizio, fine);
  return { html, testo: html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ') };
}

function ambiente(o: { chiave: boolean; casella: boolean; posta: boolean; pec?: string }) {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://esempio.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', o.chiave ? 'chiave-di-prova' : '');
  vi.stubEnv('NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY', o.casella ? 'privacy@esempio.it' : '');
  vi.stubEnv('NEXT_PUBLIC_TITOLARE_PEC', o.pec ?? '');
  vi.stubEnv('SUPPORT_EMAIL', o.posta ? 'aiuto@mycity-marketplace.com' : '');
  vi.stubEnv('RESEND_API_KEY', o.posta ? 're_prova' : '');
  vi.stubEnv('RESEND_FROM', o.posta ? 'MyCity <noreply@mycity-marketplace.com>' : '');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('informativa, sezione 1: il contatto del titolare è uno che arriva', () => {
  it('IL CASO CHE ROMPEVA — senza chiave, senza casella e senza posta non propone il modulo', () => {
    ambiente({ chiave: false, casella: false, posta: false });
    const { html, testo } = sezioneDelTitolare();
    expect(html, 'il modulo qui non arriva a nessuno').not.toContain('href="/contact"');
    expect(testo).not.toMatch(/il modulo dei contatti/);
    expect(testo).toMatch(/non abbiamo un canale attivo/);
  });

  it('senza chiave, il modulo vale come contatto solo se può inoltrare per email', () => {
    ambiente({ chiave: false, casella: false, posta: true });
    const { html, testo } = sezioneDelTitolare();
    expect(html).toContain('href="/contact"');
    expect(testo).not.toMatch(/non abbiamo un canale attivo/);
  });

  it('con la chiave di servizio il modulo arriva, e resta il contatto', () => {
    ambiente({ chiave: true, casella: false, posta: false });
    expect(sezioneDelTitolare().html).toContain('href="/contact"');
  });

  it('con la casella privacy il contatto è la casella', () => {
    ambiente({ chiave: false, casella: true, posta: false });
    const { html } = sezioneDelTitolare();
    expect(html).toContain('href="mailto:privacy@esempio.it"');
    expect(html).not.toContain('href="/contact"');
  });

  it('senza modulo che arriva ma con la PEC, il contatto è la PEC e non si parla di guasto', () => {
    ambiente({ chiave: false, casella: false, posta: false, pec: 'titolare@pec.example' });
    const { html, testo } = sezioneDelTitolare();
    expect(html).toContain('href="mailto:titolare@pec.example"');
    expect(html).not.toContain('href="/contact"');
    expect(testo).not.toMatch(/non abbiamo un canale attivo/);
  });
});
