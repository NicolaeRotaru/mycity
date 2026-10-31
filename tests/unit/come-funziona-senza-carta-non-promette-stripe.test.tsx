/**
 * @vitest-environment jsdom
 *
 * 28/10/2026 — ondata 10, pacchetto «lib/promesse-pubbliche.ts», bocciatura del collaudo.
 *
 * In produzione la chiave pubblica di Stripe manca: la cassa offre solo i contanti. La frase sul
 * pagamento lo sapeva già («Paghi in contanti alla consegna»), ma la pagina /come-funziona ci
 * attaccava dietro a mano «: al rider quando arriva, oppure su Stripe prima della conferma».
 * Risultato letto dal cliente: contanti soltanto… oppure Stripe. La prova rende la pagina VERA nei
 * due versi della chiave e guarda il testo che la persona legge.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// La banda di rassicurazione nasce quando il modulo viene caricato: la chiave va fissata PRIMA
// dell'import, come succede in una build vera.
// 31/10/2026 — La chiave non basta più: la carta vuole anche CARTA_ACCESA (lib/funzioni-al-lancio.ts).
// `cartaAccesa` lo accende per finta; senza, vale quello del file vero (spento al lancio).
async function paginaConChiave(chiave: string, cartaAccesa?: boolean): Promise<string> {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', chiave);
  if (cartaAccesa === undefined) vi.doUnmock('@/lib/funzioni-al-lancio');
  else {
    vi.doMock('@/lib/funzioni-al-lancio', async (originale) => ({
      ...((await originale()) as Record<string, unknown>),
      CARTA_ACCESA: cartaAccesa,
    }));
  }
  const { default: ComeFunzionaPage } = await import('@/app/come-funziona/page');
  const html = renderToStaticMarkup(createElement(ComeFunzionaPage));
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('/come-funziona dice come si paga davvero', () => {
  it('senza la chiave Stripe (come in produzione) non nomina Stripe né la carta', async () => {
    const testo = await paginaConChiave('');
    expect(testo).toMatch(/Paghi in contanti alla consegna/);
    expect(testo).toMatch(/al rider quando arriva/);
    expect(testo).not.toMatch(/Stripe/);
    expect(testo).not.toMatch(/carta/i);
  });

  it('con la chiave ma l\'interruttore spento (come al lancio) non nomina Stripe', async () => {
    const testo = await paginaConChiave('pk_test_123');
    expect(testo).toMatch(/Paghi in contanti alla consegna/);
    expect(testo).not.toMatch(/Stripe/);
  });

  it('con la chiave e l\'interruttore acceso la carta su Stripe torna, da sé', async () => {
    const testo = await paginaConChiave('pk_test_123', true);
    expect(testo).toMatch(/oppure con carta adesso/);
    expect(testo).toMatch(/su Stripe prima della conferma/);
  });
});
