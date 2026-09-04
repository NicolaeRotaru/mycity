/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';
import { esitoRientroDaStripe, cosaMancaAStripe } from '@/app/seller/dashboard/esito-stripe';

/**
 * 3/9/2026 — «CONFIGURAZIONE PAGAMENTI AGGIORNATA!» ANCHE QUANDO STRIPE NON
 * AVEVA ATTIVATO NIENTE.
 *
 * Anna di Pane Quotidiano finisce l'inserimento dell'IBAN con i documenti
 * ancora da caricare. Stripe la rimanda sul cruscotto, la pagina richiama la
 * rotta che rilegge lo stato — e butta via la risposta. Il messaggio verde era
 * scritto in fondo all'effetto, fuori dal try: compariva anche quando la
 * chiamata falliva del tutto. Anna legge che è tutto a posto, comincia a
 * vendere, e gli incassi restano fermi su Stripe finché qualcuno non se ne
 * accorge giorni dopo. È esattamente il momento in cui un negozio nuovo decide
 * se fidarsi.
 *
 * Qui si prova due cose, in quest'ordine: che il messaggio nasce dallo stato
 * (la funzione si esegue), e che è quel messaggio che arriva davvero a video
 * (la pagina si monta, con la risposta di Stripe finta).
 */

const DOCUMENTO_MANCANTE = ['individual.verification.document'];

describe('il messaggio nasce da quello che Stripe ha risposto', () => {
  it('se Stripe paga, lo dice', () => {
    const e = esitoRientroDaStripe({ connected: true, payouts_enabled: true, details_submitted: true });
    expect(e.tono).toBe('ok');
    expect(e.titolo).toContain('attivi');
  });

  it('se Stripe non paga ancora, non dice che è tutto a posto', () => {
    const e = esitoRientroDaStripe({
      connected: true,
      payouts_enabled: false,
      details_submitted: true,
      currently_due: DOCUMENTO_MANCANTE,
    });
    expect(e.tono, 'Stripe non ha attivato i pagamenti: non è un «ok»').toBe('attesa');
    expect(e.titolo).toContain('non ancora attivi');
    expect(e.dettaglio, 'e deve dire dove si finisce').toContain('Guadagni');
  });

  it('se la chiamata non riesce, lo dichiara invece di inventare un verde', () => {
    const e = esitoRientroDaStripe(null);
    expect(
      e.tono,
      'Con la chiamata caduta compariva lo stesso «Configurazione pagamenti aggiornata!»',
    ).toBe('ignoto');
    expect(e.titolo).toContain('Non sono riuscito');
  });

  it('non mostra al negoziante le sigle di Stripe', () => {
    const testo = cosaMancaAStripe({
      connected: true,
      payouts_enabled: false,
      currently_due: DOCUMENTO_MANCANTE,
    });
    expect(testo, 'i codici tecnici di Stripe non si mostrano a un negoziante').not.toContain('individual');
    expect(testo).toContain('un dato');
  });

  it('conta quante cose mancano quando sono più di una', () => {
    const testo = cosaMancaAStripe({
      currently_due: ['individual.verification.document', 'external_account'],
    });
    expect(testo).toContain('2 dati');
  });

  it('un conto sospeso da Stripe non è «in attesa e basta»', () => {
    const testo = cosaMancaAStripe({
      connected: true,
      payouts_enabled: false,
      currently_due: [],
      disabled_reason: 'requirements.past_due',
    });
    expect(testo).toContain('sospeso');
  });
});

/**
 * La funzione può anche dire la cosa giusta: se la pagina continuasse a
 * scrivere il verde in fondo all'effetto, il negoziante leggerebbe lo stesso la
 * bugia. Qui si monta la pagina vera, si finge il rientro da Stripe e si guarda
 * cosa c'è scritto sullo schermo.
 */
describe('il cruscotto, tornando da Stripe', () => {
  const fetchVero = globalThis.fetch;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).__PROFILO__ = {
      isSeller: true,
      profile: { id: 'negozio-1', store_name: 'Pane Quotidiano' },
    };
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = (o: { queryKey?: readonly unknown[] }) =>
      Array.isArray(o?.queryKey) && o.queryKey[0] === 'seller' && o.queryKey[1] === 'stats'
        ? {
            productCount: 1, availableCount: 1, orderCount: 0, vendutoArticoli: 0,
            incassato: 0, netto: 0, revenueToday: 0, revenue7: 0, revenue30: 0,
            ordiniOggi: 0, ordini7: 0, ordini30: 0, ordersToday: 0, orders7: 0,
            last30Count: 0, avgRating: 0, reviewCount: 0,
          }
        : undefined;
    window.history.replaceState({}, '', '/seller/dashboard?stripe=connected');
  });

  afterEach(() => {
    globalThis.fetch = fetchVero;
    document.body.innerHTML = '';
    delete (globalThis as Record<string, unknown>).__DATI_QUERY__;
    delete (globalThis as Record<string, unknown>).__PROFILO__;
    window.history.replaceState({}, '', '/');
  });

  /** Stripe risponde così alla rotta che rilegge lo stato. */
  function stripeRisponde(corpo: unknown, ok = true) {
    globalThis.fetch = vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => corpo,
    })) as unknown as typeof fetch;
  }

  async function apri() {
    const mod = await monta('app/seller/dashboard/page.tsx');
    const s = accendi(mod.default as ComponentType);
    // L'effetto chiama la rotta e poi decide: si lascia finire.
    for (let i = 0; i < 6; i += 1) await attendi();
    return s;
  }

  it('coi documenti ancora da caricare NON dice che è tutto a posto', async () => {
    stripeRisponde({
      connected: true,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      currently_due: DOCUMENTO_MANCANTE,
      disabled_reason: 'requirements.past_due',
    });
    const s = await apri();
    const testo = s.radice.textContent ?? '';

    expect(
      testo,
      'Con i pagamenti non attivi la pagina scriveva «Configurazione pagamenti aggiornata!»: il negoziante comincia a vendere e gli incassi restano fermi',
    ).not.toContain('Configurazione pagamenti aggiornata');
    expect(testo, 'deve dire che i pagamenti non sono attivi').toContain('non ancora attivi');
    expect(testo, 'e dove si finisce').toContain('Guadagni');
    s.smonta();
  }, 120000);

  it('se la chiamata a Stripe fallisce, non festeggia', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('rete caduta');
    }) as unknown as typeof fetch;
    const s = await apri();
    const testo = s.radice.textContent ?? '';

    expect(
      testo,
      'Il messaggio verde stava fuori dal try: compariva anche quando la chiamata non partiva nemmeno',
    ).not.toContain('Configurazione pagamenti aggiornata');
    expect(testo, 'deve ammettere che non ha potuto controllare').toContain('Non sono riuscito a controllare');
    s.smonta();
  }, 120000);

  it('se la rotta risponde con un errore, quella risposta non vale come stato', async () => {
    stripeRisponde({ error: 'Errore Stripe' }, false);
    const s = await apri();
    const testo = s.radice.textContent ?? '';
    expect(testo).not.toContain('Configurazione pagamenti aggiornata');
    expect(testo).toContain('Non sono riuscito a controllare');
    s.smonta();
  }, 120000);

  it('quando Stripe paga davvero, non mette in mezzo nessun avviso', async () => {
    stripeRisponde({
      connected: true,
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      currently_due: [],
      disabled_reason: null,
    });
    const s = await apri();
    const testo = s.radice.textContent ?? '';
    expect(testo, 'con i pagamenti attivi non c\'è niente da segnalare').not.toContain('non ancora attivi');
    expect(testo).not.toContain('Non sono riuscito a controllare');
    s.smonta();
  }, 120000);
});
