/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R08-023 — Se la persona toglie il consenso ai cookie statistici, Sentry smette
 * subito di misurare le sue pagine, senza aspettare una ricarica.
 *
 * Le opzioni si prendono UNA volta, come fa instrumentation-client.ts all'avvio;
 * poi si cambia idea dal banner e si chiede la quota della misura successiva.
 */
vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));

const { acceptAll, rejectAll } = await import('@/lib/consent');
const { opzioniSentry } = await import('@/lib/analytics/sentry-config');

type Opzioni = { tracesSampleRate?: number; tracesSampler?: (c?: unknown) => number };
const quota = (o: Opzioni) => (o.tracesSampler ? o.tracesSampler({}) : o.tracesSampleRate ?? 0);

beforeEach(() => {
  document.cookie.split(';').forEach((c) => {
    document.cookie = `${c.split('=')[0].trim()}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
  localStorage.clear();
});

describe('R08-023 — la revoca del consenso vale subito anche per Sentry', () => {
  it('accetta all’avvio, poi dice no: la misura dopo non parte più', () => {
    acceptAll();
    const opzioni = opzioniSentry() as Opzioni;
    expect(quota(opzioni)).toBe(0.1);
    rejectAll();
    expect(quota(opzioni)).toBe(0);
  });

  it('dice no all’avvio, poi accetta: le misure partono senza ricaricare', () => {
    rejectAll();
    const opzioni = opzioniSentry() as Opzioni;
    expect(quota(opzioni)).toBe(0);
    acceptAll();
    expect(quota(opzioni)).toBe(0.1);
  });
});
