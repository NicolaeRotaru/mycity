/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * L'ABBONAMENTO SI PAGA IN CONTANTI, PER ORA — 26/11/2026.
 *
 * Nicola: «non si può abbonare al momento tramite la piattaforma perché non è pronta, quindi tasto
 * abbona e toglilo» e «paga con i contanti per il momento finché non è pronta la piattaforma per i
 * pagamenti». Queste prove usano l'interruttore VERO (lib/agenzia/pagamento-servizi.ts) e dicono:
 *  · nessuna delle tre porte apre la cassa Stripe, e Stripe non viene nemmeno chiamato;
 *  · dal link il titolare accetta lo stesso, e la risposta non porta nessun indirizzo di pagamento;
 *  · il pulsante del link dice «Accetto il preventivo», senza «pago», e sotto c'è come si paga.
 * Se qualcuno riaccende il pagamento online senza la firma di Nicola, queste prove diventano rosse.
 */

const stato = vi.hoisted(() => ({
  stripeChiamato: 0,
  databaseLetto: 0,
  casseAperte: 0,
  accettati: 0,
}));

// 27/11/2026 — L'accettazione chiede il codice dell'email (lib/agenzia/codice-dal-link.ts, Nicola: «codice
// dall'email»): qui il codice è sempre giusto, perché queste prove guardano cosa succede DOPO. Il codice lo provano
// tests/unit/il-titolare-entra-col-codice-dell-email.test.ts.
vi.mock('@/lib/agenzia/codice-dal-link', () => ({ verificaCodice: () => 'giusto', chiaveDelGettone: () => 'gettone-delle-prove' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://www.mycity-marketplace.com' } }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }),
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => { stato.stripeChiamato += 1; throw new Error('Stripe non va chiamato col pagamento online spento'); },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => { stato.databaseLetto += 1; throw new Error('il database non va letto per aprire una cassa spenta'); },
}));
vi.mock('@/lib/api/middleware', () => ({
  withSellerAnchePendingRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'negozio-1', email: 'titolare@esempio.it' }, profile: {}, req, params: {} }),
}));
// La strada del link: il preventivo c'è ed è aperto; accettarlo riesce.
vi.mock('@/lib/agenzia/preventivo-col-codice', async () => ({
  CODICE_VALIDO: /^[0-9a-f]{64}$/,
  leggiPreventivoColCodice: async () => ({ sellerId: 'negozio-1', stato: 'accettato', fasciaScelta: 'business', nomeAttivita: 'Ora del Gusto' }),
  accettaPreventivoColCodice: async () => { stato.accettati += 1; return { ok: true, sellerId: 'negozio-1', accessoInviato: true }; },
}));
vi.mock('@/lib/agenzia/cassa-dal-link', async (originale) => {
  const vero = await originale<typeof import('@/lib/agenzia/cassa-dal-link')>();
  return { apriCassaDalLink: (...a: Parameters<typeof vero.apriCassaDalLink>) => { stato.casseAperte += 1; return vero.apriCassaDalLink(...a); } };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }) }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});

const { PAGAMENTO_ONLINE_SERVIZI, FRASE_CONTANTI, MESSAGGIO_CASSA_SPENTA } = await import('@/lib/agenzia/pagamento-servizi');
const { apriCassaServizi } = await import('@/lib/agenzia/cassa-servizi');
const { POST: pagaDalLink } = await import('@/app/api/preventivo/[codice]/paga/route');
const { POST: accettaDalLink } = await import('@/app/api/preventivo/[codice]/accetta/route');
const { POST: pagaDallaDashboard } = await import('@/app/api/seller/preventivo/paga/route');
const { default: AccettaDalLink } = await import('@/app/preventivo/[codice]/(demo)/abbonamento/AccettaDalLink');

const CODICE = 'a'.repeat(64);
const ctx = { params: Promise.resolve({ codice: CODICE }) };
const post = (url: string, corpo?: unknown) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });

beforeEach(() => {
  stato.stripeChiamato = 0;
  stato.databaseLetto = 0;
  stato.casseAperte = 0;
  stato.accettati = 0;
});

describe('il pagamento online è spento', () => {
  it('l interruttore vero è spento', () => {
    expect(PAGAMENTO_ONLINE_SERVIZI).toBe(false);
  });

  it('la cassa dei servizi non si apre: 409 col messaggio dei contanti, Stripe e database mai toccati', async () => {
    const r = await apriCassaServizi({ sellerId: 'negozio-1', email: 'titolare@esempio.it', fascia: 'business', ritorno: { pagato: 'https://x/1', annullato: 'https://x/0' } });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error?: { message?: string } }).error?.message).toBe(MESSAGGIO_CASSA_SPENTA);
    expect(stato.stripeChiamato).toBe(0);
    expect(stato.databaseLetto).toBe(0);
  });

  it('«Paga» dal link: 409 coi contanti, senza nemmeno leggere il preventivo', async () => {
    const r = await pagaDalLink(post(`http://localhost/api/preventivo/${CODICE}/paga`), ctx);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error?: { message?: string } }).error?.message).toMatch(/contanti/);
    expect(stato.casseAperte).toBe(0);
    expect(stato.stripeChiamato).toBe(0);
  });

  it('«Paga e attiva» della pagina Abbonamento del negozio: 409 coi contanti', async () => {
    const r = await pagaDallaDashboard(post('http://localhost/api/seller/preventivo/paga', { abbonamento: 'business' }) as never, { params: Promise.resolve({}) } as never);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error?: { message?: string } }).error?.message).toMatch(/contanti/);
    expect(stato.stripeChiamato).toBe(0);
  });

  it('dal link si accetta lo stesso: 200, nessun indirizzo di pagamento, nessuna cassa', async () => {
    const r = await accettaDalLink(post(`http://localhost/api/preventivo/${CODICE}/accetta`, { email: 'titolare@esempio.it', abbonamento: 'business', accettoCondizioni: true, codice: '123456', gettone: 'g'.repeat(20) }), ctx);
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { ok: boolean; data: { url: string | null; accessoInviato: boolean } };
    expect(corpo.ok).toBe(true);
    expect(corpo.data.url).toBeNull();
    expect(stato.accettati).toBe(1);
    expect(stato.casseAperte).toBe(0);
    expect(stato.stripeChiamato).toBe(0);
  });
});

describe('il pulsante del link', () => {
  let root: Root | null = null;
  afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; });

  it('la vecchia pagina della demo porta alla conferma col codice, niente «pago», e sotto spiega che si paga in contanti', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    root = createRoot(radice);
    await act(async () => {
      root!.render(createElement(AccettaDalLink, { codice: CODICE, consigliato: 'business', prezzi: { base: 30000, business: 50000, premium: 99900 }, primoMeseScontato: true }));
    });
    // 27/11/2026 — Da qui non si accetta più: si va alla pagina della conferma, col codice dell'email.
    expect(radice.querySelector('button[type="submit"]')).toBeNull();
    const vai = [...radice.querySelectorAll('a')].find((a) => a.textContent === 'Conferma il Business');
    expect(vai?.getAttribute('href')).toBe(`/preventivo/${CODICE}?fascia=business`);
    expect(radice.textContent).not.toMatch(/pago|Accetta e attiva/i);
    expect(radice.textContent).toContain(FRASE_CONTANTI);
  });
});
