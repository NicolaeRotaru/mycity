// @vitest-environment jsdom
/**
 * 25/11/2026 — Il banner dei cookie si disegnava solo dopo il JavaScript: su un telefono era
 * l'ultima cosa della pagina (Lighthouse lo misurava come elemento più grande, a 5 secondi). Adesso
 * il server lo manda già aperto quando nel cookie manca una scelta valida. Qui si guarda:
 *  - che cosa il server considera «scelta valida» (sceltaNelCookie);
 *  - che il banner aperto dal server sia nell'HTML, e chiuso non ci sia;
 *  - che il cookie si riscriva quando manca ma la scelta nel browser c'è (Safari li cancella dopo 7 giorni).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CookieBanner from '@/components/CookieBanner';
import {
  sceltaNelCookie,
  rinfrescaIlCookieDelConsenso,
  CONSENT_VERSION,
  CONSENT_COOKIE,
  type ConsentState,
} from '@/lib/consent';

describe('sceltaNelCookie', () => {
  it('nessun cookie o cookie illeggibile: nessuna scelta', () => {
    expect(sceltaNelCookie(undefined)).toBe(false);
    expect(sceltaNelCookie('')).toBe(false);
    expect(sceltaNelCookie('%E0%A4%A')).toBe(false);
    expect(sceltaNelCookie('011')).toBe(false); // la vecchia forma senza versione
  });
  it('versione vecchia: il banner va riproposto', () => {
    expect(sceltaNelCookie(encodeURIComponent(`${Number(CONSENT_VERSION) - 1}:111`))).toBe(false);
  });
  it('rifiutare tutto è una scelta valida, come accettare', () => {
    expect(sceltaNelCookie(encodeURIComponent(`${CONSENT_VERSION}:000`))).toBe(true);
    expect(sceltaNelCookie(encodeURIComponent(`${CONSENT_VERSION}:111`))).toBe(true);
  });
  it('cifre in più o diverse da 0/1: non è una scelta', () => {
    expect(sceltaNelCookie(encodeURIComponent(`${CONSENT_VERSION}:12`))).toBe(false);
    expect(sceltaNelCookie(encodeURIComponent(`${CONSENT_VERSION}:1111`))).toBe(false);
  });
});

describe('il banner aperto dal server', () => {
  it('aperto: il testo del banner è già nell’HTML', () => {
    const html = renderToStaticMarkup(createElement(CookieBanner, { apertoDalServer: true }));
    expect(html).toContain('id="cookie-banner-desc"');
    expect(html).toContain('Rifiuta tutto');
  });
  it('chiuso (scelta già fatta): nell’HTML non c’è niente', () => {
    expect(renderToStaticMarkup(createElement(CookieBanner, { apertoDalServer: false }))).toBe('');
    expect(renderToStaticMarkup(createElement(CookieBanner, {}))).toBe('');
  });
});

describe('rinfrescaIlCookieDelConsenso', () => {
  beforeEach(() => {
    document.cookie = `${CONSENT_COOKIE}=; max-age=0; path=/`;
  });
  const stato = (giorniFa: number): ConsentState =>
    ({ necessary: true, functional: false, analytics: true, marketing: false, ts: Date.now() - giorniFa * 86_400_000, version: CONSENT_VERSION }) as ConsentState;

  it('riscrive il cookie con la stessa scelta quando manca', () => {
    rinfrescaIlCookieDelConsenso(stato(10));
    expect(document.cookie).toContain(`${CONSENT_COOKIE}=${encodeURIComponent(`${CONSENT_VERSION}:010`)}`);
  });
  it('una scelta scaduta non si riscrive', () => {
    rinfrescaIlCookieDelConsenso(stato(181));
    expect(document.cookie).not.toContain(`${CONSENT_COOKIE}=`);
  });
});
