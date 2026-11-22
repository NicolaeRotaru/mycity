import { describe, it, expect } from 'vitest';
import { normalizzaSocials, storeCustomizationSchema, campoDellErrore } from '@/lib/store-customization';

/**
 * R10-014 — Un link di Facebook che non è quello di un profilo (persone, eventi, foto, gruppi,
 * pagine, condivisioni, watch, marketplace…) non diventa il «nome profilo»: resta com'è e il
 * controllo lo ferma, dicendo che il campo è Facebook.
 */
const fb = (url: string) => normalizzaSocials({ facebook: url })?.facebook;

describe('R10-014 — i percorsi di Facebook che non sono un profilo', () => {
  const NON_PROFILO = [
    'https://www.facebook.com/people/Pane-Quotidiano/100012345678901/',
    'https://www.facebook.com/people/Pane-Quotidiano/100012345678901/?mibextid=ZbWKwL',
    'https://www.facebook.com/profile.php?id=100012345678901',
    'https://www.facebook.com/groups/panelocale',
    'https://www.facebook.com/pages/Pane-Quotidiano/123456',
    'https://www.facebook.com/share/1AbCdEf/',
    'https://www.facebook.com/watch',
    'https://www.facebook.com/watch/?v=123',
    'https://www.facebook.com/events/123456789',
    'https://www.facebook.com/photo/?fbid=123',
    'https://www.facebook.com/photo.php?fbid=123',
    'https://www.facebook.com/marketplace/item/123',
    'https://www.facebook.com/hashtag/panefresco',
    'https://www.facebook.com/stories/123',
    'https://www.facebook.com/sharer/sharer.php?u=x',
    'https://www.facebook.com/fundraisers/123',
    'https://www.facebook.com/live',
    'https://www.facebook.com/reviews/?id=1',
    'https://www.facebook.com/lite/',
    'https://m.facebook.com/live/producer/1',
  ];
  it.each(NON_PROFILO)('%s resta com\'è, non diventa il nome', (url) => {
    expect(fb(url)).toBe(url);
  });

  it.each(NON_PROFILO)('%s è fermato dal controllo, e l\'errore nomina Facebook', (url) => {
    const r = storeCustomizationSchema.safeParse({ socials: { facebook: fb(url) } });
    expect(r.success).toBe(false);
    if (!r.success) expect(campoDellErrore(r.error.issues[0].path)).toBe('Facebook');
  });

  it('i profili veri si riducono ancora al nome', () => {
    expect(fb('https://www.facebook.com/panequotidiano')).toBe('panequotidiano');
    expect(fb('https://m.facebook.com/pane.quotidiano/')).toBe('pane.quotidiano');
    expect(fb('https://fb.com/pane-quotidiano/posts/1')).toBe('pane-quotidiano');
    expect(fb('@panequotidiano')).toBe('panequotidiano');
  });
});
