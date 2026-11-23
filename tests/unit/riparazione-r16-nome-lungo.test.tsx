/**
 * @vitest-environment jsdom
 */
/**
 * R16-008 — UN NOME DI NEGOZIO LUNGO NON ALLARGA LE PAGINE SUL TELEFONO.
 *
 * 1. Il nome del negozio ha un tetto di 80 caratteri nella domanda d'iscrizione (modulo e rotta),
 *    ma dal modulo del negozio (VendorForm, «Dati del negozio») si cambiava senza limite: un nome
 *    di centinaia di lettere tornava nelle schede di home, elenco e «vicino a te». Ora lo stesso
 *    tetto, con la stessa frase.
 * 2. «Vicino a te» a 280 e 320 px col testo al 200% era larga 359 px (misurato in Chromium col CSS
 *    compilato del sito): il selettore Lista/Mappa in linea, largo quanto il suo contenuto, e il
 *    cursore del raggio (w-40, che non si stringe) uscivano dallo schermo. Qui si guardano le classi
 *    che li tengono dentro la riga.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent } from '@testing-library/dom';

vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@/components/StoreAvatar', () => ({ default: () => null }));
vi.mock('@/components/StoreMediaManager', () => ({ default: () => null }));
vi.mock('@/components/StoreLocationPickerLazy', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }),
}));
vi.mock('react-dropzone', () => ({
  useDropzone: () => ({ getRootProps: () => ({}), getInputProps: () => ({}), isDragActive: false, open: () => undefined }),
}));
vi.mock('@/lib/storage/carica-immagine', () => ({ ANNO_IN_SECONDI: 31536000, caricaImmagine: async () => '' }));
vi.mock('@/components/seller/AccentPicker', () => ({ default: () => null }));
vi.mock('@/components/seller/CoverPicker', () => ({ default: () => null }));
vi.mock('@/components/seller/AnnouncementEditor', () => ({ default: () => null }));
vi.mock('@/components/seller/BadgePicker', () => ({ default: () => null }));
vi.mock('@/components/seller/StoreHoursEditor', () => ({ default: () => null }));
vi.mock('@/components/seller/FeaturedProductsPicker', () => ({ default: () => null }));

import VendorForm from '@/components/VendorForm';

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});
const aspetta = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const FRASE = 'Il nome del negozio può avere al massimo 80 caratteri: accorcialo';

async function provaIlNome(nome: string) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const onSubmit = vi.fn();
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => {
    root.render(createElement(VendorForm, { onSubmit, mode: 'branding', defaultValues: { storeName: 'Pane Quotidiano' } }));
  });
  await aspetta();
  const campo = [...radice.querySelectorAll<HTMLInputElement>('input')].find((i) => i.name === 'storeName')!;
  expect(campo, 'controprova: il campo del nome c\'è').toBeTruthy();
  await act(async () => { fireEvent.input(campo, { target: { value: nome } }); });
  await act(async () => { radice.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await aspetta();
  return { radice, onSubmit, campo };
}

describe('R16-008 — dal modulo del negozio il nome ha lo stesso tetto della domanda', () => {
  it('81 lettere attaccate: il modulo dice di accorciare e non salva', async () => {
    const { radice, onSubmit, campo } = await provaIlNome('P'.repeat(81));
    expect(radice.textContent, 'il nome di 81 caratteri passa senza nessun avviso').toContain(FRASE);
    expect(onSubmit, 'il nome di 81 caratteri è stato salvato').not.toHaveBeenCalled();
    expect(campo.value, 'il nome resta intero nel campo, non tagliato in silenzio').toHaveLength(81);
  });

  it('controprova: 80 lettere attaccate si salvano', async () => {
    const { radice, onSubmit } = await provaIlNome('P'.repeat(80));
    expect(radice.textContent).not.toContain(FRASE);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].storeName).toBe('P'.repeat(80));
  });
});

describe('R16-008 — «vicino a te» col testo al 200% resta larga quanto lo schermo', () => {
  const src = readFileSync('app/near/page.tsx', 'utf8');
  const classiDi = (re: RegExp, cosa: string) => {
    const m = src.match(re);
    expect(m, `controprova: ${cosa} non si trova in app/near/page.tsx`).toBeTruthy();
    return m![1].split(/\s+/);
  };

  it('il selettore Lista/Mappa ha un tetto e va a capo', () => {
    const c = classiDi(/<div className="([^"]*\binline-flex\b[^"]*)">\s*\{toggleBtn\('list'/, 'il selettore Lista/Mappa');
    expect(c, 'il selettore è in linea senza tetto: col testo grande allarga la pagina').toContain('max-w-full');
    expect(c, 'i due bottoni non possono andare a capo').toContain('flex-wrap');
  });

  it('la riga del raggio va a capo e il cursore non supera la riga', () => {
    const riga = classiDi(/<label className="([^"]*)">\s*<span className="whitespace-nowrap font-semibold">Raggio:/, 'la riga del raggio');
    expect(riga, 'la riga del raggio non va a capo').toContain('flex-wrap');
    const cursore = classiDi(/<input\s+type="range"[\s\S]*?className="([^"]*)"/, 'il cursore del raggio');
    expect(cursore, 'il cursore è largo w-40 e non si stringe sotto').toContain('max-w-full');
  });
});
