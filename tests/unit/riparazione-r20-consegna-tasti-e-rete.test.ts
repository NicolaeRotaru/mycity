/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement, useState, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { monta } from './aiuti/monta-componente';
import { attendi } from './aiuti/schermo';
import VerifyCodeDialog from '@/components/VerifyCodeDialog';

/**
 * R20-001 — Nella consegna in corso:
 *  · Naviga, Chiama e SMS (Button size="sm") erano alti 32 px, la freccia indietro 36×36: in strada
 *    il pollice li sbaglia;
 *  · senza rete, con il codice GIUSTO, la finestra del codice diceva «Verifica fallita»: il fattorino
 *    pensava di aver sbagliato e richiedeva il codice al cliente.
 */

const globali = globalThis as Record<string, unknown>;
const ORDINE = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';

const ordine = {
  id: ORDINE, user_id: 'cliente-1', seller_id: 'negozio-1', total_price: 25, shipping_cost: 0, rider_fee_cents: 300,
  pickup_in_store: false, delivery_status: 'OUT_FOR_DELIVERY', created_at: '2026-11-13T09:00:00Z',
  accepted_at: '2026-11-13T09:05:00Z', ready_at: null, picked_up_at: '2026-11-13T09:30:00Z', delivered_at: null,
  canceled_at: null, payment_method: 'card', cash_confirmed_at: null, delivery_full_name: 'Maria Rossi',
  delivery_phone: '3331234567', delivery_address: 'Via Verdi 10', delivery_city: 'Piacenza', delivery_zip: '29121',
  delivery_notes: null, delivery_lat: null, delivery_lng: null,
  seller: { store_name: 'Pane Quotidiano', store_phone: null, store_address: 'Via Roma 1', store_lat: null, store_lng: null },
  order_items: [{ id: 'r1', quantity: 1, unit_price: 25, products: { name: 'Pane' } }],
};

/**
 * L'altezza minima che le classi Tailwind danno a un elemento, in pixel: la più grande fra
 * `h-…` e `min-h-…` (h-11 = 44 px, h-[44px] = 44 px).
 */
const misura = (classi: string, asse: 'h' | 'w'): number => {
  let piu = 0;
  for (const m of classi.matchAll(new RegExp(`(?:^|\\s)(?:min-)?${asse}-(?:\\[(\\d+)px\\]|(\\d+(?:\\.5)?))(?=\\s|$)`, 'g'))) {
    piu = Math.max(piu, m[1] ? Number(m[1]) : Number(m[2]) * 4);
  }
  return piu;
};

describe('R20-001 — i tasti della consegna in corso', () => {
  let radice: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globali.__PROFILO__ = { isAuthenticated: true, isRider: true, profile: { full_name: 'Luca Verdi' } };
    globali.__DATI_QUERY__ = () => ordine;
    Object.defineProperty(navigator, 'geolocation', {
      value: { watchPosition: () => 1, clearWatch: () => {}, getCurrentPosition: () => {} },
      configurable: true,
    });
    const Pagina = (await monta('app/rider/orders/[id]/page.tsx')).default as ComponentType<Record<string, unknown>>;
    globali.IS_REACT_ACT_ENVIRONMENT = true;
    radice = document.createElement('div');
    document.body.appendChild(radice);
    await act(async () => {
      root = createRoot(radice);
      root.render(createElement(Pagina, { params: { id: ORDINE } }));
    });
    await attendi();
  }, 60000);

  afterEach(async () => {
    await act(async () => root?.unmount());
    radice?.remove();
    globali.__DATI_QUERY__ = undefined;
    globali.__PROFILO__ = undefined;
    document.body.innerHTML = '';
  });

  it('Naviga, Chiama e SMS sono alti almeno 44 px', () => {
    const link = Array.from(radice.querySelectorAll('a'));
    const naviga = link.find((a) => (a.textContent ?? '').trim() === 'Naviga');
    const chiama = link.find((a) => (a.getAttribute('href') ?? '').startsWith('tel:'));
    const sms = link.find((a) => (a.getAttribute('href') ?? '').startsWith('sms:'));
    expect(naviga && chiama && sms, 'i tre tasti non si sono disegnati: la prova girerebbe a vuoto').toBeTruthy();
    for (const [nome, el] of [['Naviga', naviga], ['Chiama', chiama], ['SMS', sms]] as const) {
      expect(misura(el!.getAttribute('class') ?? '', 'h'), `«${nome}» è più basso di 44 px`).toBeGreaterThanOrEqual(44);
    }
  });

  it('la freccia per tornare alle consegne misura almeno 44×44', () => {
    const indietro = radice.querySelector('a[aria-label="Torna alle consegne"]');
    expect(indietro).toBeTruthy();
    const classi = indietro!.getAttribute('class') ?? '';
    expect(misura(classi, 'h'), 'la freccia indietro è più bassa di 44 px').toBeGreaterThanOrEqual(44);
    expect(misura(classi, 'w'), 'la freccia indietro è più stretta di 44 px').toBeGreaterThanOrEqual(44);
  });
});

describe('R20-001 — senza rete un codice giusto non è «Verifica fallita»', () => {
  let root: Root;

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
  });

  function Banco({ invia }: { invia: () => Promise<{ ok: boolean; reason?: string }> }) {
    const [aperta, setAperta] = useState(true);
    return createElement(VerifyCodeDialog, {
      open: aperta, title: 'Codice di consegna', description: 'Chiedilo al cliente', ctaLabel: 'Conferma',
      onClose: () => setAperta(false), onSubmit: invia,
    });
  }

  async function prova(invia: () => Promise<{ ok: boolean; reason?: string }>) {
    globali.IS_REACT_ACT_ENVIRONMENT = true;
    const c = document.createElement('div');
    document.body.appendChild(c);
    root = createRoot(c);
    await act(async () => root.render(createElement(Banco, { invia })));
    await act(async () => new Promise((r) => setTimeout(r, 150)));
    const campo = document.getElementById('verify-code') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campo, '123456');
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { (campo.form as HTMLFormElement).requestSubmit(); });
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    return { avviso: document.querySelector('[role="alert"]')?.textContent ?? '', campo };
  }

  // supabase-js senza rete non lancia: risponde con l'errore del browser, e la pagina lo passa come motivo.
  it.each([
    ['Chrome', 'TypeError: Failed to fetch'],
    ['Safari', 'TypeError: Load failed'],
    ['Firefox', 'TypeError: NetworkError when attempting to fetch resource.'],
  ])('rete staccata (%s): dice che manca la rete e non segna il codice come sbagliato', async (_b, motivo) => {
    const { avviso, campo } = await prova(async () => ({ ok: false, reason: motivo }));
    expect(avviso, 'senza rete il fattorino legge «Verifica fallita» e pensa di aver sbagliato codice').not.toMatch(/Verifica fallita/);
    expect(avviso).toMatch(/rete|connessione/i);
    expect(avviso, 'senza rete gli si dice che il codice è errato').not.toMatch(/codice errato/i);
    expect(campo.getAttribute('aria-invalid'), 'senza rete il campo si segna come codice sbagliato').not.toBe('true');
  });

  it('rete staccata e la chiamata lancia: stesso avviso di rete', async () => {
    const { avviso, campo } = await prova(async () => { throw new TypeError('Failed to fetch'); });
    expect(avviso).toMatch(/rete|connessione/i);
    expect(avviso).not.toMatch(/^Failed to fetch$/);
    expect(campo.getAttribute('aria-invalid')).not.toBe('true');
  });

  it('controllo: un codice davvero sbagliato resta «Codice errato», col campo segnato', async () => {
    const { avviso, campo } = await prova(async () => ({ ok: false, reason: 'WRONG_CODE' }));
    expect(avviso).toMatch(/Codice errato/);
    expect(campo.getAttribute('aria-invalid')).toBe('true');
  });
});
