/**
 * @vitest-environment jsdom
 */
/**
 * R16-004 — I CAMPI DEL BANNER DELLA VETRINA NON TAGLIANO PIÙ IN SILENZIO.
 *
 * Titolo (120), sottotitolo (200), testo alternativo della foto (160) e testo del pulsante (40)
 * avevano `maxLength`: il browser tagliava quello che si incollava oltre il tetto, senza dire niente.
 * Adesso il testo resta intero e sotto il campo compare l'errore, come negli altri campi brevi del
 * costruttore (lo schema li rifiuta comunque al salvataggio, `lib/store-site.ts`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/seller/site/ImageUpload', () => ({ SingleImageUpload: () => null }));
vi.mock('@/components/seller/site/CategorySelect', () => ({ default: () => null }));

import BannerFields from '@/components/seller/site/BannerFields';

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

async function disegna(config: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const section = { id: 'b1', type: 'banner', config: { imageUrl: '', overlay: 'dark', ...config } } as never;
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(BannerFields, { section, onChange: () => undefined })));
  });
  return radice;
}

/** Il controllo legato all'etichetta (Field lega label e campo con htmlFor/id). */
function campo(radice: HTMLElement, etichetta: string) {
  const label = [...radice.querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith(etichetta));
  expect(label, `controprova: l'etichetta «${etichetta}» c'è`).toBeTruthy();
  const el = document.getElementById(label!.htmlFor) as HTMLInputElement | HTMLTextAreaElement | null;
  expect(el, `controprova: il campo «${etichetta}» c'è`).toBeTruthy();
  return el!;
}

const CAMPI = [
  { etichetta: 'Titolo', tetto: 120, config: (v: string) => ({ heading: v }) },
  { etichetta: 'Sottotitolo', tetto: 200, config: (v: string) => ({ subheading: v }) },
  { etichetta: 'Testo alternativo della foto', tetto: 160, config: (v: string) => ({ alt: v }) },
  { etichetta: 'Testo del pulsante', tetto: 40, config: (v: string) => ({ cta: { label: v, target: { kind: 'external', url: 'https://esempio.it' } } }) },
];

describe('R16-004 — banner: oltre il tetto l\'errore si vede e il testo resta intero', () => {
  for (const { etichetta, tetto, config } of CAMPI) {
    it(`${etichetta} (${tetto})`, async () => {
      const lungo = 'x'.repeat(tetto + 5);
      const radice = await disegna(config(lungo));
      const el = campo(radice, etichetta);
      expect(el.getAttribute('maxlength'), `«${etichetta}» ha ancora maxLength: il browser taglia in silenzio`).toBeNull();
      expect(el.value, 'il testo resta intero').toHaveLength(tetto + 5);
      const errore = document.getElementById(`${el.id}-error`);
      expect(errore?.textContent ?? '', `«${etichetta}» oltre il tetto non dice niente`).toContain(`${tetto + 5} caratteri su ${tetto}`);
      expect(el.getAttribute('aria-invalid'), 'il campo è segnato come sbagliato').toBe('true');
    });

    it(`${etichetta}: controprova, al tetto nessun errore`, async () => {
      const radice = await disegna(config('x'.repeat(tetto)));
      const el = campo(radice, etichetta);
      expect(document.getElementById(`${el.id}-error`)).toBeNull();
    });
  }
});
