import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 31/10/2026 (ondata 6, pacchetto «lib/legal/titolare.ts») — IL SITO NON DICEVA CHI C'E' DIETRO.
 *
 * In produzione nessuna delle 14 variabili NEXT_PUBLIC_TITOLARE_* e' messa. Il codice, per scelta,
 * non inventa sede, partita IVA o PEC che non esistono: giusto. Ma ripiegava anche il NOME sul
 * marchio, e l'informativa usciva con «Il titolare del trattamento è MyCity.» e il piede con il solo
 * «© MyCity». Un marchio non e' un soggetto: chi legge non sa a chi risponde dei suoi dati (art.
 * 13.1.a GDPR). La persona che gestisce il servizio invece esiste — Nicola, 20/8/2026: «sono io:
 * Nicolae Rotaru» — e va detta.
 *
 * La prova disegna la pagina /privacy e il piede VERI con le variabili spente, e legge il testo.
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

function comeInProduzione(nome = '') {
  for (const v of VARIABILI) vi.stubEnv(v, '');
  if (nome) vi.stubEnv('NEXT_PUBLIC_TITOLARE_NOME', nome);
  vi.resetModules();
}

async function fraseDelTitolare(): Promise<string> {
  const { default: PrivacyPage } = await import('@/app/privacy/page');
  const t = testo(renderToStaticMarkup(createElement(PrivacyPage)));
  const m = t.match(/Il titolare del trattamento è ([^.]*)\./);
  expect(m, 'la pagina deve avere la frase sul titolare (la prova la disegna davvero)').not.toBeNull();
  return (m as RegExpMatchArray)[1];
}

async function piede(): Promise<string> {
  const { default: Footer } = await import('@/components/Footer');
  return testo(renderToStaticMarkup(createElement(Footer)));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('senza le variabili del titolare, il sito dice comunque chi c’è dietro', () => {
  it('l’informativa nomina la persona che gestisce, non solo il marchio', async () => {
    comeInProduzione();
    const chi = await fraseDelTitolare();
    expect(chi, `«Il titolare del trattamento è ${chi}» non dice chi risponde`).toContain('Nicolae Rotaru');
    expect(chi.trim()).not.toBe('MyCity');
  });

  it('il piede di ogni pagina dice chi gestisce il sito', async () => {
    comeInProduzione();
    expect(await piede()).toMatch(/Titolare: Nicolae Rotaru/);
  });

  it('e niente sede, partita IVA o PEC inventate al loro posto', async () => {
    comeInProduzione();
    const t = await piede();
    expect(t).not.toMatch(/P\.IVA|PEC:|Sede:/);
  });
});

describe('quando il nome legale c’è, parla quello da solo', () => {
  it('informativa e piede usano il nome legale e non aggiungono la persona', async () => {
    // La forma di una ditta individuale: il nome legale contiene gia' la persona.
    comeInProduzione('MyCity di Nicolae Rotaru');
    expect((await fraseDelTitolare()).trim()).toBe('MyCity di Nicolae Rotaru');
    expect(await piede()).not.toMatch(/Titolare:/);
  });
});
