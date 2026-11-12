/**
 * R06-025 (12/11/2026) — LE VIOLAZIONI DELLA POLITICA DI SICUREZZA NON LE VEDEVA NESSUNO.
 *
 * La Content-Security-Policy servita su tutte le pagine non aveva report-uri ne'
 * report-to, e nessun header Reporting-Endpoints: se uno script di terzi veniva
 * bloccato (e la cassa smetteva di funzionare) o qualcuno provava a iniettarne
 * uno, la politica proteggeva ma taceva.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const avvisi = vi.hoisted(() => [] as Array<{ msg: string; ctx?: unknown }>);
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: (msg: string, ctx?: unknown) => { avvisi.push({ msg, ctx }); },
    error: () => {}, info: () => {}, debug: () => {},
  },
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');
const { __resetRateLimitBuckets } = await import('@/lib/rate-limit');

beforeEach(() => { avvisi.length = 0; __resetRateLimitBuckets(); });

describe('R06-025 · la politica di sicurezza dice dove segnalare', () => {
  it('ogni pagina porta report-uri, report-to e Reporting-Endpoints', async () => {
    const r = await middleware(new NextRequest(new URL('https://mycity.test/')));
    const csp = r.headers.get('Content-Security-Policy') ?? '';
    expect(csp, 'La politica protegge ma tace: nessun indirizzo per le segnalazioni').toContain('report-uri /api/csp-report');
    expect(csp).toContain('report-to csp');
    expect(r.headers.get('Reporting-Endpoints')).toBe('csp="/api/csp-report"');
  });

  it('la rotta scrive la segnalazione nei log, senza i parametri della pagina, e risponde 204', async () => {
    const { POST } = await import('@/app/api/csp-report/route');
    const corpo = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://mycity.test/checkout?email=mario.rossi@gmail.com',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://evil.example/x.js?t=1',
      },
    });
    const r = await POST(new Request('https://mycity.test/api/csp-report', {
      method: 'POST', body: corpo, headers: { 'content-type': 'application/csp-report' },
    }));
    expect(r.status).toBe(204);
    const scritto = JSON.stringify(avvisi);
    expect(scritto).toContain('script-src-elem');
    expect(scritto).toContain('https://evil.example/x.js');
    expect(scritto).toContain('https://mycity.test/checkout');
    expect(scritto, 'I parametri della pagina possono portare dati personali').not.toContain('mario.rossi');
  });

  it('il formato report-to (un elenco) funziona uguale', async () => {
    const { POST } = await import('@/app/api/csp-report/route');
    const corpo = JSON.stringify([{ type: 'csp-violation', body: { documentURL: 'https://mycity.test/', effectiveDirective: 'img-src', blockedURL: 'https://x.example/a.png' } }]);
    const r = await POST(new Request('https://mycity.test/api/csp-report', { method: 'POST', body: corpo }));
    expect(r.status).toBe(204);
    expect(JSON.stringify(avvisi)).toContain('img-src');
  });

  it('un corpo enorme o illeggibile non si legge e risponde 204', async () => {
    const { POST } = await import('@/app/api/csp-report/route');
    const enorme = await POST(new Request('https://mycity.test/api/csp-report', { method: 'POST', body: 'x'.repeat(20_000) }));
    const rotto = await POST(new Request('https://mycity.test/api/csp-report', { method: 'POST', body: '{non json' }));
    expect(enorme.status).toBe(204);
    expect(rotto.status).toBe(204);
    expect(avvisi.length).toBe(0);
  });

  it('anche i rimandi portano la politica e il punto di raccolta', async () => {
    for (const percorso of ['/admin', '/seller/orders']) {
      const r = await middleware(new NextRequest(new URL(`https://mycity.test${percorso}`)));
      expect(r.status, `${percorso} non rimanda a chi non e' entrato: la prova non misura piu' i rimandi`).toBeGreaterThanOrEqual(300);
      expect(r.headers.get('Content-Security-Policy') ?? '').toContain('report-uri /api/csp-report');
      expect(r.headers.get('Reporting-Endpoints'), `il rimando di ${percorso} non dice dove segnalare`).toBe('csp="/api/csp-report"');
    }
  });

  it('un corpo in arrivo a pezzi, senza content-length, si ferma al tetto', async () => {
    const { POST } = await import('@/app/api/csp-report/route');
    let mandati = 0;
    const flusso = new ReadableStream<Uint8Array>({
      pull(c) {
        if (mandati >= 1000) { c.close(); return; }
        mandati += 1;
        c.enqueue(new TextEncoder().encode('x'.repeat(1024)));
      },
    });
    const r = await POST(new Request('https://mycity.test/api/csp-report', { method: 'POST', body: flusso, duplex: 'half' } as RequestInit));
    expect(r.status).toBe(204);
    expect(mandati, 'Il corpo e\' stato letto tutto prima del controllo dei 10 KB').toBeLessThan(100);
    expect(avvisi.length).toBe(0);
  });

  it('una segnalazione senza campi utili non riempie i log', async () => {
    const { POST } = await import('@/app/api/csp-report/route');
    const r = await POST(new Request('https://mycity.test/api/csp-report', { method: 'POST', body: JSON.stringify([[], {}, { 'csp-report': 'testo' }]) }));
    expect(r.status).toBe(204);
    expect(avvisi.length).toBe(0);
  });
});
