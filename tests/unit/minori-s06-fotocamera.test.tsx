/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { avvisoScartatiDalleFoto } from '@/lib/products/prontoPerLaVendita';

/**
 * S06 — Fotocamera e bozze dalle foto.
 * 98:   chiusa mentre si accende, la fotocamera si spegne quando lo stream arriva.
 * 1683: dopo «Crea bozze» si dice quali prodotti non sono entrati e perché.
 */
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children }: { open: boolean; children: unknown }) => (open ? createElement('div', null, children as never) : null),
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function fintoStream() {
  const traccia = { stop: vi.fn() };
  return { traccia, stream: { getTracks: () => [traccia] } as unknown as MediaStream };
}

async function chiudiPrimaDelloStream(file: string, props: Record<string, unknown>) {
  const { traccia, stream } = fintoStream();
  let rilascia: (s: MediaStream) => void = () => {};
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => new Promise<MediaStream>((r) => { rilascia = r; }) },
  });
  (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class { detect = async () => []; };
  const mod = await import(/* @vite-ignore */ file);
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => { root.render(createElement(mod.default, { open: true, onClose: () => {}, ...props })); });
  await act(async () => { root.render(createElement(mod.default, { open: false, onClose: () => {}, ...props })); });
  await act(async () => { rilascia(stream); await Promise.resolve(); });
  root.unmount();
  return traccia;
}

describe('98 — la fotocamera non resta accesa', () => {
  it('CameraCapture: lo stream arrivato dopo la chiusura si spegne', async () => {
    const t = await chiudiPrimaDelloStream('@/components/seller/CameraCapture', { onCapture: () => {} });
    expect(t.stop).toHaveBeenCalled();
  });
  it('BarcodeScanner: lo stesso', async () => {
    const t = await chiudiPrimaDelloStream('@/components/seller/BarcodeScanner', { onDetected: () => {} });
    expect(t.stop).toHaveBeenCalled();
  });
  it('«Cambia» è spento finché la fotocamera non è pronta', () => {
    expect(readFileSync('components/seller/CameraCapture.tsx', 'utf8')).toMatch(/onClick=\{switchCamera\}\s+disabled=\{!ready\}/);
  });
});

describe('1683 — bozze dalle foto saltate', () => {
  it('nome e motivo di chi non è entrato', () => {
    expect(avvisoScartatiDalleFoto([{ nome: 'Focaccia', motivo: 'controllo non disponibile in questo momento: riprova fra poco' }]))
      .toBe('Non è entrato «Focaccia»: controllo non disponibile in questo momento: riprova fra poco.');
    expect(avvisoScartatiDalleFoto([])).toBeNull();
    expect(avvisoScartatiDalleFoto(undefined)).toBeNull();
  });
  it('il pannello lo mostra', () => {
    expect(readFileSync('components/seller/BulkPhotoCreate.tsx', 'utf8')).toContain('avvisoScartatiDalleFoto(data.scartati)');
  });
});
