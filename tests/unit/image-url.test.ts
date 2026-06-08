import { describe, it, expect } from 'vitest';
import { sizedImage } from '@/lib/image-url';

/**
 * Unit test per lib/image-url: ottimizzazione URL immagini.
 *
 * Esperti: Performance: "Senza resize lato CDN, mobile users scaricano 2MB
 * per ogni card prodotto = pagina 30+ MB. Test che la trasformazione URL
 * sia robusta — un bug qui ti uccide il LCP."
 */

describe('sizedImage - empty/invalid input', () => {
  it('returns empty string for null/undefined', () => {
    expect(sizedImage(null, 'card')).toBe('');
    expect(sizedImage(undefined, 'card')).toBe('');
    expect(sizedImage('', 'card')).toBe('');
  });

  it('returns data: URL unchanged', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
    expect(sizedImage(dataUri, 'card')).toBe(dataUri);
  });

  it('returns blob: URL unchanged', () => {
    const blobUrl = 'blob:https://example.com/abc-123';
    expect(sizedImage(blobUrl, 'card')).toBe(blobUrl);
  });

  it('returns malformed URL unchanged', () => {
    expect(sizedImage('not a url', 'card')).toBe('not a url');
  });
});

describe('sizedImage - Pexels URLs', () => {
  it('adds w/h/auto params for card size', () => {
    const url = sizedImage('https://images.pexels.com/photos/123/photo.jpg', 'card');
    expect(url).toContain('w=400');
    expect(url).toContain('h=400');
    expect(url).toContain('auto=compress');
    expect(url).toContain('cs=tinysrgb');
    expect(url).toContain('fit=crop');
  });

  it('uses thumb=100 for thumb size', () => {
    const url = sizedImage('https://images.pexels.com/photos/123/photo.jpg', 'thumb');
    expect(url).toContain('w=100');
    expect(url).toContain('h=100');
  });

  it('uses hero=1200 for hero size', () => {
    const url = sizedImage('https://images.pexels.com/photos/123/photo.jpg', 'hero');
    expect(url).toContain('w=1200');
    expect(url).toContain('h=1200');
  });

  it('preserves existing query string', () => {
    const url = sizedImage('https://images.pexels.com/photos/123/photo.jpg?existing=param', 'card');
    expect(url).toContain('existing=param');
    expect(url).toContain('w=400');
  });
});

describe('sizedImage - Supabase Storage URLs', () => {
  it('rewrites /object/public/ to /render/image/public/', () => {
    const src = 'https://abc123.supabase.co/storage/v1/object/public/products/img.jpg';
    const url = sizedImage(src, 'card');
    expect(url).toContain('/render/image/public/');
    expect(url).not.toContain('/object/public/');
  });

  it('adds width and quality query params', () => {
    const src = 'https://abc.supabase.co/storage/v1/object/public/products/img.jpg';
    const url = sizedImage(src, 'detail');
    expect(url).toContain('width=800');
    expect(url).toContain('quality=75');
    expect(url).toContain('resize=cover');
  });

  it('handles thumb size', () => {
    const src = 'https://abc.supabase.co/storage/v1/object/public/avatars/a.jpg';
    const url = sizedImage(src, 'thumb');
    expect(url).toContain('width=100');
  });

  it('crops to a square (width+height) for grid sizes thumb/card', () => {
    const src = 'https://abc.supabase.co/storage/v1/object/public/products/img.jpg';
    expect(sizedImage(src, 'thumb')).toContain('height=100');
    expect(sizedImage(src, 'card')).toContain('height=400');
  });

  it('preserves aspect ratio (width only, no height) for detail/hero', () => {
    const src = 'https://abc.supabase.co/storage/v1/object/public/products/img.jpg';
    expect(sizedImage(src, 'detail')).not.toContain('height=');
    expect(sizedImage(src, 'hero')).not.toContain('height=');
  });
});

describe('sizedImage - other hosts', () => {
  it('leaves placehold.co URLs unchanged', () => {
    const src = 'https://placehold.co/400x400/png?text=Test';
    expect(sizedImage(src, 'card')).toBe(src);
  });

  it('leaves random hosts unchanged', () => {
    const src = 'https://example.com/image.jpg';
    expect(sizedImage(src, 'card')).toBe(src);
  });

  it('leaves dicebear avatars unchanged', () => {
    const src = 'https://api.dicebear.com/7.x/initials/svg?seed=Mario';
    expect(sizedImage(src, 'thumb')).toBe(src);
  });
});
