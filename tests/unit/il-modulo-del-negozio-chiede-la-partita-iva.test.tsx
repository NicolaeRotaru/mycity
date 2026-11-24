/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 31/10/2026 (ondata 4) — IL MODULO D'ISCRIZIONE DEL NEGOZIO, SUL COMPONENTE VERO.
 *
 *  · chiede la partita IVA e la sede legale: prima diceva «verranno raccolti
 *    più avanti», ma il più avanti non esisteva e «Venduto da» restava vuoto;
 *  · non chiede più un'«email operativa» che poi veniva buttata via;
 *  · con l'abbonamento spento non fa accettare nessun addebito mensile.
 */

vi.mock('@/components/StoreLocationPickerLazy', () => ({ default: () => null }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@/components/StoreAvatar', () => ({ default: () => null }));
vi.mock('@/components/StoreMediaManager', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined }) }));
vi.mock('react-dropzone', () => ({
  useDropzone: () => ({ getRootProps: () => ({}), getInputProps: () => ({}), isDragActive: false, open: () => undefined }),
}));
vi.mock('@/lib/storage/carica-immagine', () => ({ ANNO_IN_SECONDI: 31536000, caricaImmagine: async () => '' }));

import SellerApplicationForm from '@/components/SellerApplicationForm';
import { ABBONAMENTO_NEGOZI_ACCESO } from '@/lib/funzioni-al-lancio';

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

async function disegna(props: Record<string, unknown> = {}) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => {
    root.render(createElement(SellerApplicationForm as never, { onSubmit: () => undefined, ...props }));
  });
  return radice;
}

describe('il modulo d iscrizione del negozio', () => {
  // 25/11/2026 — Nicola: «questa pagina è troppo lunga, lascia il minimo indispensabile per
  // identificare quella attività». La partita IVA resta (serve per approvare); ragione sociale e
  // sede legale si scrivono dopo, dal Profilo (DatiPerIBonifici, provato in fondo a questo file).
  it('chiede il minimo per riconoscere l attività, partita IVA compresa', async () => {
    const radice = await disegna();
    for (const campo of ['businessType', 'storeName', 'businessVatNumber', 'contactPhone']) {
      expect(radice.querySelector(`input[name="${campo}"]`), `manca il campo ${campo}`).not.toBeNull();
    }
    expect(radice.textContent).toContain('Partita IVA');
    expect(radice.textContent).not.toContain('temporaneamente');
  });

  it('non chiede più quello che si scrive dopo, dal Profilo', async () => {
    const radice = await disegna();
    for (const campo of [
      'businessLegalName', 'businessAddress', 'businessCity', 'businessZip', 'businessPec', 'businessSdi',
      'legalFirstName', 'legalLastName', 'legalFiscalCode', 'legalBirthDate',
      'legalResidenceAddr', 'legalResidenceCity', 'legalResidenceZip',
      'billingIban', 'storeDescription',
    ]) {
      expect(radice.querySelector(`[name="${campo}"]`), `il modulo corto chiede ancora ${campo}`).toBeNull();
    }
    // Da scrivere a mano restano nome, partita IVA e telefono (l'indirizzo è il selettore della mappa).
    const daScrivere = Array.from(radice.querySelectorAll('input:not([type="radio"]):not([type="checkbox"]), textarea'));
    expect(daScrivere.map((i) => i.getAttribute('name'))).toEqual(['storeName', 'businessVatNumber', 'contactPhone']);
    expect(radice.textContent, 'il negozio non sa dove mettere il resto').toContain('dal tuo pannello');
    expect(radice.textContent, 'il negozio non sa che dopo gli chiediamo chi firma').toContain('i dati di chi firma');
  });

  it('non chiede un email operativa che poi non salviamo, e dice dove scriviamo', async () => {
    const radice = await disegna({ emailAccesso: 'forno@esempio.it' });
    expect(radice.querySelector('input[name="contactEmail"]')).toBeNull();
    expect(radice.textContent).not.toContain('Email operativa');
    expect(radice.textContent).toContain('forno@esempio.it');
  });

  it('con l abbonamento spento non fa accettare nessun addebito mensile', async () => {
    const radice = await disegna();
    const testo = radice.textContent ?? '';
    if (ABBONAMENTO_NEGOZI_ACCESO) {
      expect(testo).toContain('addebito mensile');
      return;
    }
    expect(testo, 'il negozio accetterebbe un addebito che al lancio non facciamo').not.toMatch(/addebito mensile/i);
    expect(testo).not.toMatch(/€\s?50/);
    expect(radice.querySelector('input[name="acceptBilling"]')).toBeNull();
  });
});

describe('quello che il modulo corto non chiede si scrive dal Profilo', () => {
  it('ragione sociale, sede legale, PEC, SDI e IBAN stanno in «Dati per i bonifici»', async () => {
    const { default: DatiPerIBonifici } = await import('@/components/seller/DatiPerIBonifici');
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    accesi.push(root);
    const vuoti = { billingIban: '', businessLegalName: '', businessVatNumber: '', businessAddress: '', businessCity: '', businessZip: '', businessPec: '', businessSdi: '' };
    await act(async () => { root.render(createElement(DatiPerIBonifici, { iniziali: vuoti })); });
    for (const campo of Object.keys(vuoti)) {
      expect(radice.querySelector(`input[name="${campo}"]`), `«Dati per i bonifici» non chiede ${campo}`).not.toBeNull();
    }
  });
});
