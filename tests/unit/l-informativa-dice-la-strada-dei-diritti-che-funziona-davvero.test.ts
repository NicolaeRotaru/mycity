/**
 * 01/11/2026 (ondata 6) — L'INFORMATIVA MANDAVA I DIRITTI SU STRADE CHIUSE.
 *
 * «Puoi esercitare questi diritti da Impostazioni → Privacy (Scarica i miei
 * dati, Cancella account) oppure dal modulo dei contatti.» In produzione manca
 * la chiave di servizio: i due pulsanti rispondono 503 e il modulo, senza
 * database e senza posta, non arriva a nessuno. In più i pulsanti nelle
 * Impostazioni si chiamano «Scarica i tuoi dati» (scheda Privacy) ed «Elimina
 * il tuo account» (scheda Zona pericolosa). Queste prove leggono il paragrafo
 * che dice DOVE esercitare i diritti, così come esce dalla pagina.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}));

import PrivacyPage from '@/app/privacy/page';

function paragrafoDeiDiritti(): { html: string; testo: string } {
  const pagina = renderToStaticMarkup(createElement(PrivacyPage));
  const inizio = pagina.indexOf('(art. 22)');
  const fine = pagina.indexOf('Hai diritto di presentare reclamo');
  expect(inizio, 'manca l\'elenco dei diritti').toBeGreaterThan(-1);
  expect(fine, 'manca la riga sul reclamo').toBeGreaterThan(inizio);
  const html = pagina.slice(inizio, fine);
  return { html, testo: html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ') };
}

function ambiente(o: { chiave: boolean; casella: boolean; posta: boolean }) {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://esempio.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', o.chiave ? 'chiave-di-prova' : '');
  vi.stubEnv('NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY', o.casella ? 'privacy@esempio.it' : '');
  vi.stubEnv('SUPPORT_EMAIL', o.posta ? 'aiuto@esempio.it' : '');
  vi.stubEnv('RESEND_API_KEY', o.posta ? 're_prova' : '');
  vi.stubEnv('RESEND_FROM', o.posta ? 'MyCity <noreply@esempio.it>' : '');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('informativa privacy: la strada dei diritti', () => {
  it('senza chiave, senza casella e senza posta non manda al modulo né ai pulsanti', () => {
    ambiente({ chiave: false, casella: false, posta: false });
    const { html, testo } = paragrafoDeiDiritti();
    expect(html).not.toContain('href="/contact"');
    expect(testo).not.toMatch(/Puoi esercitare questi diritti dalla pagina/);
    expect(testo).toMatch(/guasto nostro/);
  });

  it('senza chiave ma con la casella privacy manda alla casella e dice che i pulsanti non vanno', () => {
    ambiente({ chiave: false, casella: true, posta: false });
    const { html, testo } = paragrafoDeiDiritti();
    expect(html).toContain('href="mailto:privacy@esempio.it"');
    expect(testo).not.toMatch(/Puoi esercitare questi diritti dalla pagina/);
    expect(testo).toMatch(/non funziona in automatico/);
  });

  it('senza chiave, il modulo vale solo se può inoltrare per email', () => {
    ambiente({ chiave: false, casella: false, posta: true });
    const { html } = paragrafoDeiDiritti();
    expect(html).toContain('href="/contact"');
  });

  it('con la chiave nomina i pulsanti come si chiamano davvero nelle Impostazioni', () => {
    ambiente({ chiave: true, casella: false, posta: false });
    const { html, testo } = paragrafoDeiDiritti();
    expect(html).toContain('href="/profile/settings"');
    expect(testo).toContain('"Scarica i tuoi dati"');
    expect(testo).toContain('"Elimina il tuo account"');
    expect(testo).not.toContain('Cancella account');
    expect(html).toContain('href="/contact"');
  });
});
