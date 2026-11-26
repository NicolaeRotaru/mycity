import { describe, it, expect } from 'vitest';
import { normalizzaSocials, storeCustomizationSchema } from '@/lib/store-customization';

const fb = (url: string) => normalizzaSocials({ facebook: url })?.facebook;

describe('R21-015: altri percorsi di servizio di Facebook non diventano il nome del profilo', () => {
  const SERVIZIO = [
    'apps', 'flx', 'groupsbrowse', 'sharing', 'welcome', 'touch', 'zero', 'mobile', 'm', 'commerce', 'shops',
    'workplace', 'oculus', 'fbwatch', 'newsroom',
  ];
  it.each(SERVIZIO)('facebook.com/%s resta com\'è ed è fermato', (p) => {
    const url = `https://www.facebook.com/${p}`;
    expect(fb(url)).toBe(url);
    expect(storeCustomizationSchema.safeParse({ socials: { facebook: fb(url) } }).success).toBe(false);
  });
  it.each(['people', 'pages', 'groups', 'watch', 'events', 'marketplace', 'gaming', 'stories', 'sharer', 'photos', 'hashtag', 'search', 'dialog', 'plugins', 'home.php'])(
    'quelli già elencati restano fermati: %s',
    (p) => {
      const url = `https://facebook.com/${p}`;
      expect(fb(url)).toBe(url);
    },
  );
  it('i nomi veri restano nomi', () => {
    for (const n of ['panequotidiano', 'pane.quotidiano', 'forno2000']) expect(fb(`https://www.facebook.com/${n}`)).toBe(n);
  });
});
