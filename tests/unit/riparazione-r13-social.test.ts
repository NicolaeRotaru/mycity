import { describe, it, expect } from 'vitest';
import { normalizzaSocials, storeCustomizationSchema, campoDellErrore } from '@/lib/store-customization';

const fb = (url: string) => normalizzaSocials({ facebook: url })?.facebook;

describe('R13-005 — le sottopagine vere di un profilo Facebook tengono il nome', () => {
  it.each(['timeline', 'info', 'photos_by', 'photos_of', 'photos_albums', 'videos_by', 'about_details', 'likes', 'following'])(
    'facebook.com/nome/%s si riduce a «nome»',
    (sotto) => {
      expect(fb(`https://www.facebook.com/panequotidiano/${sotto}`)).toBe('panequotidiano');
      expect(fb(`https://m.facebook.com/pane.quotidiano/${sotto}/?ref=x`)).toBe('pane.quotidiano');
      expect(storeCustomizationSchema.safeParse({ socials: { facebook: fb(`https://facebook.com/nome/${sotto}`) } }).success).toBe(true);
    },
  );
  it('una sottopagina inventata resta fermata', () => {
    expect(fb('https://www.facebook.com/panequotidiano/qualcosa-di-strano')).toBe('https://www.facebook.com/panequotidiano/qualcosa-di-strano');
  });
});
