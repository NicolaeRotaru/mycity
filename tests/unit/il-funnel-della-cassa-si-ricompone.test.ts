import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  chiaveDelCheckout,
  chiudiChiaveDelCheckout,
  chiaveCheckoutValida,
} from '@/lib/analytics/chiave-checkout';

/**
 * 30/8/2026 (R163) — «ARRIVA ALLA CASSA → PAGA» POTEVA SUPERARE IL 100%.
 *
 * I due capi del funnel si contavano con unita' di misura diverse e senza
 * niente in comune:
 *
 *  · `checkout_started` partiva UNA volta per carrello e non portava nessun
 *    identificativo — solo totale e numero di articoli;
 *  · `order_placed` parte una volta per ORDINE, e un carrello da due negozi fa
 *    due ordini. Quello sí porta `checkout_id`.
 *
 * Un avvio, due acquisti, nessuna chiave per ricucirli: la conversione della
 * cassa — la misura su cui si giudica ogni intervento sul checkout — usciva
 * sopra il 100% e non era ricomponibile a posteriori.
 *
 * Adesso la chiave nasce nel browser quando si entra in cassa, viaggia con
 * l'avvio, viaggia con la richiesta d'ordine (tutte e due le strade di
 * pagamento) e torna dentro `order_placed`.
 */

describe('la chiave del checkout, dal lato del browser', () => {
  function deposito() {
    const dentro = new Map<string, string>();
    return {
      getItem: (k: string) => dentro.get(k) ?? null,
      setItem: (k: string, v: string) => { dentro.set(k, v); },
      removeItem: (k: string) => { dentro.delete(k); },
    };
  }
  let n = 0;
  const genera = () => `chiave-${++n}`;

  beforeEach(() => { n = 0; });

  it('lo stesso carrello, rientrando in cassa, tiene la stessa chiave', () => {
    const d = deposito();
    const primo = chiaveDelCheckout(d, 'pane:2|latte:1#1800', genera);
    const secondo = chiaveDelCheckout(d, 'pane:2|latte:1#1800', genera);

    expect(primo.id).toBe(secondo.id);
    expect(primo.primoIngresso, 'il primo ingresso non e stato riconosciuto').toBe(true);
    expect(
      secondo.primoIngresso,
      'chi torna indietro a correggere l indirizzo verrebbe contato due volte',
    ).toBe(false);
  });

  it('un carrello diverso e un checkout diverso, con la sua chiave', () => {
    const d = deposito();
    const primo = chiaveDelCheckout(d, 'pane:2#900', genera);
    const dopoAverCambiato = chiaveDelCheckout(d, 'pane:2|latte:1#1800', genera);

    expect(dopoAverCambiato.id).not.toBe(primo.id);
    expect(dopoAverCambiato.primoIngresso).toBe(true);
  });

  it('a ordine fatto la chiave si chiude: la spesa dopo e un altro checkout', () => {
    const d = deposito();
    const primo = chiaveDelCheckout(d, 'pane:2#900', genera);
    chiudiChiaveDelCheckout(d);
    const spesaDopo = chiaveDelCheckout(d, 'pane:2#900', genera);

    expect(spesaDopo.id, 'due spese di fila finirebbero sotto lo stesso checkout').not.toBe(primo.id);
  });

  it('senza memoria del browser si conta comunque, con una chiave per ingresso', () => {
    const senzaDeposito = chiaveDelCheckout(null, 'pane:2#900', genera);
    expect(senzaDeposito.id).toBeTruthy();
    expect(senzaDeposito.primoIngresso).toBe(true);
  });

  it('quello che arriva dal browser al server viene ripulito', () => {
    expect(chiaveCheckoutValida('7f3c1a90-2b6e-4a11-9a0f-1c2d3e4f5a6b')).toBeTruthy();
    expect(chiaveCheckoutValida('corto')).toBeNull();
    expect(chiaveCheckoutValida('con spazi e <script>')).toBeNull();
    expect(chiaveCheckoutValida(null)).toBeNull();
    expect(chiaveCheckoutValida('x'.repeat(200))).toBeNull();
  });
});

describe('l evento di avvio del checkout', () => {
  it('porta la chiave, cosi si puo legare a quello che e stato comprato', async () => {
    const eventi: Array<{ nome: string; prop: Record<string, unknown> }> = [];
    vi.resetModules();
    vi.doMock('@/lib/analytics/posthog', () => ({
      track: (nome: string, prop: Record<string, unknown>) => { eventi.push({ nome, prop }); },
    }));
    vi.doMock('@/lib/consent', () => ({ readConsent: () => ({ analytics: true }) }));

    const { trackCheckoutStarted } = await import('@/lib/analytics/events');
    trackCheckoutStarted(1800, 3, 'chiave-del-carrello-1');

    expect(eventi[0].nome).toBe('checkout_started');
    expect(
      eventi[0].prop.checkout_id,
      'l avvio del checkout esce ancora senza identificativo: il funnel non si ricompone',
    ).toBe('chiave-del-carrello-1');
    expect(eventi[0].prop.total_cents).toBe(1800);
    vi.doUnmock('@/lib/analytics/posthog');
    vi.doUnmock('@/lib/consent');
  });
});
