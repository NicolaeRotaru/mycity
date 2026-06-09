import { describe, it, expect } from 'vitest';
import { parseUserAgent } from '@/lib/user-agent';

/**
 * Unit test per il parser user-agent (lib/user-agent.ts), usato dal beacon di
 * sorveglianza per classificare device/browser/OS/bot dei visitatori anonimi.
 */

describe('parseUserAgent', () => {
  it('riconosce iPhone (Safari mobile / iOS)', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const r = parseUserAgent(ua);
    expect(r.deviceType).toBe('mobile');
    expect(r.os).toBe('iOS');
    expect(r.browser).toBe('Safari');
    expect(r.isBot).toBe(false);
  });

  it('riconosce Android phone (Chrome mobile)', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
    const r = parseUserAgent(ua);
    expect(r.deviceType).toBe('mobile');
    expect(r.os).toBe('Android');
    expect(r.browser).toBe('Chrome');
  });

  it('riconosce iPad come tablet', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
    const r = parseUserAgent(ua);
    expect(r.deviceType).toBe('tablet');
    expect(r.os).toBe('iOS');
  });

  it('riconosce desktop Windows (Chrome)', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const r = parseUserAgent(ua);
    expect(r.deviceType).toBe('desktop');
    expect(r.os).toBe('Windows');
    expect(r.browser).toBe('Chrome');
  });

  it('distingue Edge da Chrome', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
    expect(parseUserAgent(ua).browser).toBe('Edge');
  });

  it('riconosce macOS Safari', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    const r = parseUserAgent(ua);
    expect(r.os).toBe('macOS');
    expect(r.browser).toBe('Safari');
    expect(r.deviceType).toBe('desktop');
  });

  it('rileva i bot/crawler', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'facebookexternalhit/1.1',
      'curl/8.4.0',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
    ]) {
      const r = parseUserAgent(ua);
      expect(r.isBot).toBe(true);
      expect(r.deviceType).toBe('bot');
    }
  });

  it('gestisce UA vuoto/nullo', () => {
    expect(parseUserAgent(null).deviceType).toBe('unknown');
    expect(parseUserAgent('').isBot).toBe(false);
    expect(parseUserAgent(undefined).browser).toBe('Sconosciuto');
  });
});
