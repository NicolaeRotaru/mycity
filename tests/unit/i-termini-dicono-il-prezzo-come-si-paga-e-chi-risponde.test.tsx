/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 31/10/2026 (ondata 6) — I TERMINI DICEVANO UN ALTRO CONTRATTO RISPETTO ALLE PAGINE.
 *
 * Le pagine del negozio dicevano «10% IVA inclusa», i Termini «10% IVA esclusa»: su mille
 * euro venduti sono venti euro di differenza fra quello che il negoziante legge e quello
 * che firma. Il modulo di /sell diceva «Nessun costo mensile», «Come funziona» «niente
 * canone», mentre il prezzo firmato da Nicola il 26/10 (pricing.abbonamento,
 * pricing.commissione) è uno: niente canone finché non incassi con MyCity, poi il 10% IVA
 * inclusa sul venduto tramite MyCity. Il §5 prometteva carte, Apple Pay, Google Pay,
 * «Stripe, S.A.» e un incasso «in custodia», mentre al lancio si paga in contanti alla
 * consegna e i contanti arrivano al negozio con un bonifico ogni lunedì
 * (pagamenti.al-lancio, pagamenti.bonifico-contanti-al-negozio). Il modulo di recesso
 * aveva per destinatario «MyCity», un marchio, senza email. E il testo cambiava senza
 * che cambiasse la versione: chi l'aveva accettato non poteva sapere che era un altro.
 *
 * Si disegnano le pagine vere, come in produzione (nessuna variabile del titolare,
 * nessuna chiave Stripe), e si legge quello che legge chi compra e chi vende.
 */

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isLoading: false, isError: true }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => {
    throw new Error('la prova non legge la banca dati');
  },
}));
vi.mock('@/lib/cms', () => ({ loadPublishedCmsPage: async () => null }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isSeller: false, isRider: false, isAuthenticated: false, isBuyer: false, isAdmin: false, isLoading: false }),
}));
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));
vi.mock('@/components/home/HowItWorks', () => ({ default: () => null }));
vi.mock('@/components/home/HomeCtaLink', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children),
}));
vi.mock('next-intl', async (o) => {
  const v = await o<Record<string, unknown>>();
  const t = Object.assign((k: string) => k, { rich: (k: string) => k, raw: (k: string) => k, has: () => true });
  return { ...v, useTranslations: () => t, useLocale: () => 'it' };
});

const VARIABILI = ['NOME', 'INDIRIZZO', 'PIVA', 'REA', 'PEC', 'CAPITALE', 'EMAIL_PRIVACY', 'REFERENTE_PRIVACY', 'EMAIL_DPO', 'EMAIL_RESI', 'EMAIL_RECLAMI', 'EMAIL_LEGALE', 'EMAIL_SICUREZZA', 'EMAIL_SEGNALAZIONI'].map((v) => `NEXT_PUBLIC_TITOLARE_${v}`);
const testo = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

async function termini(): Promise<string> {
  for (const v of VARIABILI) vi.stubEnv(v, '');
  vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', '');
  vi.resetModules();
  const { default: TermsPage } = await import('@/app/terms/page');
  return testo(renderToStaticMarkup(createElement(TermsPage as never)));
}

const tra = (t: string, da: RegExp, a: RegExp) => {
  const i = t.search(da);
  const resto = t.slice(i);
  const j = resto.slice(1).search(a);
  return i < 0 ? '' : j < 0 ? resto : resto.slice(0, j + 1);
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('i Termini dicono lo stesso prezzo delle pagine dei negozi', () => {
  it('la commissione nei Termini ha la stessa IVA della frase dei negozi, e il canone sospeso', async () => {
    const t = await termini();
    const { FRASE_PREZZO_NEGOZI } = await import('@/app/seller/earnings/commissione');
    const clausola = t.match(/commissione di servizio\s+trattenuta[\s\S]{0,200}?IVA (inclusa|esclusa)/i)?.[0] ?? '';
    expect(clausola, 'la clausola deve esserci').not.toBe('');
    const ivaPagine = /IVA inclusa/i.test(FRASE_PREZZO_NEGOZI) ? 'inclusa' : 'esclusa';
    expect(clausola, `pagine: ${FRASE_PREZZO_NEGOZI}`).toMatch(new RegExp(`IVA ${ivaPagine}`, 'i'));
    expect(tra(t, /9\. Obblighi dei Venditori/, /10\. /)).toContain(FRASE_PREZZO_NEGOZI.split('.')[0]);
  });
});

describe('il §5 dice come si paga davvero al lancio', () => {
  it('contanti alla consegna, bonifico al negozio ogni lunedì; niente carte, Apple Pay, POS o custodia promessi', async () => {
    const t = await termini();
    const s5 = tra(t, /5\. Pagamenti/, /6\. Consegne/);
    expect(s5, 'il §5 deve esserci').toMatch(/5\. Pagamenti/);
    expect(s5).toMatch(/contanti alla consegna/i);
    expect(s5).toMatch(/ogni lunedì/i);
    expect(s5).not.toMatch(/Apple Pay|Google Pay|PayPal|\bPOS\b|Amex|Visa|Stripe, S\.A\.|escrow|custodia/i);
  });
});

describe('il recesso dice chi lo riceve e quali prodotti sono esclusi', () => {
  it('il modulo di recesso ha per destinatario la persona che risponde, con una email', async () => {
    const t = await termini();
    const m = t.match(/Destinatario:\s*(.{0,160}?)Con la presente/);
    expect(m, 'il modulo di recesso deve esserci').not.toBeNull();
    expect(m![1], `Destinatario: ${m![1]}`).toContain('Nicolae Rotaru');
    expect(m![1], `Destinatario: ${m![1]}`).toMatch(/Email:\s*\S+@\S+/);
  });

  it('gli esclusi sono quelli del fatto legale.recesso-esclusi: freschi e fatti su ordinazione', async () => {
    const t = await termini();
    const s7 = tra(t, /7\. Diritto di recesso/, /8\. Garanzia/);
    for (const parola of ['pane', 'dolci', 'salumi', 'latticini', 'su ordinazione']) {
      expect(s7, parola).toContain(parola);
    }
  });
});

describe('quando il testo cambia, cambia la versione', () => {
  it('la versione accettata è quella stampata nei Termini, e non è più quella di maggio', async () => {
    const t = await termini();
    const { VERSIONE_TESTI_LEGALI } = await import('@/lib/legal/versione');
    const termsVer = /terms-([\d.]+)/.exec(VERSIONE_TESTI_LEGALI)?.[1];
    expect(t).toContain(`Versione ${termsVer}`);
    expect(VERSIONE_TESTI_LEGALI, 'i Termini di maggio non sono più quelli in pagina').not.toBe('privacy-2.0+terms-2.0');
  });
});

describe('/sell e «Come funziona» dicono il prezzo unico', () => {
  it('il modulo «Diventa venditore business» non dice «Nessun costo mensile»', async () => {
    const { default: Modulo } = await import('@/components/SellerApplicationForm');
    const { FRASE_PREZZO_NEGOZI } = await import('@/app/seller/earnings/commissione');
    const t = testo(renderToStaticMarkup(createElement(Modulo as never, { defaultValues: {}, onSubmit: async () => {} })));
    expect(t).toMatch(/Diventa venditore business/);
    expect(t).not.toMatch(/Nessun costo mensile|nessun abbonamento/i);
    expect(t).toContain(FRASE_PREZZO_NEGOZI.split('.')[0]);
  });

  it('«Come funziona» non dice «niente canone» da solo', async () => {
    const { default: Pagina } = await import('@/app/come-funziona/page');
    const { FRASE_PREZZO_NEGOZI } = await import('@/app/seller/earnings/commissione');
    const albero = await (Pagina as unknown as () => unknown)();
    const t = testo(renderToStaticMarkup(albero as never));
    expect(t).not.toMatch(/niente canone\./i);
    expect(t).toContain(FRASE_PREZZO_NEGOZI.split('.')[0]);
  });
});
