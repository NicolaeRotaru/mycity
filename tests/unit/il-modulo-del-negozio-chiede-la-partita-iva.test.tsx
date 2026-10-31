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
  it('chiede ragione sociale, partita IVA e sede legale', async () => {
    const radice = await disegna();
    for (const campo of ['businessLegalName', 'businessVatNumber', 'businessAddress', 'businessCity', 'businessZip']) {
      expect(radice.querySelector(`input[name="${campo}"]`), `manca il campo ${campo}`).not.toBeNull();
    }
    expect(radice.textContent).toContain('Partita IVA');
    expect(radice.textContent).not.toContain('temporaneamente');
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
