/**
 * @vitest-environment jsdom
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { motivoFuoriZona } from '@/lib/ordini/zona-di-consegna';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

const src = readFileSync('app/checkout/page.tsx', 'utf8');

describe('R19-003 · l\'avviso «fuori zona» sta anche accanto all\'indirizzo', () => {
  it('nel passo 1, subito dopo il modulo indirizzo, c\'è l\'avviso con la stessa frase del blocco', () => {
    const a = src.indexOf('<ShippingAddressForm');
    const b = src.indexOf('title="Quando vuoi riceverlo"');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    const passo1 = src.slice(a, b);
    expect(passo1).toMatch(/\{fuoriZona && \(/);
    expect(passo1).toMatch(/role="alert"/);
    expect(passo1).toMatch(/motivoFuoriZona\(gruppoFuoriZona\?\.storeName\)/);
  });
});

/**
 * Giro di correzione (13/11): la prova di sopra legge il sorgente. Qui si monta la
 * cassa vera: indirizzo fuori zona → l'avviso compare nel passo 1, accanto al campo;
 * indirizzo in zona → sparisce. E col pulsante bloccato per le scorte, «vai al primo
 * blocco» porta al riquadro delle scorte, non all'avviso del passo 1.
 */
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, info: () => undefined, error: () => undefined, warning: () => undefined }),
}));

const g = globalThis as Record<string, unknown>;
const MARIA = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'maria@test.it' };
const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FILONE = { id: 'p-filone', name: 'Filone', price: 15, quantity: 3, sellerId: PANE, storeName: 'Pane Quotidiano' };
const gruppi = (stockIssues: unknown[] = []) => ({
  groups: [{ sellerId: PANE, storeName: 'Pane Quotidiano', storeLat: 45.0526, storeLng: 9.693, items: [FILONE] }],
  orphans: [],
  stockIssues,
  variantIssues: [],
  prezziCambiati: [],
});
// Podenzano: oltre il raggio dal negozio in centro. Via Verdi: in centro.
const LONTANO = { id: 'ind-far', user_id: MARIA.id, full_name: 'Maria Rossi', address: 'Via Lontana 1', city: 'Podenzano', zip: '29027', phone: '3331234567', notes: null, lat: 44.955, lng: 9.683, is_default: true };
const VICINO = { id: 'ind-near', user_id: MARIA.id, full_name: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567', notes: null, lat: 45.0526, lng: 9.7, is_default: false };

let coordinate = { lat: 44.955, lng: 9.683 };
const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(input);
  if (url.includes('/api/geocode')) return { ok: true, status: 200, headers: new Headers(), json: async () => coordinate, text: async () => '' };
  return { ok: true, status: 200, headers: new Headers(), json: async () => ({ possibile: false }), text: async () => '' };
}) as unknown as typeof fetch;
afterAll(() => {
  globalThis.fetch = reteDiPartenza;
});

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  delete g.__DATI_QUERY__;
  delete g.__UTENTE__;
});

async function assesta(n = 12) {
  for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
function scrivi(el: HTMLInputElement, v: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
}

async function apriLaCassa(indirizzi: unknown[], stockIssues: unknown[] = []) {
  localStorage.setItem('cart', JSON.stringify([FILONE]));
  g.__UTENTE__ = MARIA;
  g.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const [chi] = o.queryKey;
    if (chi === 'checkout-groups') return gruppi(stockIssues);
    if (chi === 'auth-user') return MARIA;
    if (chi === 'user-addresses') return indirizzi;
    return undefined;
  };
  const pagina = (await monta('app/checkout/page.tsx')).default;
  schermo = accendi(pagina, {});
  await assesta();
  return schermo.radice;
}

const FRASE = motivoFuoriZona('Pane Quotidiano');

/** Gli avvisi «fuori zona» che stanno nel riquadro del passo 1, quello dell'indirizzo. */
function avvisiNelPasso1(radice: HTMLElement): HTMLElement[] {
  const modulo = radice.querySelector('#checkout-form');
  expect(modulo, 'il modulo dell\'indirizzo non c\'è: la prova non misura niente').not.toBeNull();
  return [...radice.querySelectorAll<HTMLElement>('[role="alert"]')].filter((el) => {
    if (!(el.textContent ?? '').includes(FRASE)) return false;
    // Accanto al campo: nello stesso riquadro del modulo, subito dopo di lui.
    const riquadro = el.parentElement;
    return !!riquadro && riquadro.contains(modulo) && !!(modulo!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
}

describe('R19-003 · montata: l\'avviso «fuori zona» accanto all\'indirizzo', () => {
  it('indirizzo salvato fuori zona: l\'avviso c\'è nel passo 1; scelto l\'indirizzo in zona, sparisce', async () => {
    const radice = await apriLaCassa([LONTANO, VICINO]);
    expect(avvisiNelPasso1(radice)).toHaveLength(1);
    const mattonella = [...radice.querySelectorAll('button')].find((b) => /Via Verdi 10/.test(b.textContent ?? ''));
    expect(mattonella, 'manca la mattonella dell\'indirizzo in zona').toBeTruthy();
    clicca(mattonella!);
    await assesta();
    expect(avvisiNelPasso1(radice)).toHaveLength(0);
    expect(radice.textContent ?? '').not.toContain(FRASE);
  }, 60000);

  it('indirizzo scritto a mano: fuori zona l\'avviso compare accanto al campo, in zona sparisce', async () => {
    coordinate = { lat: 44.955, lng: 9.683 };
    const radice = await apriLaCassa([]);
    const campo = (n: string) => radice.querySelector<HTMLInputElement>(`input[name="${n}"]`)!;
    await act(async () => {
      scrivi(campo('fullName'), 'Maria Rossi');
      scrivi(campo('address'), 'Via Lontana 1');
      scrivi(campo('city'), 'Podenzano');
      scrivi(campo('zip'), '29027');
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 1500)); });
    await assesta();
    expect(avvisiNelPasso1(radice)).toHaveLength(1);

    coordinate = { lat: 45.0526, lng: 9.7 };
    await act(async () => {
      scrivi(campo('address'), 'Via Verdi 10');
      scrivi(campo('city'), 'Piacenza');
      scrivi(campo('zip'), '29121');
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 1500)); });
    await assesta();
    expect(avvisiNelPasso1(radice)).toHaveLength(0);
  }, 60000);

  it('fuori zona ma bloccato prima per le scorte: «vai al primo blocco» porta al riquadro delle scorte', async () => {
    Element.prototype.scrollIntoView = () => undefined;
    const radice = await apriLaCassa([LONTANO], [{ id: FILONE.id, name: 'Filone', requested: 3, available: 1 }]);
    // L'avviso del passo 1 resta a schermo (informa), ma il motivo del blocco è un altro.
    expect(avvisiNelPasso1(radice)).toHaveLength(1);
    const scorte = [...radice.querySelectorAll<HTMLElement>('[role="alert"]')].find((el) => /Disponibilità insufficiente/.test(el.textContent ?? ''));
    expect(scorte, 'manca il riquadro delle scorte').toBeTruthy();

    const bloccati = [...radice.querySelectorAll<HTMLButtonElement>('button[aria-disabled="true"][form="checkout-form"]')];
    expect(bloccati.length).toBeGreaterThan(0);
    for (const pulsante of bloccati) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      clicca(pulsante);
      await assesta(2);
      expect(document.activeElement, 'il salto non è andato al riquadro delle scorte').toBe(scorte);
    }
  }, 60000);
});
