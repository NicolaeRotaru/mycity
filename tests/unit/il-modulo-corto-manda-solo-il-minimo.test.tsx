/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent } from '@testing-library/dom';

/**
 * 25/11/2026 — Il collaudo del modulo corto: la prova del server usava un corpo scritto a mano.
 * Qui si compila il modulo VERO e si guarda cosa manda. Se un giorno il modulo torna a mandare
 * logo, foto o IBAN vuoti, chi corregge la richiesta li vedrebbe cancellati (il server scrive le
 * colonne dei campi che arrivano): questa prova diventa rossa prima.
 */

vi.mock('@/components/StoreLocationPickerLazy', async () => {
  const { useEffect } = await import('react');
  return {
    default: function Finto({ onChange }: { onChange: (l: unknown) => void }) {
      useEffect(() => { onChange({ address: 'Via Roma 1, 29121 Piacenza', lat: 45.05, lng: 9.69, confermata: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    },
  };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});

import SellerApplicationForm from '@/components/SellerApplicationForm';

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

const scrivi = (radice: HTMLElement, nome: string, valore: string) => {
  const campo = radice.querySelector(`input[name="${nome}"]`) as HTMLInputElement;
  fireEvent.input(campo, { target: { value: valore } });
};

describe('il modulo corto manda solo il minimo', () => {
  it('compilato e inviato, manda solo i dati per riconoscere l attività e le spunte', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const inviati: Record<string, unknown>[] = [];
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    accesi.push(root);
    await act(async () => {
      root.render(createElement(SellerApplicationForm, { onSubmit: (d: Record<string, unknown>) => { inviati.push(d); } } as never));
    });
    await act(async () => {
      scrivi(radice, 'storeName', 'Bar Roma');
      scrivi(radice, 'businessVatNumber', '01234567897');
      scrivi(radice, 'contactPhone', '3331234567');
      for (const spunta of ['acceptTos', 'acceptPrivacy', 'acceptAccuracy']) {
        fireEvent.click(radice.querySelector(`input[name="${spunta}"]`) as HTMLInputElement);
      }
    });
    await act(async () => {
      fireEvent.submit(radice.querySelector('form') as HTMLFormElement);
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(inviati, 'il modulo compilato non è partito').toHaveLength(1);
    expect(Object.keys(inviati[0]).sort()).toEqual([
      'acceptBilling', 'acceptPrivacy', 'acceptAccuracy', 'acceptTos',
      'businessType', 'businessTypeDetail', 'businessVatNumber', 'contactPhone',
      'storeAddress', 'storeLat', 'storeLng', 'storeName',
    ].sort());
    expect(inviati[0]).toMatchObject({ businessType: 'negozio', storeName: 'Bar Roma', storeAddress: 'Via Roma 1, 29121 Piacenza' });
  });
});
