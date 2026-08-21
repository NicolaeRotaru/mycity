import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE, RILEVAMENTO_LINGUA_ATTIVO } from '@/i18n';

describe('SUPPORTED_LOCALES', () => {
  it('includes it and en', () => {
    expect(SUPPORTED_LOCALES).toEqual(['it', 'en']);
  });

  it('default locale is italian', () => {
    expect(DEFAULT_LOCALE).toBe('it');
  });
});

describe('resolveLocale', () => {
  it('prefers cookie locale when supported', () => {
    expect(resolveLocale('en', 'it-IT,it;q=0.9')).toBe('en');
  });

  it('falls back to Accept-Language when cookie missing', () => {
    expect(resolveLocale(undefined, 'en-US,en;q=0.9,it;q=0.8')).toBe('en');
  });

  it('parses multiple langs in Accept-Language, picks first supported', () => {
    expect(resolveLocale(undefined, 'fr-FR,fr;q=0.9,en;q=0.8')).toBe('en');
  });

  it('falls back to default when nothing matches', () => {
    expect(resolveLocale(undefined, 'fr-FR,de;q=0.5')).toBe('it');
  });

  it('falls back to default when both null', () => {
    expect(resolveLocale(undefined, null)).toBe('it');
  });

  it('ignores unsupported cookie value', () => {
    expect(resolveLocale('xx', 'en')).toBe('en');
  });

  it('ignores empty cookie value', () => {
    expect(resolveLocale('', 'en')).toBe('en');
  });

  it('parses single-locale Accept-Language without quality', () => {
    expect(resolveLocale(undefined, 'en')).toBe('en');
  });

  it('strips region code (it-IT → it)', () => {
    expect(resolveLocale(undefined, 'it-IT')).toBe('it');
  });
});

describe('messages JSON', () => {
  it('it.json and en.json have matching top-level keys', async () => {
    const it = (await import('@/messages/it.json')).default;
    const en = (await import('@/messages/en.json')).default;
    const itKeys = Object.keys(it).sort();
    const enKeys = Object.keys(en).sort();
    expect(itKeys).toEqual(enKeys);
  });

  it('it.json has all expected namespaces', async () => {
    const it = (await import('@/messages/it.json')).default;
    const expected = ['actions', 'states', 'errors', 'toasts', 'nav', 'checkout', 'marketing'];
    for (const ns of expected) {
      expect(it).toHaveProperty(ns);
    }
  });

  it('en.json actions.save returns Save', async () => {
    const en = (await import('@/messages/en.json')).default;
    expect(en.actions.save).toBe('Save');
  });
});

/**
 * #7 e #83 — LA LINGUA NON SI LEGGE PIÙ A OGNI RENDER, ED È UNA SCELTA.
 *
 * Due danni in una riga sola. Un visitatore col browser in inglese riceveva
 * una pagina marcata `lang="en"` con dentro il 92% di testo italiano. E
 * leggere cookie e intestazioni nel guscio comune rendeva dinamica OGNI rotta
 * del sito: 2 pagine statiche su 203, anche /privacy e /terms che non cambiano
 * mai. Dopo la riparazione sono 96.
 *
 * `resolveLocale` resta com'era — è la regola che riuseremo il giorno in cui
 * la traduzione sarà completa — ma oggi il render non la chiama.
 */
describe('il rilevamento della lingua è spento finché la traduzione è a metà', () => {
  it('è dichiarato spento, non spento per caso', () => {
    expect(RILEVAMENTO_LINGUA_ATTIVO).toBe(false);
  });

  it('il guscio comune non legge più cookie né intestazioni', () => {
    const sorgente = readFileSync(join(process.cwd(), 'i18n.ts'), 'utf8');
    // Sono queste due letture a rendere dinamica ogni pagina del sito.
    expect(sorgente).not.toContain("from 'next/headers'");
    expect(sorgente).not.toMatch(/await cookies\(\)/);
    expect(sorgente).not.toMatch(/await headers\(\)/);
  });

  it('il selettore di lingua non è esposto: sceglierla non cambierebbe niente', () => {
    const footer = readFileSync(join(process.cwd(), 'components/Footer.tsx'), 'utf8');
    // Il nome compare in un commento che spiega la scelta: quello che conta è
    // che il componente non sia importato, cioè non finisca nella pagina.
    expect(footer).not.toMatch(/^import .*LocaleSwitcher/m);
  });
});
