/**
 * 28/11/2026 — Nicola apriva il marketplace a `mycity-phi.vercel.app`, l'indirizzo
 * che Vercel dà al progetto, invece che a `www.mycity-marketplace.com`. Le
 * pagine erano le stesse, ma l'accesso e il carrello no: il browser li tiene
 * separati per indirizzo, e i link che il sito scrive (email, ritorni da Stripe)
 * portano tutti su `www`. Ora l'indirizzo vecchio rimanda al dominio vero.
 *
 * Questa prova diventa rossa se il rimando sparisce, se finisce per toccare le
 * anteprime o le API, o se rimanda a un indirizzo che non è il nostro.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { rimandoAlDominioVero, INDIRIZZI_VECCHI } from '@/lib/dominio-unico';

const VERO = 'https://www.mycity-marketplace.com';

function richiesta(url: string, method = 'GET', host?: string) {
  return { method, url, headers: new Headers(host ? { host } : {}) };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("il sito ha un indirizzo solo", () => {
  it("il middleware vero manda l'indirizzo vecchio alla stessa pagina sul dominio, per sempre (308)", async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', VERO);
    const { NextRequest } = await import('next/server');
    const { middleware } = await import('@/middleware');
    const r = await middleware(new NextRequest('https://mycity-phi.vercel.app/shop/pane-quotidiano?tab=prodotti'));
    expect(r.status).toBe(308);
    expect(r.headers.get('location')).toBe(`${VERO}/shop/pane-quotidiano?tab=prodotti`);
  });

  it("anche la home e il pannello admin passano sul dominio", () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', VERO);
    expect(rimandoAlDominioVero(richiesta('https://mycity-phi.vercel.app/'))).toBe(`${VERO}/`);
    expect(rimandoAlDominioVero(richiesta('https://mycity-phi.vercel.app/admin', 'HEAD'))).toBe(`${VERO}/admin`);
    expect(INDIRIZZI_VECCHI).toContain('mycity-phi.vercel.app');
  });

  it("un percorso che sembra un altro sito resta comunque sul nostro dominio", () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', VERO);
    for (const percorso of ['//evil.com', '/%2F%2Fevil.com', '/@evil.com', '/x?next=https://evil.com']) {
      const dove = rimandoAlDominioVero(richiesta(`https://mycity-phi.vercel.app${percorso}`));
      expect(dove, percorso).not.toBeNull();
      expect(new URL(dove as string).host, percorso).toBe('www.mycity-marketplace.com');
    }
  });

  it("l'indirizzo vecchio si riconosce dall'intestazione Host vera, anche scritta in maiuscolo o con la porta", () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', VERO);
    expect(rimandoAlDominioVero(richiesta('https://localhost/negozi', 'GET', 'MyCity-Phi.Vercel.App:443'))).toBe(`${VERO}/negozi`);
    expect(rimandoAlDominioVero(richiesta('https://localhost/negozi', 'GET', 'mycity-phi.vercel.app.'))).toBe(`${VERO}/negozi`);
  });

  it("senza il dominio dichiarato non si rimanda a un indirizzo di Vercel che il browser ricorderebbe per sempre", () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL', '');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_URL', 'mycity-abc123-nicolaerotarus-projects.vercel.app');
    expect(rimandoAlDominioVero(richiesta('https://mycity-phi.vercel.app/'))).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity-phi.vercel.app.');
    expect(rimandoAlDominioVero(richiesta('https://mycity-phi.vercel.app/'))).toBeNull();
  });

  it("il dominio vero non rimanda a sé stesso", () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', VERO);
    expect(rimandoAlDominioVero(richiesta(`${VERO}/`))).toBeNull();
    expect(rimandoAlDominioVero(richiesta('https://mycity-marketplace.com/'))).toBeNull();
  });

  it("le anteprime e le singole pubblicazioni restano dove sono: la prova di fumo del rilascio le controlla lì", () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', VERO);
    expect(rimandoAlDominioVero(richiesta('https://mycity-k2f880gn7-nicolaerotarus-projects.vercel.app/'))).toBeNull();
    expect(rimandoAlDominioVero(richiesta('https://mycity-git-ramo-nicolaerotarus-projects.vercel.app/'))).toBeNull();
  });

  it("un modulo mandato da una scheda rimasta aperta sull'indirizzo vecchio non viene respinto", () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', VERO);
    expect(rimandoAlDominioVero(richiesta('https://mycity-phi.vercel.app/checkout', 'POST'))).toBeNull();
  });

  it("se il dominio vero non è dichiarato in https, non si rimanda da nessuna parte", () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    expect(rimandoAlDominioVero(richiesta('https://mycity-phi.vercel.app/'))).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity-phi.vercel.app');
    expect(rimandoAlDominioVero(richiesta('https://mycity-phi.vercel.app/'))).toBeNull();
  });

  it("le API (webhook di Stripe, lavori periodici) restano fuori dal middleware", async () => {
    const { config } = await import('@/middleware');
    const filtro = new RegExp(`^${config.matcher[0]}$`);
    expect(filtro.test('/api/stripe/webhook')).toBe(false);
    expect(filtro.test('/api/cron/expire-stale-orders')).toBe(false);
    expect(filtro.test('/shop/pane-quotidiano')).toBe(true);
  });
});
