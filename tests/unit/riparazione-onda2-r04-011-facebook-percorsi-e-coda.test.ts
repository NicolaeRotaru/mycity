import { describe, it, expect } from 'vitest';
import { normalizzaSocials, storeCustomizationSchema } from '@/lib/store-customization';

/**
 * R04-011 (onda 2, 28/11/2026) — ALTRI PERCORSI DI FACEBOOK NON DIVENTANO IL NOME DEL PROFILO.
 *
 * Incollando «facebook.com/accountscenter» o il link di un post («facebook.com/qualcosa?story_fbid=…»)
 * il sito teneva «accountscenter» / «qualcosa» come nome della pagina, e in vetrina il pulsante
 * Facebook portava altrove. Due rimedi: altri percorsi di servizio nell'elenco, e la coda del link
 * (un post, una foto, un video la portano; il link di un profilo no). Un percorso di una parola
 * sconosciuto e senza coda resta indistinguibile da un nome vero: è il limite che resta.
 */
const fb = (url: string) => normalizzaSocials({ facebook: url })?.facebook;
const rifiutato = (v: string | undefined) => storeCustomizationSchema.safeParse({ socials: { facebook: v } }).success === false;

describe('R04-011 · percorsi di servizio e link di contenuti non sono il nome della pagina', () => {
  it.each([
    'accountscenter', 'reg', 'campaign', 'brandedcontent', 'formedia', 'facebookmedia', 'votinginformationcenter',
    'climatescience', 'pagesmanager', 'qr', 'codegen', 'subscriptions', 'privacycenter', 'professionaldashboard',
  ])('IL CASO CHE ROMPEVA — facebook.com/%s resta com\'è e il controllo lo ferma', (p) => {
    const url = `https://www.facebook.com/${p}`;
    expect(fb(url), `«${p}» è stato salvato come nome della pagina`).toBe(url);
    expect(rifiutato(fb(url))).toBe(true);
  });

  it.each([
    'https://www.facebook.com/panequotidiano?story_fbid=123456&id=100000',
    'https://facebook.com/qualcosadinuovo?fbid=987654321',
    'https://m.facebook.com/novitavideo?v=1234567890',
    'https://www.facebook.com/albumnuovo?set=a.12345',
  ])('IL CASO CHE ROMPEVA — il link di un contenuto (%s) non diventa un nome', (url) => {
    expect(fb(url), 'la coda dice che è un post, una foto o un video, non la pagina').toBe(url);
    expect(rifiutato(fb(url))).toBe(true);
  });

  it('controprova: i link veri di una pagina, anche con la coda dell\'app, restano il nome', () => {
    expect(fb('https://www.facebook.com/panequotidiano')).toBe('panequotidiano');
    expect(fb('https://www.facebook.com/panequotidiano?mibextid=ZbWKwL')).toBe('panequotidiano');
    expect(fb('https://www.facebook.com/pane.quotidiano/?ref=page_internal')).toBe('pane.quotidiano');
    expect(fb('https://www.facebook.com/forno2000/posts/123')).toBe('forno2000');
    expect(fb('panequotidiano')).toBe('panequotidiano');
    expect(rifiutato(fb('https://www.facebook.com/panequotidiano?sk=about'))).toBe(false);
  });
});
