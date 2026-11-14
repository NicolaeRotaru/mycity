import { describe, it, expect, vi } from 'vitest';

/**
 * R15-005 (il pezzo che si chiude qui) — la pagina «non trovata» non si presenta come la home.
 *
 * Senza intestazioni sue, app/not-found.tsx prendeva titolo, descrizione e anteprima del layout
 * radice: un indirizzo sbagliato si presentava a Google e su WhatsApp come «MyCity Piacenza —
 * Marketplace dei negozi della tua città». Poi (primo giro) ha avuto le sue, ma scritte solo con
 * titolo e descrizione: per Next openGraph e twitter di una pagina SOSTITUISCONO quelli della
 * radice, quindi sulla 404 sparivano og:site_name, og:locale e og:type, twitter:card scendeva a
 * «summary», e il noindex usciva due volte (Next lo scrive già da sé sulle 404).
 *
 * Qui si guardano i metadati veri del modulo, accanto a quelli della radice.
 */

// Il layout radice chiede i caratteri e la lingua a Next: nelle prove non ci sono.
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: 'font-inter', className: '' }),
  Fraunces: () => ({ variable: 'font-serif', className: '' }),
}));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'it', getMessages: async () => ({}) }));

const { metadata: pagina404 } = await import('@/app/not-found');
const { metadata: radice } = await import('@/app/layout');

const TITOLO = 'Pagina non trovata · MyCity';
type Campi = Record<string, unknown>;

describe('R15-005 — la 404 ha titolo e anteprima suoi, e il resto della radice', () => {
  it('il titolo e la descrizione dicono che la pagina non c’è', () => {
    expect(pagina404.title).toBe(TITOLO);
    expect(String(pagina404.description)).toContain('non esiste');
  });

  it('l’anteprima (WhatsApp, social) ha titolo e descrizione suoi, non quelli della home', () => {
    const og = pagina404.openGraph as Campi;
    expect(og.title).toBe(TITOLO);
    expect(og.description).toBe(pagina404.description);
    expect(og.title).not.toBe((radice.openGraph as Campi).title);
  });

  it('og:site_name, og:locale e og:type restano quelli della radice', () => {
    const og = pagina404.openGraph as Campi;
    const ogRadice = radice.openGraph as Campi;
    expect(og).toMatchObject({ siteName: 'MyCity', locale: 'it_IT', type: 'website' });
    for (const campo of ['siteName', 'locale', 'type']) expect(og[campo]).toEqual(ogRadice[campo]);
  });

  it('twitter:card resta quella grande della radice, con titolo e descrizione della 404', () => {
    const tw = pagina404.twitter as Campi;
    expect(tw.card).toBe('summary_large_image');
    expect(tw.card).toBe((radice.twitter as Campi).card);
    expect(tw).toMatchObject({ title: TITOLO, description: pagina404.description });
  });

  it('il noindex non lo scrive la pagina: Next lo mette già sulle 404, e usciva doppio', () => {
    expect(pagina404.robots).toBeUndefined();
  });
});
