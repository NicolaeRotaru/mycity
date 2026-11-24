import { describe, it, expect } from 'vitest';
import { normalizzaSocials, storeCustomizationSchema, campoDellErrore } from '@/lib/store-customization';

/**
 * R07-009 — Altri percorsi di Facebook non elencati si salvavano come nome del profilo.
 *
 * Il collaudo del 22/11 ha provato undici percorsi di una parola sola fuori dall'elenco: passavano
 * tutti come «nome» (https://facebook.com/onthisday diventava il profilo «onthisday»). Ora un nome col
 * trattino basso non è mai un profilo (Facebook non lo ammette nei nomi), e i percorsi trovati sono
 * nell'elenco. I profili veri, anche coi punti o col trattino delle pagine di prima, restano un nome.
 */
const fb = (url: string) => normalizzaSocials({ facebook: url })?.facebook;

describe('R07-009 — i percorsi di Facebook di una parola sola non diventano un nome', () => {
  const NON_PROFILO = [
    'https://www.facebook.com/find-friends',
    'https://www.facebook.com/pymk',
    'https://www.facebook.com/onthisday',
    'https://www.facebook.com/games',
    'https://www.facebook.com/latest',
    'https://www.facebook.com/feeds',
    'https://www.facebook.com/donate',
    'https://www.facebook.com/fundraiser',
    'https://www.facebook.com/business_help',
    'https://www.facebook.com/watchparty',
    'https://www.facebook.com/coronavirus_info',
    // La classe, non solo l'elenco: un percorso col trattino basso che nessuno ha ancora visto.
    'https://www.facebook.com/climate_science_center',
    'https://m.facebook.com/gaming_videos/?ref=bookmarks',
  ];

  it.each(NON_PROFILO)('%s resta com\'è ed è fermato con l\'errore su Facebook', (url) => {
    expect(fb(url)).toBe(url);
    const r = storeCustomizationSchema.safeParse({ socials: { facebook: fb(url) } });
    expect(r.success).toBe(false);
    if (!r.success) expect(campoDellErrore(r.error.issues[0].path)).toBe('Facebook');
  });

  it('i profili veri si riducono ancora al nome', () => {
    expect(fb('https://www.facebook.com/panequotidiano')).toBe('panequotidiano');
    expect(fb('https://www.facebook.com/Pane.Quotidiano.Piacenza/')).toBe('Pane.Quotidiano.Piacenza');
    expect(fb('https://www.facebook.com/Pane-Quotidiano-Piacenza-123456789012345/')).toBe('Pane-Quotidiano-Piacenza-123456789012345');
    expect(fb('https://www.facebook.com/gamestop.piacenza?mibextid=ZbWKwL')).toBe('gamestop.piacenza');
  });

  it('il nome scritto a mano non passa dalle regole dei link', () => {
    expect(fb('panequotidiano')).toBe('panequotidiano');
  });
});
