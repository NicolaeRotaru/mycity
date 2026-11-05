/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { resizeImageToBase64 } from '@/lib/image-resize';

/** S06 · 315 — Un PNG trasparente ridimensionato in JPEG esce su bianco, non su nero. */
describe('315 — PNG trasparente', () => {
  it('il canvas si riempie di bianco prima di disegnare', async () => {
    const chiamate: string[] = [];
    const ctx = {
      set fillStyle(v: string) { chiamate.push(`fillStyle:${v}`); },
      fillRect: () => chiamate.push('fillRect'),
      drawImage: () => chiamate.push('drawImage'),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA');
    class FintaImmagine {
      width = 100; height = 100; onload: () => void = () => {}; onerror: () => void = () => {};
      set src(_v: string) { setTimeout(() => this.onload(), 0); }
    }
    vi.stubGlobal('Image', FintaImmagine);
    await resizeImageToBase64(new Blob(['x'], { type: 'image/png' }), 50);
    expect(chiamate).toEqual(['fillStyle:#ffffff', 'fillRect', 'drawImage']);
    vi.unstubAllGlobals();
  });
});
