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

/**
 * Collaudo K04: l'elenco non chiudeva la classe. «home.php», «/notes/x», «/recover/initiate»,
 * «/places/x» si salvavano come nome; e lo stesso elenco fermava profili veri di Instagram e TikTok
 * chiamati «live», «help», «business»…
 */
describe('R10-014 — la classe dei percorsi che non sono un profilo, non solo un elenco', () => {
  const ALTRI_NON_PROFILO = [
    'https://www.facebook.com/home.php',
    'https://www.facebook.com/notes/pane/123',
    'https://www.facebook.com/recover/initiate',
    'https://www.facebook.com/places/Piacenza',
    'https://www.facebook.com/qualcosa.php?x=1',
    'https://www.facebook.com/panequotidiano/qualcosa-di-strano',
  ];
  it.each(ALTRI_NON_PROFILO)('%s resta com\'è ed è fermato con l\'errore su Facebook', (url) => {
    expect(fb(url)).toBe(url);
    const r = storeCustomizationSchema.safeParse({ socials: { facebook: fb(url) } });
    expect(r.success).toBe(false);
    if (!r.success) expect(campoDellErrore(r.error.issues[0].path)).toBe('Facebook');
  });

  it('le sottopagine di un profilo vero tengono il nome', () => {
    expect(fb('https://www.facebook.com/panequotidiano/photos/?ref=page')).toBe('panequotidiano');
    expect(fb('https://www.facebook.com/nome.cognome?mibextid=ZbWKwL')).toBe('nome.cognome');
    expect(fb('https://m.facebook.com/panequotidiano/about/')).toBe('panequotidiano');
  });

  const ig = (url: string) => normalizzaSocials({ instagram: url })?.instagram;
  const tk = (url: string) => normalizzaSocials({ tiktok: url })?.tiktok;
  it.each(['live', 'help', 'business', 'media', 'search', 'public'])(
    'un profilo Instagram vero chiamato «%s» si salva col suo nome',
    (nome) => {
      expect(ig(`https://www.instagram.com/${nome}/`)).toBe(nome);
    },
  );
  it.each(['help', 'business', 'media', 'public'])('un profilo TikTok vero chiamato «%s» si salva', (nome) => {
    expect(tk(`https://www.tiktok.com/@${nome}`)).toBe(nome);
  });
  it('i percorsi di Instagram e TikTok che non sono un profilo restano fermati', () => {
    expect(ig('https://www.instagram.com/explore/tags/pane/')).toBe('https://www.instagram.com/explore/tags/pane/');
    expect(tk('https://www.tiktok.com/tag/pane')).toBe('https://www.tiktok.com/tag/pane');
  });
});
