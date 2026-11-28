/**
 * R11-010 (28/11/2026) — SULLO SCHERMO DI UN TELEFONO DODICI PROVE ERANO ROSSE, E NON ERA IL TELEFONO.
 *
 * Il lavoro «e2e-telefono» della CI apre il sito con WebKit (il motore di Safari) su
 * http://localhost:3000. La politica di sicurezza portava sempre `upgrade-insecure-requests`, e Safari
 * — a differenza di Chrome — la applica anche a localhost: chiedeva in https i fogli di stile e gli
 * script del sito stesso, che lì non esistono. La pagina arrivava senza stile e senza JavaScript:
 * carrello, cassa, carrello condiviso, scheda del prodotto e avviso dei Termini non si disegnavano, i
 * due campi «Cerca» (computer e telefono) si vedevano insieme, e i link interni non portavano via.
 *
 * Su una pagina in http la regola non protegge niente e rompe tutto; su una pagina in https resta.
 * Qui: la regola c'è in https (anche dietro un proxy che lo dice con `x-forwarded-proto`) e manca
 * solo sulla pagina servita in http. Il resto della politica non cambia.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } }));
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

async function politica(indirizzo: string, intestazioni: Record<string, string> = {}): Promise<string> {
  const r = await middleware(new NextRequest(new URL(indirizzo), { headers: intestazioni }));
  return r.headers.get('Content-Security-Policy') ?? '';
}

/** La politica senza la parte che cambia a ogni richiesta (il nonce) e senza la regola in esame. */
function restoDellaPolitica(csp: string): string {
  return csp
    .replace(/'nonce-[^']+'/, "'nonce-X'")
    .split('; ')
    .filter((d) => d !== 'upgrade-insecure-requests')
    .join('; ');
}

describe('R11-010 · upgrade-insecure-requests solo su una pagina arrivata in https', () => {
  it('in https la regola c\'è (produzione)', async () => {
    expect(await politica('https://mycity.test/')).toContain('upgrade-insecure-requests');
  });

  it('dietro un proxy che dice https (x-forwarded-proto) la regola c\'è', async () => {
    expect(await politica('http://mycity.test/', { 'x-forwarded-proto': 'https' })).toContain('upgrade-insecure-requests');
  });

  it('sulla pagina servita in http (la CI su localhost, il telefono sulla rete di casa) la regola manca', async () => {
    for (const indirizzo of ['http://localhost:3000/search', 'http://192.168.1.20:3000/cart']) {
      const csp = await politica(indirizzo, { 'x-forwarded-proto': 'http' });
      expect(csp, `${indirizzo}: Safari chiederebbe in https gli stili e gli script del sito`).not.toContain('upgrade-insecure-requests');
      expect(csp, 'la politica deve esserci lo stesso').toContain("default-src 'self'");
    }
  });

  it('il resto della politica è lo stesso in http e in https', async () => {
    const inHttps = await politica('https://localhost:3000/');
    const inHttp = await politica('http://localhost:3000/');
    expect(restoDellaPolitica(inHttp)).toBe(restoDellaPolitica(inHttps));
  });
});
