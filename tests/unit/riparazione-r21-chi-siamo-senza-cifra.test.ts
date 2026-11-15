import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { monta } from './aiuti/monta-componente';
import { databaseDellaVetrina, OGGI, type Dati } from './aiuti/database-della-vetrina';

/**
 * R21-006 — Se il conteggio dei negozi non riesce (o i negozi sono zero), «Chi
 * siamo» non torna a dire «100% venditori locali verificati»: la cifra si toglie.
 */

const clientDellaPagina = vi.hoisted(() => ({ cookie: null as unknown }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => clientDellaPagina.cookie }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

type Elemento = { type?: unknown; props?: Record<string, unknown> } | null | undefined | string | number | boolean;
function testoDi(albero: Elemento): string {
  if (albero === null || albero === undefined || typeof albero === 'boolean') return '';
  if (typeof albero === 'string' || typeof albero === 'number') return String(albero);
  if (Array.isArray(albero)) return albero.map((x) => testoDi(x as Elemento)).join(' ');
  return testoDi((albero.props ?? {}).children as Elemento);
}

const DATI: Dati = {
  profiles: [{ id: 'n1', role: 'seller', is_approved: true, store_name: 'Pane Quotidiano' }],
  cms_pages: [],
  user_achievements: [],
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://finto.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'chiave-pubblica-finta');
});
afterEach(() => {
  vi.unstubAllEnvs();
  clientDellaPagina.cookie = null;
});

async function paginaCon(dati: Dati, lettura: 'ok' | 'cade') {
  const db = databaseDellaVetrina(dati, OGGI, null);
  clientDellaPagina.cookie = lettura === 'ok'
    ? db.client
    : {
        ...db.client,
        from: (t: string) => (t === 'seller_public_profiles'
          ? { select: async () => ({ count: null, data: null, error: { message: 'rete caduta' } }) }
          : (db.client as unknown as { from: (x: string) => unknown }).from(t)),
      };
  const pagina = (await monta('app/about/page.tsx')).default as () => Promise<Elemento>;
  return testoDi(await pagina());
}

describe('R21-006 · «Chi siamo» senza il numero dei negozi', () => {
  beforeAll(async () => { await monta('app/about/page.tsx'); }, 60000);

  it('con il conteggio che cade non dice «100% venditori locali verificati»', async () => {
    const testo = await paginaCon(DATI, 'cade');
    expect(testo).not.toContain('100%');
    expect(testo).not.toContain('venditori locali verificati');
    // le altre statistiche restano
    expect(testo).toContain('il confine della consegna');
    expect(testo).toContain('paghi alla consegna');
  });

  it('con zero negozi la cifra si toglie e non si inventa', async () => {
    const testo = await paginaCon({ ...DATI, profiles: [] }, 'ok');
    expect(testo).not.toContain('100%');
    expect(testo).not.toContain('venditori locali verificati');
    expect(testo).not.toContain('negozi locali attivi');
  });

  it('con il conteggio che riesce dice il numero vero', async () => {
    expect(await paginaCon(DATI, 'ok')).toContain('1 negozio locale attivo');
  });

  it('nemmeno gli altri testi della pagina e della home promettono «verificati» come un fatto già controllato', () => {
    expect(readFileSync('app/about/page.tsx', 'utf8')).not.toContain('verificati uno a uno');
    expect(readFileSync('components/home-sections/HomeSectionRenderer.tsx', 'utf8')).not.toContain('Solo negozi verificati di Piacenza');
    expect(readFileSync('components/home-sections/HomeSectionRenderer.tsx', 'utf8')).not.toContain("'100% commercianti locali'");
  });
});
