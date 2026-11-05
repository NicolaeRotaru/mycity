/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';

/**
 * S06 — Le foto del prodotto nel modulo del negozio.
 *
 * 245: «Sfondo bianco» chiama un servizio a pagamento: segue l'interruttore degli
 *      strumenti AI dei negozi, nella rotta e nel campo foto.
 * 304: due caricamenti uno dopo l'altro non si cancellano le foto, e il modulo
 *      resta «in caricamento» finché non sono finiti tutti e due.
 * 238: i comandi sotto le foto sono grandi almeno 44 punti.
 */

const getBgRemovalProvider = vi.fn(() => ({ removeBackground: vi.fn() }));
vi.mock('@/lib/bg-removal', () => ({ getBgRemovalProvider }));
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: async () => ({ allowed: true }) }));
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
      h({ user: { id: 'u1' }, req }),
}));

type Rilascio = (urls: string[]) => void;
const rilasci: Rilascio[] = [];
vi.mock('@/lib/products/uploadImages', () => ({
  fotoTroppoPiccole: async () => [],
  uploadProductImages: () => new Promise<string[]>((res) => { rilasci.push(res); }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/seller/CameraCapture', () => ({
  default: ({ onCapture }: { onCapture: (f: File) => void }) =>
    createElement('button', {
      type: 'button',
      'data-scatta': '1',
      onClick: () => onCapture(new File(['x'], 'x.jpg', { type: 'image/jpeg' })),
    }, 'scatta'),
}));
vi.mock('@/components/seller/BackgroundRemovalPreview', () => ({ default: () => null }));
vi.mock('@/components/ui/LoadingState', () => ({ LoadingState: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('245 — «Sfondo bianco» spento finché gli strumenti AI dei negozi sono spenti', () => {
  it('la rotta risponde 503 prima di cercare il fornitore', async () => {
    const { POST } = await import('@/app/api/image/remove-bg/route');
    const req = new Request('http://x/api/image/remove-bg', {
      method: 'POST',
      body: JSON.stringify({ image_base64: 'AAAA', media_type: 'image/png' }),
    });
    const res = await (POST as unknown as (r: Request) => Promise<Response>)(req);
    expect(res.status).toBe(503);
    expect(getBgRemovalProvider).not.toHaveBeenCalled();
  });

  it('il campo foto non mostra il pulsante per impostazione, e lo mostra solo se acceso', async () => {
    const { default: ProductImagesField } = await import('@/components/seller/ProductImagesField');
    const div = document.createElement('div');
    const root = createRoot(div);
    await act(async () => {
      root.render(createElement(ProductImagesField, { value: ['https://x/a.jpg'], onChange: () => {} }));
    });
    expect(div.textContent).not.toContain('Sfondo bianco');
    await act(async () => {
      root.render(createElement(ProductImagesField, {
        value: ['https://x/a.jpg'], onChange: () => {}, sfondoBiancoAcceso: true,
      }));
    });
    expect(div.textContent).toContain('Sfondo bianco');
    root.unmount();
  });

  it('il modulo prodotto passa l\'interruttore al campo foto', () => {
    const src = readFileSync('components/seller/ProductForm.tsx', 'utf8');
    expect(src).toMatch(/sfondoBiancoAcceso=\{aiAccesa\}/);
  });
});

describe('304 — due caricamenti di fila', () => {
  beforeEach(() => { rilasci.length = 0; });

  it('le foto del primo restano quando finisce il secondo, e il caricamento finisce solo alla fine', async () => {
    const { default: ProductImagesField } = await import('@/components/seller/ProductImagesField');
    const stati: boolean[] = [];
    let ultime: string[] = [];
    function Contenitore() {
      const [v, setV] = useState<string[]>([]);
      ultime = v;
      return createElement(ProductImagesField, {
        value: v, onChange: setV, onUploadingChange: (b: boolean) => stati.push(b),
      });
    }
    const div = document.createElement('div');
    const root = createRoot(div);
    await act(async () => { root.render(createElement(Contenitore)); });
    const scatta = div.querySelector('[data-scatta]') as HTMLButtonElement;
    await act(async () => { scatta.click(); });
    await act(async () => { scatta.click(); });
    expect(rilasci).toHaveLength(2);
    await act(async () => { rilasci[0](['https://x/1.jpg']); });
    expect(stati[stati.length - 1]).toBe(true);
    await act(async () => { rilasci[1](['https://x/2.jpg']); });
    expect(ultime).toEqual(['https://x/1.jpg', 'https://x/2.jpg']);
    expect(stati[stati.length - 1]).toBe(false);
    root.unmount();
  });
});

describe('238 — comandi delle foto a misura di dito', () => {
  it('frecce, copertina e × sono almeno 40-44 punti', () => {
    const src = readFileSync('components/seller/ProductImagesField.tsx', 'utf8');
    expect(src.match(/h-11 w-11/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(src).toContain('w-10 h-10');
    expect(src).not.toContain('w-6 h-6');
    expect(src).not.toMatch(/rounded p-1 text-ink-500/);
  });
});
