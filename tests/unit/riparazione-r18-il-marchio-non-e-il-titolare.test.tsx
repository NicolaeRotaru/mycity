import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 26/11/2026 — IL SITO NON DICE CHI C'E' DIETRO: IL NOME MESSO UGUALE AL MARCHIO.
 *
 * Senza variabili il sito nomina la persona che gestisce (Nicolae Rotaru). Ma con
 * NEXT_PUBLIC_TITOLARE_NOME=«MyCity», cioe' il marchio, o con un segnaposto («da definire»),
 * il codice lo prendeva per un nome legale: l'informativa tornava a «Il titolare del
 * trattamento è MyCity» e la persona spariva da Termini, piede e modulo di recesso.
 * Un marchio non e' un soggetto che risponde (art. 13.1.a GDPR).
 *
 * Sede, partita IVA e PEC non si inventano qui: arrivano dalle variabili quando Nicola le mette.
 * La prova disegna la pagina /privacy e il piede veri e legge il testo.
 */

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => {} }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isSeller: false, isRider: false, isAuthenticated: false }),
}));
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));

const VARIABILI = [
  'NOME', 'INDIRIZZO', 'PIVA', 'REA', 'PEC', 'CAPITALE', 'EMAIL_PRIVACY', 'REFERENTE_PRIVACY',
  'EMAIL_DPO', 'EMAIL_RESI', 'EMAIL_RECLAMI', 'EMAIL_LEGALE', 'EMAIL_SICUREZZA', 'EMAIL_SEGNALAZIONI',
].map((v) => `NEXT_PUBLIC_TITOLARE_${v}`);

const testo = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

function conIlNome(nome: string) {
  for (const v of VARIABILI) vi.stubEnv(v, '');
  vi.stubEnv('NEXT_PUBLIC_TITOLARE_NOME', nome);
  vi.resetModules();
}

async function fraseDelTitolare(): Promise<string> {
  const { default: PrivacyPage } = await import('@/app/privacy/page');
  const t = testo(renderToStaticMarkup(createElement(PrivacyPage)));
  const m = t.match(/Il titolare del trattamento è ([^.]*)\./);
  expect(m, 'la pagina deve avere la frase sul titolare').not.toBeNull();
  return (m as RegExpMatchArray)[1].trim();
}

async function piede(): Promise<string> {
  const { default: Footer } = await import('@/components/Footer');
  return testo(renderToStaticMarkup(createElement(Footer)));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('il nome del titolare uguale al marchio non vale come nome legale', () => {
  for (const nome of ['MyCity', ' mycity ', 'MYCITY', 'My City', 'da definire', 'TBD']) {
    it(`con NEXT_PUBLIC_TITOLARE_NOME=«${nome}» l’informativa nomina la persona che gestisce`, async () => {
      conIlNome(nome);
      const chi = await fraseDelTitolare();
      expect(chi, `«Il titolare del trattamento è ${chi}» non dice chi risponde`).toContain('Nicolae Rotaru');
      expect(chi).not.toBe(nome.trim());
    });
  }

  it('con il nome uguale al marchio il piede dice ancora chi è il titolare', async () => {
    conIlNome('MyCity');
    expect(await piede()).toMatch(/Titolare: Nicolae Rotaru/);
  });

  it('con il nome uguale al marchio titolare() non lo prende per un soggetto', async () => {
    conIlNome('MyCity');
    const { titolare, nomePubblico } = await import('@/lib/legal/titolare');
    const t = titolare();
    expect(t.gestore).toBe('Nicolae Rotaru');
    expect(nomePubblico(t)).toBe('Nicolae Rotaru (MyCity)');
  });

  it('un nome legale vero resta com’è, da solo', async () => {
    conIlNome('Ditta Prova di Mario Bianchi');
    const chi = await fraseDelTitolare();
    expect(chi).toBe('Ditta Prova di Mario Bianchi');
    expect(chi).not.toContain('Nicolae Rotaru');
  });
});
