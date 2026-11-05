import { describe, it, expect } from 'vitest';
import { sizedImage } from '@/lib/image-url';

/** S06 · 933 — Sulle foto Pexels il ritaglio quadrato vale solo per miniature e schede. */
describe('933 — Pexels nelle viste grandi', () => {
  const foto = 'https://images.pexels.com/photos/123/photo.jpg';
  it('detail e hero: niente altezza né fit=crop', () => {
    for (const nome of ['detail', 'hero'] as const) {
      const u = new URL(sizedImage(foto, nome));
      expect(u.searchParams.get('h'), nome).toBeNull();
      expect(u.searchParams.get('fit'), nome).toBeNull();
    }
  });
  it('card e thumb restano quadrate', () => {
    expect(new URL(sizedImage(foto, 'card')).searchParams.get('h')).toBe('400');
    expect(new URL(sizedImage(foto, 'thumb')).searchParams.get('fit')).toBe('crop');
  });
});
