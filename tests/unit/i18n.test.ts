import { describe, it, expect } from 'vitest';
import { resolveLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE } from '@/i18n';

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
