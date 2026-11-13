/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * R10-017 — Nella lista dei miei ordini «Traccia» e «Riordina» erano alti 32 px
 * (Button size="sm"), sotto i 44 px che servono al pollice. Qui si monta la
 * pagina VERA con un ordine in consegna e si guardano i due bottoni.
 */

type Pagina = ComponentType<Record<string, unknown>>;
const g = globalThis as unknown as Record<string, unknown>;
afterEach(() => { delete g.__DATI_QUERY__; delete g.__UTENTE__; });

describe('R10-017 — «Traccia» e «Riordina» si prendono col pollice', () => {
  it('i due bottoni hanno l’altezza minima di 44 px', async () => {
    const Ordini = (await monta('app/orders/page.tsx')).default as Pagina;
    g.__UTENTE__ = { id: 'luca-1', email: 'luca@example.it' };
    g.__DATI_QUERY__ = () => [{
      id: 'o1', total_price: 12, payment_status: 'PAID', delivery_status: 'OUT_FOR_DELIVERY',
      created_at: '2026-11-10T10:00:00.000Z', seller_id: 'n1', seller: { store_name: 'Forno', store_logo: null },
      order_items: [],
    }];
    const s = accendi(Ordini);
    const limite = Date.now() + 4000;
    while (Date.now() < limite && !/Riordina/.test(testoVisibile(s.radice))) {
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    }
    const comandi = [...s.radice.querySelectorAll<HTMLElement>('a, button')].filter((el) =>
      /^(Traccia|Riordina)$/.test((el.textContent ?? '').trim()),
    );
    // Revisione qa: il blocco con miniature e prezzo non deve avere base 0, o i bottoni (che non si
    // stringono) non vanno mai a capo e coprono il prezzo sul telefono.
    const prezzo = [...s.radice.querySelectorAll<HTMLElement>('span')].find((el) => /12,00/.test(el.textContent ?? ''));
    const bloccoSinistro = prezzo?.parentElement ?? null;
    s.smonta();
    // Collaudo K03: con 4 miniature + «+N» anche una base di 14rem non bastava fino a 600 px.
    // Miniature e prezzo prendono la riga intera (i bottoni vanno sotto) fino ai computer larghi.
    expect(bloccoSinistro?.className ?? '', 'miniature e prezzo dividono la riga coi bottoni sul telefono').toMatch(/(^|\s)basis-full(\s|$)/);
    expect(bloccoSinistro?.firstElementChild?.className ?? '', 'le miniature escono dalla card invece di andare a capo').toMatch(/(^|\s)flex-wrap(\s|$)/);
    expect(comandi.map((c) => (c.textContent ?? '').trim()).sort()).toEqual(['Riordina', 'Traccia']);
    for (const c of comandi) {
      expect(c.className, `«${c.textContent?.trim()}» è sotto i 44 px`).toMatch(/min-h-\[44px\]/);
    }
  }, 120000);
});
