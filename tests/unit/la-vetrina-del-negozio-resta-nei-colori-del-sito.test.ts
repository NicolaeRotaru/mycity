import { describe, it, expect } from 'vitest';
import { contrasto } from './aiuti/contrasto';
import { COLORI_DEL_SITO, colore } from './aiuti/tavolozza-del-sito';
import {
  ACCENT_PRESETS,
  ACCENT_RITIRATI,
  DEFAULT_ACCENT,
  accentHex,
  normalizeCustomization,
} from '@/lib/store-customization';

/**
 * 3/9/2026 — LA VETRINA DEL NEGOZIO POTEVA DIVENTARE VERDE-ACQUA, BLU, PRUGNA O
 * MARRONE: QUATTRO COLORI CHE NEL SITO NON ESISTONO.
 *
 * Il venditore sceglie il colore della sua vetrina da otto pastiglie. Quattro
 * erano token veri del design (terracotta, bordeaux, senape, oliva); le altre
 * quattro — Salvia #2F6F6A, Notte #3B4A7A, Prugna #6B3A5B, Cacao #5C4033 — non
 * comparivano da nessuna parte: né in `tailwind.config.ts`, né in
 * `app/globals.css`, né nei token del mockup. Erano tinte scritte a mano dentro
 * l'elenco.
 *
 * E non sono decorative: quel colore viene applicato inline come sfondo del
 * pulsante della vetrina, come striscia sopra la copertina e come colore delle
 * icone «Dove siamo». Un negozio su «Notte» aveva pulsanti indaco dentro una
 * pagina con la barra terracotta e il piede panna.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────
 * Legge le rampe di colore da `tailwind.config.ts` — l'unico posto dove il
 * design del sito è dichiarato — ed ESEGUE la validazione vera e il calcolo
 * dell'accent. Tre reti:
 *   ① ogni pastiglia offerta al venditore è un tono della tavolozza;
 *   ② ci si legge sopra il testo bianco del pulsante (4,5:1, WCAG 1.4.3 AA);
 *   ③ un negozio che aveva scelto uno dei colori ritirati non perde il resto
 *      della sua vetrina — motto, social, badge, prodotti in evidenza.
 *
 * La ③ è la trappola vera: la validazione è tutto-o-niente, e un colore non più
 * ammesso faceva fallire l'intero oggetto, che tornava vuoto.
 *
 * ⚪ Da qui non apro la vetrina di un negozio vero: verifico il colore che il
 * codice sceglie, non come lo rende il telefono di chi guarda.
 */

describe('le pastiglie offerte al venditore', () => {
  it('sono otto, e nessuna è inventata: ognuna è un tono della tavolozza', () => {
    const fuori = ACCENT_PRESETS.filter((p) => !COLORI_DEL_SITO.has(p.hex.toUpperCase()));
    expect(
      fuori.map((p) => `${p.label} ${p.hex}`),
      'colori che il venditore può scegliere e che nel sito non esistono',
    ).toEqual([]);
    expect(ACCENT_PRESETS.length).toBe(8);
  });

  it('hanno chiavi e etichette tutte diverse (una pastiglia che si ripete è una scelta persa)', () => {
    expect(new Set(ACCENT_PRESETS.map((p) => p.key)).size).toBe(ACCENT_PRESETS.length);
    expect(new Set(ACCENT_PRESETS.map((p) => p.hex)).size).toBe(ACCENT_PRESETS.length);
  });

  it('ci si legge sopra il testo bianco del pulsante della vetrina', () => {
    // BannerSection dipinge il pulsante con `backgroundColor: accent` e
    // `color: '#fff'`: è testo normale, quindi la soglia è 4,5:1.
    for (const p of ACCENT_PRESETS) {
      expect(
        contrasto('#FFFFFF', p.hex),
        `«${p.label}» ${p.hex}: sul pulsante il testo bianco non si legge`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('il colore di partenza è la terracotta del marchio', () => {
    expect(DEFAULT_ACCENT).toBe(colore('primary-600'));
  });
});

describe('chi aveva scelto uno dei colori ritirati', () => {
  const VETRINA_PIENA = {
    theme: { accent: '#3B4A7A', coverStyle: 'colli' }, // «Notte», ritirato
    tagline: 'Pane cotto a legna dal 1954',
    socials: { instagram: '@paneQuotidiano', whatsapp: '+39 0523 123456' },
    badges: ['produzione_propria', 'tradizione'],
    featuredProductIds: ['11111111-1111-4111-8111-111111111111'],
  };

  it('non perde il resto della vetrina: motto, social, badge e prodotti restano', () => {
    const c = normalizeCustomization(VETRINA_PIENA);
    expect(c.tagline, 'il motto del negozio è sparito insieme al colore').toBe('Pane cotto a legna dal 1954');
    expect(c.badges).toEqual(['produzione_propria', 'tradizione']);
    expect(c.socials?.instagram).toBe('@paneQuotidiano');
    expect(c.featuredProductIds).toHaveLength(1);
    expect(c.theme?.coverStyle).toBe('colli');
  });

  it('il colore diventa il sostituto dichiarato, non il terracotta di tutti', () => {
    expect(normalizeCustomization(VETRINA_PIENA).theme?.accent).toBe(ACCENT_RITIRATI['#3B4A7A']);
    for (const [vecchio, nuovo] of Object.entries(ACCENT_RITIRATI)) {
      expect(accentHex({ theme: { accent: vecchio } }), `il ritirato ${vecchio}`).toBe(nuovo);
    }
  });

  it('ogni sostituto è a sua volta una pastiglia offerta oggi', () => {
    const offerti = new Set<string>(ACCENT_PRESETS.map((p) => p.hex));
    for (const [vecchio, nuovo] of Object.entries(ACCENT_RITIRATI)) {
      expect(offerti.has(nuovo), `${vecchio} rimanda a ${nuovo}, che non è più fra le scelte`).toBe(true);
    }
  });

  it('un colore davvero inventato resta rifiutato: qui non si ammorbidisce niente', () => {
    expect(normalizeCustomization({ theme: { accent: '#123456' }, tagline: 'x' })).toEqual({});
    expect(accentHex({ theme: { accent: '#123456' } })).toBe(DEFAULT_ACCENT);
  });
});
