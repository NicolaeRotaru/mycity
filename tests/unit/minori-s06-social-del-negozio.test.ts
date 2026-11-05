import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  campoDellErrore, normalizzaSocials, numeroWhatsappItaliano, socialLinks, storeCustomizationSchema,
} from '@/lib/store-customization';

/**
 * S06 — I social della vetrina.
 * 295: link incollato, @ e sito senza https si correggono da soli; l'errore dice quale campo.
 * 580: il WhatsApp senza +39 apre un numero italiano, non francese.
 */
describe('295 — social scritti come li scrive una persona', () => {
  it('si correggono e passano il controllo', () => {
    const s = normalizzaSocials({
      instagram: 'https://www.instagram.com/panequotidiano/', facebook: '@Pane.Q',
      tiktok: 'https://www.tiktok.com/@forno', website: 'www.panequotidiano.it',
    });
    expect(s).toMatchObject({ instagram: 'panequotidiano', facebook: 'Pane.Q', tiktok: 'forno', website: 'https://www.panequotidiano.it' });
    expect(storeCustomizationSchema.safeParse({ socials: s }).success).toBe(true);
  });
  it('quello che non si corregge dice il campo e cosa scrivere', () => {
    const r = storeCustomizationSchema.safeParse({ socials: normalizzaSocials({ facebook: 'Pane Quotidiano Piacenza' }) });
    expect(r.success).toBe(false);
    const p = !r.success ? r.error.issues[0] : null;
    expect(campoDellErrore(p!.path)).toBe('Facebook');
    expect(p!.message).toContain('per esempio panequotidiano');
    expect(readFileSync('components/VendorForm.tsx', 'utf8')).toContain('normalizzaSocials(custom.socials)');
  });
});

describe('580 — WhatsApp all\'italiana', () => {
  it.each([
    ['333 1234567', '393331234567'], ['+39 333 1234567', '393331234567'], ['0039 333 1234567', '393331234567'],
    ['0523 123456', '390523123456'], ['393331234567', '393331234567'],
  ])('%s → %s', (dentro, fuori) => { expect(numeroWhatsappItaliano(dentro)).toBe(fuori); });
  it('il bottone della vetrina apre +39', () => {
    expect(socialLinks({ socials: { whatsapp: '333 1234567' } })[0].href).toBe('https://wa.me/393331234567');
  });
});

describe('295 (revisore) — link che non portano il nome del profilo', () => {
  it('profile.php?id= e /p/… restano com\'erano e il controllo li ferma', () => {
    const s = normalizzaSocials({ facebook: 'https://www.facebook.com/profile.php?id=1000123', instagram: 'https://www.instagram.com/p/Cxyz/' });
    expect(s?.facebook).toBe('https://www.facebook.com/profile.php?id=1000123');
    expect(s?.instagram).toBe('https://www.instagram.com/p/Cxyz/');
    expect(storeCustomizationSchema.safeParse({ socials: s }).success).toBe(false);
  });
});
