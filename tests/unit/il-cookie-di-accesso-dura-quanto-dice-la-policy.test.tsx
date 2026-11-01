import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 31/10/2026 (ondata 6) — IL COOKIE DI ACCESSO DURA QUANTO DICE LA COOKIE POLICY.
 *
 * La tabella dei cookie tecnici dava alla sessione (sb-*-auth-token) «1 settimana». La libreria,
 * @supabase/ssr 0.5.2, lo scrive con maxAge di 400 giorni e lo impone anche sopra le opzioni
 * (dist/main/cookies.js). Scelta di Nicola del 31/10 (fatto privacy.consenso-cookie-durata): la
 * scelta sui cookie dura 6 mesi, e anche il cookie di accesso non resta di più.
 *
 * Qui si fa scrivere al client del browser il cookie che la libreria gli passa (400 giorni) e si
 * legge cosa arriva a document.cookie; poi si disegna la cookie policy e si legge la riga.
 */

const SEI_MESI_S = 180 * 24 * 60 * 60;
const QUATTROCENTO_GIORNI_S = 400 * 24 * 60 * 60;

const chiamate: unknown[][] = [];
vi.mock('@supabase/ssr', () => ({
  createBrowserClient: (...args: unknown[]) => {
    chiamate.push(args);
    return { auth: {} };
  },
}));
vi.mock('@/components/CookieBanner', () => ({ openConsentBanner: () => {} }));

type SetAll = (c: { name: string; value: string; options: Record<string, unknown> }[]) => void;

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe('il cookie di accesso non resta più di 6 mesi', () => {
  it('il client del browser taglia i 400 giorni della libreria a 6 mesi', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://progetto.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-pubblica-finta';
    const scritti: string[] = [];
    (globalThis as { document?: unknown }).document = {
      get cookie() {
        return 'sb-progetto-auth-token=base64-abc';
      },
      set cookie(v: string) {
        scritti.push(v);
      },
    };
    const { supabase } = await import('@/lib/supabase/client');
    void supabase.auth; // crea il client vero, una volta

    expect(chiamate.length).toBe(1);
    const opzioni = chiamate[0][2] as { cookies?: { setAll?: SetAll; getAll?: () => unknown } } | undefined;
    expect(opzioni?.cookies?.setAll, 'il client lascia scrivere i cookie alla libreria: 400 giorni').toBeTypeOf('function');

    opzioni!.cookies!.setAll!([
      { name: 'sb-progetto-auth-token', value: 'base64-xyz', options: { path: '/', sameSite: 'lax', maxAge: QUATTROCENTO_GIORNI_S } },
      { name: 'sb-progetto-auth-token.1', value: '', options: { path: '/', sameSite: 'lax', maxAge: 0 } },
    ]);
    expect(scritti).toHaveLength(2);
    const durata = Number(/Max-Age=(\d+)/i.exec(scritti[0])?.[1]);
    expect(durata, `scritto: ${scritti[0]}`).toBeGreaterThan(0);
    expect(durata).toBeLessThanOrEqual(SEI_MESI_S);
    expect(scritti[0]).toMatch(/^sb-progetto-auth-token=base64-xyz;/);
    expect(scritti[0]).toMatch(/Path=\//);
    // La cancellazione resta una cancellazione.
    expect(scritti[1]).toMatch(/Max-Age=0\b/);

    expect(opzioni!.cookies!.getAll!()).toEqual([{ name: 'sb-progetto-auth-token', value: 'base64-abc' }]);
  });

  it('la cookie policy dice 6 mesi per la sessione, non una settimana', async () => {
    const { default: CookiesPage } = await import('@/app/cookies/page');
    const html = renderToStaticMarkup(createElement(CookiesPage));
    const riga = /<tr[^>]*>(?:(?!<\/tr>)[\s\S])*sb-\*-auth-token(?:(?!<\/tr>)[\s\S])*<\/tr>/.exec(html)?.[0] ?? '';
    expect(riga, 'la tabella deve avere la riga della sessione').not.toBe('');
    const t = riga.replace(/<[^>]+>/g, ' ');
    expect(t).not.toMatch(/settimana/i);
    expect(t).toMatch(/6 mesi/);
  });
});
