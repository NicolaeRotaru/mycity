import { describe, it, expect } from 'vitest';
import { normalizeCustomization, accentHex, announcementActive } from '@/lib/store-customization';

/**
 * 17/11/2026 (R01-010) — Basta un solo campo fuori regola e tutta la personalizzazione della
 * vetrina sparisce (e il salvataggio dopo la cancella). Qui un campo solo è
 * sbagliato (una copertina che non c'è più, un motto troppo lungo, un badge
 * tolto dall'elenco): gli altri restano.
 */
const UUID = '11111111-1111-4111-8111-111111111111';

describe('R01-010 · si scarta solo il campo invalido', () => {
  it('una copertina che non esiste più non porta via colore, motto, social e annuncio', () => {
    const c = normalizeCustomization({
      theme: { accent: '#456236', coverStyle: 'copertina-tolta' },
      tagline: 'Pane fresco',
      socials: { instagram: 'panequotidiano' },
      announcement: { enabled: true, text: 'Chiusi lunedì' },
    });
    expect(c.tagline).toBe('Pane fresco');
    expect(c.socials?.instagram).toBe('panequotidiano');
    expect(c.announcement?.text).toBe('Chiusi lunedì');
    expect(c.theme?.accent).toBe('#456236');
    expect(c.theme?.coverStyle).toBeUndefined();
  });

  it('un motto troppo lungo si scarta, il resto no', () => {
    const c = normalizeCustomization({ tagline: 'x'.repeat(500), theme: { accent: '#456236' }, badges: ['bio'] });
    expect(c.tagline).toBeUndefined();
    expect(c.badges).toEqual(['bio']);
    expect(accentHex(c)).toBe('#456236');
  });

  it('un social sbagliato non toglie gli altri social', () => {
    const c = normalizeCustomization({ socials: { instagram: 'Pane Quotidiano Piacenza', facebook: 'panequotidiano', whatsapp: '333 1234567' } });
    expect(c.socials?.instagram).toBeUndefined();
    expect(c.socials?.facebook).toBe('panequotidiano');
    expect(c.socials?.whatsapp).toBe('333 1234567');
  });

  it('negli elenchi si scartano gli elementi invalidi e si tengono gli altri', () => {
    const c = normalizeCustomization({ badges: ['bio', 'badge-tolto', 'artigianale'], featuredProductIds: [UUID, 'non-un-uuid'] });
    expect(c.badges).toEqual(['bio', 'artigianale']);
    expect(c.featuredProductIds).toEqual([UUID]);
  });

  it('il letto-modifica-scrivi del colore tiene il resto: quello che si riscrive porta ancora motto e social', () => {
    const letta = normalizeCustomization({ tagline: 'Pane fresco', socials: { facebook: 'panequotidiano' }, theme: { coverStyle: 'copertina-tolta' } });
    const riscritta = { ...letta, theme: { ...letta.theme, accent: '#C0492C' } };
    expect(riscritta.tagline).toBe('Pane fresco');
    expect(riscritta.socials?.facebook).toBe('panequotidiano');
  });

  it('una scadenza dell\'annuncio fuori regola spegne l\'annuncio, non lo lascia acceso per sempre', () => {
    const c = normalizeCustomization({
      tagline: 'Pane fresco',
      announcement: { enabled: true, text: 'Saldi di novembre', until: '30/11/2026' },
    });
    expect(c.tagline).toBe('Pane fresco');
    expect(c.announcement?.text).toBe('Saldi di novembre');
    expect(c.announcement?.enabled).toBe(false);
    expect(c.announcement?.until).toBeUndefined();
    expect(announcementActive(c, new Date('2027-01-15T12:00:00Z'))).toBe(false);
  });

  it('un annuncio tutto valido resta acceso con la sua scadenza', () => {
    const c = normalizeCustomization({ announcement: { enabled: true, text: 'Saldi', until: '2026-11-30' } });
    expect(c.announcement).toEqual({ enabled: true, text: 'Saldi', until: '2026-11-30' });
    expect(announcementActive(c, new Date('2026-11-20T12:00:00Z'))).toBe(true);
    expect(announcementActive(c, new Date('2026-12-15T12:00:00Z'))).toBe(false);
  });

  it('un oggetto tutto valido resta com\'era, e uno tutto rotto torna vuoto', () => {
    const buono = { theme: { accent: '#C0492C', coverStyle: 'lino' }, tagline: 'Ciao' };
    expect(normalizeCustomization(buono)).toEqual(buono);
    expect(normalizeCustomization({ theme: 'no', tagline: 5, badges: 'x' })).toEqual({});
    expect(normalizeCustomization(null)).toEqual({});
  });
});
