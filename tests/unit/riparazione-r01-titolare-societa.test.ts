import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 27/11/2026 — IL SITO NON DICE CHI C'E' DIETRO: IL MARCHIO CON LA FORMA DI SOCIETA'.
 *
 * Il marchio da solo («MyCity») messo come NEXT_PUBLIC_TITOLARE_NOME vale gia' come non messo.
 * Ma «MyCity S.r.l.» passava: l'informativa diceva «Il titolare del trattamento è MyCity S.r.l.»,
 * una societa' che non esiste, e la persona che gestisce spariva da informativa e piede.
 * Una societa' vera ha la sua partita IVA: senza, quel nome non vale.
 *
 * La prova disegna la pagina /privacy, i Termini e il piede veri e legge il testo.
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

function conLeVariabili(valori: Record<string, string>) {
  for (const v of VARIABILI) vi.stubEnv(v, '');
  for (const [k, v] of Object.entries(valori)) vi.stubEnv(`NEXT_PUBLIC_TITOLARE_${k}`, v);
  vi.resetModules();
}

async function fraseDelTitolare(): Promise<string> {
  const { default: PrivacyPage } = await import('@/app/privacy/page');
  const t = testo(renderToStaticMarkup(createElement(PrivacyPage)));
  const pezzi = t.split('Il titolare del trattamento è ');
  expect(pezzi.length, 'la pagina deve avere la frase sul titolare').toBeGreaterThan(1);
  // Il nome puo' contenere punti («S.r.l.»): si legge la frase fino a «Contatti del Titolare».
  return pezzi[1].split('Contatti del Titolare')[0].trim();
}

async function piede(): Promise<string> {
  const { default: Footer } = await import('@/components/Footer');
  return testo(renderToStaticMarkup(createElement(Footer)));
}

async function termini(): Promise<string> {
  const { default: TermsPage } = await import('@/app/terms/page');
  return testo(renderToStaticMarkup(createElement(TermsPage)));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('il marchio con una forma di società, senza partita IVA, non è un titolare', () => {
  for (const nome of ['MyCity S.r.l.', 'MyCity srl', 'MYCITY SRLS', 'My City S.p.A.', 'MyCity S.r.l. unipersonale']) {
    it(`con NEXT_PUBLIC_TITOLARE_NOME=«${nome}» e niente P.IVA l’informativa nomina chi gestisce`, async () => {
      conLeVariabili({ NOME: nome });
      const chi = await fraseDelTitolare();
      expect(chi, `«Il titolare del trattamento è ${chi}» nomina una società che non esiste`).toContain(
        'Nicolae Rotaru',
      );
      expect(chi).not.toContain(nome);
    });
  }

  it('il piede dice ancora chi è il titolare', async () => {
    conLeVariabili({ NOME: 'MyCity S.r.l.' });
    const p = await piede();
    expect(p).toMatch(/Titolare: Nicolae Rotaru/);
    expect(p).not.toContain('MyCity S.r.l.');
  });

  it('i Termini non dicono «gestita da MyCity S.r.l.»', async () => {
    conLeVariabili({ NOME: 'MyCity S.r.l.' });
    const t = await termini();
    expect(t).not.toContain('MyCity S.r.l.');
    expect(t).toContain('Nicolae Rotaru (MyCity)');
  });

  it('con una partita IVA vera il nome della società vale, da solo', async () => {
    conLeVariabili({ NOME: 'MyCity S.r.l.', PIVA: 'IT01234567890' });
    const { titolare } = await import('@/lib/legal/titolare');
    const t = titolare();
    expect(t.denominazione).toBe('MyCity S.r.l.');
    expect(t.gestore).toBeNull();
    const chi = await fraseDelTitolare();
    expect(chi).toContain('MyCity S.r.l.');
    expect(chi).not.toContain('Nicolae Rotaru');
  });

  it('con una partita IVA segnaposto (soli zeri) il nome della società resta fuori', async () => {
    conLeVariabili({ NOME: 'MyCity S.r.l.', PIVA: 'IT00000000000' });
    const { titolare } = await import('@/lib/legal/titolare');
    expect(titolare().gestore).toBe('Nicolae Rotaru');
    expect(titolare().denominazione).toBe('MyCity');
  });

  it('un nome legale che contiene il marchio ma è un soggetto vero resta com’è', async () => {
    conLeVariabili({ NOME: 'MyCity di Mario Bianchi' });
    const { titolare } = await import('@/lib/legal/titolare');
    expect(titolare().denominazione).toBe('MyCity di Mario Bianchi');
    expect(titolare().gestore).toBeNull();
  });

  it('la sede si stampa anche senza partita IVA (art. 7 d.lgs. 70/2003)', async () => {
    conLeVariabili({ INDIRIZZO: 'Via Prova 3, 29121 Piacenza' });
    const { titolare, rigaIdentita } = await import('@/lib/legal/titolare');
    expect(rigaIdentita(titolare())).toContain('Sede: Via Prova 3, 29121 Piacenza');
  });
});
