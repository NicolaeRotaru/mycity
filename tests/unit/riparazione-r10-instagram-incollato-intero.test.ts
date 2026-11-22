import { describe, it, expect } from 'vitest';
import { normalizzaSocials, storeCustomizationSchema, campoDellErrore } from '@/lib/store-customization';

/**
 * R10-010 — Il link di Instagram incollato intero (anche con la coda «?igsh=…» che l'app aggiunge)
 * e il sito senza https si accettano e si correggono da soli; un valore davvero sbagliato dà un
 * errore che dice quale campo.
 */
const salva = (socials: Record<string, string>) => {
  const n = normalizzaSocials(socials);
  return { n, r: storeCustomizationSchema.safeParse({ socials: n }) };
};

describe('R10-010 — link incollati e sito senza https', () => {
  it.each([
    'https://www.instagram.com/panequotidiano/',
    'https://www.instagram.com/panequotidiano?igsh=MWx4ZGZ4',
    'https://www.instagram.com/panequotidiano/?hl=it',
    'https://instagram.com/panequotidiano/?utm_source=ig_web_button_share_sheet',
    'instagram.com/panequotidiano',
    '@panequotidiano',
  ])('Instagram «%s» diventa panequotidiano e si salva', (url) => {
    const { n, r } = salva({ instagram: url });
    expect(n?.instagram).toBe('panequotidiano');
    expect(r.success).toBe(true);
  });

  it('anche TikTok e Facebook con la coda si riducono al nome', () => {
    expect(normalizzaSocials({ tiktok: 'https://www.tiktok.com/@panequotidiano?lang=it' })?.tiktok).toBe('panequotidiano');
    expect(normalizzaSocials({ facebook: 'https://www.facebook.com/panequotidiano?ref=bookmarks' })?.facebook).toBe('panequotidiano');
  });

  it('il sito senza https prende https e si salva', () => {
    for (const w of ['www.panequotidiano.it', 'panequotidiano.it/chi-siamo']) {
      const { n, r } = salva({ website: w });
      expect(n?.website).toBe(`https://${w}`);
      expect(r.success).toBe(true);
    }
  });

  it('un post di Instagram non è un profilo: resta com\'è e l\'errore nomina il campo', () => {
    const { n, r } = salva({ instagram: 'https://www.instagram.com/p/Cxyz123/?igsh=abc' });
    expect(n?.instagram).toBe('https://www.instagram.com/p/Cxyz123/?igsh=abc');
    expect(r.success).toBe(false);
    if (!r.success) expect(campoDellErrore(r.error.issues[0].path)).toBe('Instagram');
  });

  it('un valore sbagliato nel sito nomina «Sito web»', () => {
    const { r } = salva({ website: 'non è un indirizzo' });
    expect(r.success).toBe(false);
    if (!r.success) expect(campoDellErrore(r.error.issues[0].path)).toBe('Sito web');
  });

  // Dopo il nome sono ammessi solo «/», «?…», «#…» o la fine: il resto non è un nome.
  it.each([
    ['https://instagram.com/nome<script>?igsh=1', 'instagram'],
    ['https://instagram.com/nome<script>', 'instagram'],
    ['https://www.instagram.com/caffè?igsh=1', 'instagram'],
    ['https://www.instagram.com/caffè', 'instagram'],
    ['https://www.tiktok.com/@nome<b>?lang=it', 'tiktok'],
    ['https://www.facebook.com/nome"x?ref=1', 'facebook'],
  ])('«%s» non diventa un nome: resta com\'è e il controllo lo ferma', (url, campo) => {
    const { n, r } = salva({ [campo]: url });
    expect((n as Record<string, string>)[campo]).toBe(url);
    expect(r.success).toBe(false);
  });

  it.each([
    'https://instagram.com/nome?igsh=1',
    'https://instagram.com/nome/?hl=it',
    'https://instagram.com/nome#top',
    'https://instagram.com/nome/',
    'https://instagram.com/nome',
  ])('«%s» si salva come «nome»', (url) => {
    const { n, r } = salva({ instagram: url });
    expect(n?.instagram).toBe('nome');
    expect(r.success).toBe(true);
  });

  it.each([
    'https://www.instagram.com/explore/tags/pane/',
    'https://www.instagram.com/explore',
    'https://www.instagram.com/direct/inbox/',
    'https://www.instagram.com/accounts/login/',
    'https://www.instagram.com/tv/Cxyz123/',
    'https://www.tiktok.com/t/ZTRabc/',
    'https://www.tiktok.com/tag/pane',
    'https://www.tiktok.com/discover',
  ])('«%s» non è un profilo: resta com\'è e il controllo lo ferma', (url) => {
    const campo = url.includes('tiktok') ? 'tiktok' : 'instagram';
    const { n, r } = salva({ [campo]: url });
    expect((n as Record<string, string>)[campo]).toBe(url);
    expect(r.success).toBe(false);
    if (!r.success) expect(campoDellErrore(r.error.issues[0].path)).toBe(campo === 'tiktok' ? 'TikTok' : 'Instagram');
  });
});
