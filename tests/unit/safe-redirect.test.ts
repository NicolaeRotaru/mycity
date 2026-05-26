import { describe, it, expect } from 'vitest';
import { safeInternalPath } from '@/lib/safe-redirect';

/**
 * Unit test per lib/safe-redirect: open redirect protection.
 *
 * Esperti consultati:
 * - Security Engineer (OWASP A01): "Open redirect = phishing vector +
 *   token leak via Referer. SEMPRE whitelist."
 *
 * Coverage: tutti i vector noti di attacco redirect.
 */

describe('safeInternalPath - valid paths', () => {
  it('accepts simple root path', () => {
    expect(safeInternalPath('/')).toBe('/');
  });

  it('accepts nested path', () => {
    expect(safeInternalPath('/profile/settings')).toBe('/profile/settings');
  });

  it('accepts path with query string', () => {
    expect(safeInternalPath('/search?q=pizza&cat=food')).toBe('/search?q=pizza&cat=food');
  });

  it('accepts path with hash', () => {
    expect(safeInternalPath('/orders#delivered')).toBe('/orders#delivered');
  });

  it('accepts path with encoded chars', () => {
    expect(safeInternalPath('/cerca/pizza%20margherita')).toBe('/cerca/pizza%20margherita');
  });
});

describe('safeInternalPath - blocks open redirect attacks', () => {
  it('blocks absolute http URLs', () => {
    expect(safeInternalPath('http://evil.com')).toBe('/');
  });

  it('blocks absolute https URLs', () => {
    expect(safeInternalPath('https://evil.com/path')).toBe('/');
  });

  it('blocks protocol-relative //', () => {
    expect(safeInternalPath('//evil.com')).toBe('/');
  });

  it('blocks backslash redirect /\\', () => {
    expect(safeInternalPath('/\\evil.com')).toBe('/');
  });

  it('blocks javascript: scheme', () => {
    expect(safeInternalPath('javascript:alert(1)')).toBe('/');
    expect(safeInternalPath('/javascript:alert(1)')).toBe('/');
  });

  it('blocks data: scheme', () => {
    expect(safeInternalPath('data:text/html,<script>alert(1)</script>')).toBe('/');
    expect(safeInternalPath('/data:text/html,abc')).toBe('/');
  });

  it('blocks vbscript: scheme', () => {
    expect(safeInternalPath('/vbscript:alert')).toBe('/');
  });

  it('blocks file: scheme', () => {
    expect(safeInternalPath('/file:///etc/passwd')).toBe('/');
  });

  it('case insensitive scheme match', () => {
    expect(safeInternalPath('/JAVASCRIPT:alert(1)')).toBe('/');
    expect(safeInternalPath('/JavaScript:void(0)')).toBe('/');
  });
});

describe('safeInternalPath - fallback handling', () => {
  it('returns custom fallback when input is invalid', () => {
    expect(safeInternalPath('http://evil', '/home')).toBe('/home');
  });

  it('returns fallback for non-string input', () => {
    expect(safeInternalPath(null)).toBe('/');
    expect(safeInternalPath(undefined)).toBe('/');
    expect(safeInternalPath(123)).toBe('/');
    expect(safeInternalPath({})).toBe('/');
    expect(safeInternalPath([])).toBe('/');
  });

  it('returns fallback for empty string', () => {
    expect(safeInternalPath('')).toBe('/');
    expect(safeInternalPath('   ')).toBe('/');
  });

  it('returns fallback for path without leading slash', () => {
    expect(safeInternalPath('relative/path')).toBe('/');
    expect(safeInternalPath('evil.com')).toBe('/');
  });

  it('rejects extremely long paths (DoS protection)', () => {
    const longPath = '/' + 'a'.repeat(1000);
    expect(safeInternalPath(longPath)).toBe('/');
  });

  it('accepts paths under 512 char limit', () => {
    const okPath = '/' + 'a'.repeat(500);
    expect(safeInternalPath(okPath)).toBe(okPath);
  });
});
