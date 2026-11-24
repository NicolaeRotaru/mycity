import { describe, it, expect } from 'vitest';
import { normalizzaSocials, storeCustomizationSchema, campoDellErrore } from '@/lib/store-customization';

/**
 * R10-003 — Altri percorsi di Facebook (composer, creatorstudio, messenger, unsupportedbrowser…) si
 * salvavano come nome del profilo; e un nome col trattino basso passava se scritto a mano e non se
 * incollato in un link. Un percorso sconosciuto di una parola resta indistinguibile da un nome vero.
 */
const fb = (url: string) => normalizzaSocials({ facebook: url })?.facebook;

describe('R10-003 — percorsi di Facebook non elencati', () => {
  const NON_PROFILO = ['composer', 'creatorstudio', 'messenger', 'unsupportedbrowser', 'checkpoint', 'crisisresponse', 'community', 'developers'];
  it.each(NON_PROFILO)('facebook.com/%s resta com\'è ed è fermato con l\'errore su Facebook', (p) => {
    const url = `https://www.facebook.com/${p}`;
    expect(fb(url)).toBe(url);
    const r = storeCustomizationSchema.safeParse({ socials: { facebook: fb(url) } });
    expect(r.success).toBe(false);
    if (!r.success) expect(campoDellErrore(r.error.issues[0].path)).toBe('Facebook');
  });

  it('il nome scritto a mano col trattino basso è rifiutato come nel link', () => {
    const r = storeCustomizationSchema.safeParse({ socials: { facebook: 'pane_quotidiano' } });
    expect(r.success).toBe(false);
    if (!r.success) expect(campoDellErrore(r.error.issues[0].path)).toBe('Facebook');
  });

  it('i nomi veri passano: col trattino, coi punti, e il trattino basso resta valido su Instagram', () => {
    for (const n of ['pane-quotidiano', 'pane.quotidiano', 'panequotidiano']) {
      expect(storeCustomizationSchema.safeParse({ socials: { facebook: n } }).success, n).toBe(true);
    }
    expect(storeCustomizationSchema.safeParse({ socials: { instagram: 'pane_quotidiano' } }).success).toBe(true);
    expect(fb('https://www.facebook.com/panequotidiano')).toBe('panequotidiano');
  });
});
