import { describe, it, expect } from 'vitest';
import {
  normalizeCustomization,
  accentHex,
  coverClassName,
  announcementActive,
  socialLinks,
  badgeLabel,
  DEFAULT_ACCENT,
  ACCENT_PRESETS,
  COVER_PRESETS,
} from '@/lib/store-customization';

/**
 * Unit test per lib/store-customization: parsing difensivo, fallback on-brand,
 * stato annuncio (scadenza), costruzione link social, label badge.
 */

const at = (iso: string) => new Date(iso);

describe('normalizeCustomization', () => {
  it('returns {} for null/garbage/non-object', () => {
    expect(normalizeCustomization(null)).toEqual({});
    expect(normalizeCustomization(undefined)).toEqual({});
    expect(normalizeCustomization(42)).toEqual({});
    expect(normalizeCustomization('nope')).toEqual({});
  });

  it('keeps a valid partial object', () => {
    const c = normalizeCustomization({ theme: { accent: DEFAULT_ACCENT }, tagline: 'Pane fresco' });
    expect(c.theme?.accent).toBe(DEFAULT_ACCENT);
    expect(c.tagline).toBe('Pane fresco');
  });

  it('rejects invalid accent (curated palette) -> {}', () => {
    expect(normalizeCustomization({ theme: { accent: 'red' } })).toEqual({});
    expect(normalizeCustomization({ theme: { accent: '#FFFFFF' } })).toEqual({});
  });

  it('rejects too-long tagline and unknown badge -> {}', () => {
    expect(normalizeCustomization({ tagline: 'x'.repeat(200) })).toEqual({});
    expect(normalizeCustomization({ badges: ['produzione_propria', 'bogus'] })).toEqual({});
  });

  it('accepts a fully populated valid object', () => {
    const input = {
      theme: { accent: ACCENT_PRESETS[1].hex, coverStyle: COVER_PRESETS[2].key },
      tagline: 'Dal 1962',
      socials: { instagram: '@panificio', website: 'https://rossi.it' },
      announcement: { enabled: true, text: 'Chiusi per ferie' },
      badges: ['bio', 'artigianale'],
    };
    const c = normalizeCustomization(input);
    expect(c.theme?.coverStyle).toBe(COVER_PRESETS[2].key);
    expect(c.socials?.instagram).toBe('@panificio');
    expect(c.badges).toEqual(['bio', 'artigianale']);
  });
});

describe('accentHex', () => {
  it('falls back to brand default when missing/invalid', () => {
    expect(accentHex(undefined)).toBe(DEFAULT_ACCENT);
    expect(accentHex({})).toBe(DEFAULT_ACCENT);
    expect(accentHex({ theme: { accent: 'nope' } })).toBe(DEFAULT_ACCENT);
  });

  it('returns the chosen preset hex', () => {
    expect(accentHex({ theme: { accent: ACCENT_PRESETS[3].hex } })).toBe(ACCENT_PRESETS[3].hex);
  });
});

describe('coverClassName', () => {
  it('falls back to first on-brand preset', () => {
    expect(coverClassName(undefined)).toBe(COVER_PRESETS[0].className);
    expect(coverClassName({ theme: { coverStyle: 'inesistente' } })).toBe(COVER_PRESETS[0].className);
  });

  it('returns the className of the chosen preset', () => {
    expect(coverClassName({ theme: { coverStyle: COVER_PRESETS[4].key } })).toBe(COVER_PRESETS[4].className);
  });

  it('never returns a purple/pink gradient', () => {
    for (const p of COVER_PRESETS) {
      expect(p.className).not.toMatch(/purple|pink|fuchsia|violet/);
    }
  });
});

describe('announcementActive', () => {
  const now = at('2026-05-29T12:00:00');

  it('false when disabled or empty text', () => {
    expect(announcementActive(undefined, now)).toBe(false);
    expect(announcementActive({ announcement: { enabled: false, text: 'x' } }, now)).toBe(false);
    expect(announcementActive({ announcement: { enabled: true, text: '   ' } }, now)).toBe(false);
  });

  it('true when enabled with text and no expiry', () => {
    expect(announcementActive({ announcement: { enabled: true, text: 'Novità!' } }, now)).toBe(true);
  });

  it('respects the until expiry date', () => {
    expect(announcementActive({ announcement: { enabled: true, text: 'x', until: '2026-06-30' } }, now)).toBe(true);
    expect(announcementActive({ announcement: { enabled: true, text: 'x', until: '2026-05-29' } }, now)).toBe(true); // expires end of day
    expect(announcementActive({ announcement: { enabled: true, text: 'x', until: '2026-05-28' } }, now)).toBe(false);
  });
});

describe('socialLinks', () => {
  it('builds absolute hrefs and strips @', () => {
    const links = socialLinks({
      socials: { instagram: '@negozio', facebook: 'pagina', tiktok: '@tok', whatsapp: '+39 333 1234567', website: 'https://sito.it' },
    });
    const byKey = Object.fromEntries(links.map((l) => [l.key, l.href]));
    expect(byKey.instagram).toBe('https://instagram.com/negozio');
    expect(byKey.facebook).toBe('https://facebook.com/pagina');
    expect(byKey.tiktok).toBe('https://www.tiktok.com/@tok');
    expect(byKey.whatsapp).toBe('https://wa.me/393331234567');
    expect(byKey.website).toBe('https://sito.it');
  });

  it('drops empty/invalid values', () => {
    expect(socialLinks({})).toEqual([]);
    expect(socialLinks({ socials: { instagram: '', website: 'not-a-url' } })).toEqual([]);
    expect(socialLinks({ socials: { whatsapp: '123' } })).toEqual([]); // too short
  });
});

describe('badgeLabel', () => {
  it('maps known keys to labels and falls back to key', () => {
    expect(badgeLabel('bio')).toBe('Biologico');
    expect(badgeLabel('produzione_propria')).toBe('Produzione propria');
    expect(badgeLabel('xyz')).toBe('xyz');
  });
});
