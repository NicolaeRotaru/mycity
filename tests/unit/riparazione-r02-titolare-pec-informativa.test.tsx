import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 26/11/2026 — IL SITO NON DICE CHI C'E' DIETRO (la parte di codice).
 *
 * Sede, partita IVA e PEC non si inventano: arrivano dalle variabili NEXT_PUBLIC_TITOLARE_*
 * quando Nicola le mette. Ma quando ci sono, ogni pagina legale le deve stampare. I Termini e
 * il piede stampavano la PEC (rigaIdentita), l'informativa no: con tutte le variabili messe, il
 * paragrafo «Contatti del Titolare» non la nominava.
 *
 * La prova disegna la pagina /privacy vera con i dati del titolare messi, e legge il testo.
 */

const testo = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('quando i dati del titolare ci sono, l’informativa li stampa tutti', () => {
  it('sede, partita IVA e PEC compaiono nella sezione del titolare', async () => {
    vi.stubEnv('NEXT_PUBLIC_TITOLARE_NOME', 'Ditta Prova di Mario Bianchi');
    vi.stubEnv('NEXT_PUBLIC_TITOLARE_INDIRIZZO', 'Via Prova 3, 29121 Piacenza');
    vi.stubEnv('NEXT_PUBLIC_TITOLARE_PIVA', 'IT01234567890');
    vi.stubEnv('NEXT_PUBLIC_TITOLARE_PEC', 'dittaprova@pec.example');
    vi.resetModules();
    const { default: PrivacyPage } = await import('@/app/privacy/page');
    const t = testo(renderToStaticMarkup(createElement(PrivacyPage)));
    const inizio = t.indexOf('1. Titolare del trattamento');
    const fine = t.indexOf('2. Categorie di dati trattati');
    expect(inizio, 'la sezione del titolare deve esserci').toBeGreaterThanOrEqual(0);
    const sezione = t.slice(inizio, fine);
    expect(sezione).toContain('Ditta Prova di Mario Bianchi');
    expect(sezione).toContain('Via Prova 3, 29121 Piacenza');
    expect(sezione).toContain('IT01234567890');
    expect(sezione).toMatch(/PEC: dittaprova@pec\.example/);
  });

  it('senza PEC non stampa una riga vuota né una PEC inventata', async () => {
    vi.stubEnv('NEXT_PUBLIC_TITOLARE_PEC', '');
    vi.resetModules();
    const { default: PrivacyPage } = await import('@/app/privacy/page');
    const t = testo(renderToStaticMarkup(createElement(PrivacyPage)));
    const sezione = t.slice(t.indexOf('1. Titolare del trattamento'), t.indexOf('2. Categorie di dati trattati'));
    expect(sezione).not.toMatch(/PEC/);
  });
});
