import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { databaseDellaVetrina, OGGI, DOPO, type Dati, type MondoVetrina } from './aiuti/database-della-vetrina';

/**
 * 18/10/2026 — «CHI SIAMO» E I PROFILI PUBBLICI /u/…, ESEGUITI DAVVERO, CON LA TABELLA DEI PROFILI
 * CHIUSA.
 *
 * Le migrazioni 110, 112 e 161 (fra le 48 che mancano in produzione) chiudono la lettura di
 * `profiles`: dopo, ognuno legge solo la propria riga. Due pagine del server ci leggevano dentro
 * il profilo degli altri:
 *  · «Chi siamo» contava lì i negozi attivi: dopo, a un visitatore sarebbe tornata la frase fissa
 *    «100% venditori locali verificati», a un negoziante «1 negozio locale attivo» (la sua riga);
 *  · /u/<handle> leggeva il profilo pubblico col client pubblico: dopo, «pagina non trovata» per
 *    tutti, anche per chi il profilo pubblico l'ha acceso.
 *
 * Qui si compilano ed ESEGUONO i file veri delle due pagine. Il client che la pagina si crea —
 * quello coi cookie per «Chi siamo», quello di servizio per /u/ — e' il finto database che
 * applica le regole di chi guarda, nei due mondi: oggi e dopo le migrazioni. Se una pagina torna a
 * leggere `profiles` con il client di chi guarda, nel mondo «dopo» la prova diventa rossa.
 *
 * Il client di servizio non guarda le regole: per /u/ si prova anche il contrario — chi il
 * profilo pubblico NON l'ha acceso resta «non trovato», e la pagina non chiede colonne che non
 * mostra.
 */

const PANE = 'n-pane';
const FIORI = 'n-fiori';
const SEGRETA = 'n-segreta';
const SENZA_INSEGNA = 'n-senza-insegna';
const MARIA = 'u-maria';
const LUCA = 'u-luca';

function dati(): Dati {
  return {
    profiles: [
      { id: PANE, role: 'seller', is_approved: true, store_name: 'Pane Quotidiano', email: 'pane@example.it' },
      { id: FIORI, role: 'seller', is_approved: true, store_name: 'Fiori di Ada', email: 'fiori@example.it' },
      { id: SEGRETA, role: 'seller', is_approved: false, store_name: 'Bottega Segreta' },
      { id: SENZA_INSEGNA, role: 'seller', is_approved: true, store_name: null },
      {
        id: MARIA, role: 'buyer', is_approved: false, store_name: null, full_name: 'Maria Rossi',
        email: 'maria@example.it', billing_iban: 'IT60X0542811101000000123456',
        public_profile_enabled: true, public_handle: 'maria_pc', public_bio: 'Amo il pane buono', public_avatar_url: null,
      },
      {
        id: LUCA, role: 'buyer', is_approved: false, store_name: null, full_name: 'Luca Bianchi',
        email: 'luca@example.it', public_profile_enabled: false, public_handle: 'luca_privato', public_bio: 'Non voglio farmi vedere',
      },
    ],
    cms_pages: [],
    user_achievements: [],
  };
}

const MONDI: Array<[string, MondoVetrina]> = [[OGGI.nome, OGGI], [DOPO.nome, DOPO]];
const CHI: Array<[string, string | null]> = [['visitatore', null], ['negoziante', PANE], ['cliente', MARIA]];
const CASI = MONDI.flatMap(([m, mondo]) => CHI.map(([c, chi]) => [`${m} · ${c}`, mondo, chi] as const));

/** Il client che la pagina si crea, deciso dalla prova a ogni giro. */
const clientDellaPagina = vi.hoisted(() => ({ cookie: null as unknown, servizio: null as unknown }));

// «Chi siamo» si crea il client coi cookie di chi guarda (`getServerSupabase`).
vi.mock('@supabase/ssr', () => ({ createServerClient: () => clientDellaPagina.cookie }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));
// /u/ si crea il client di servizio (`getAdminSupabase`). Si tiene per tutto il processo, come il
// vero: per questo il finto rilegge il client della prova a ogni domanda.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (tabella: string) => (clientDellaPagina.servizio as { from: (t: string) => unknown }).from(tabella),
  }),
}));

type Elemento = { type?: unknown; props?: Record<string, unknown> } | null | undefined | string | number | boolean;
function testoDi(albero: Elemento): string {
  if (albero === null || albero === undefined || typeof albero === 'boolean') return '';
  if (typeof albero === 'string' || typeof albero === 'number') return String(albero);
  if (Array.isArray(albero)) return albero.map((x) => testoDi(x as Elemento)).join(' ');
  return testoDi((albero.props ?? {}).children as Elemento);
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://finto.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'chiave-pubblica-finta');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'chiave-di-servizio-finta');
});
afterEach(() => {
  vi.unstubAllEnvs();
  clientDellaPagina.cookie = null;
  clientDellaPagina.servizio = null;
  delete (globalThis as Record<string, unknown>).__CLIENT_ANONIMO__;
});

describe('«Chi siamo» conta i negozi attivi', () => {
  it.each(CASI)('due negozi approvati con insegna, per chiunque guardi — %s', async (_n, mondo, chi) => {
    const db = databaseDellaVetrina(dati(), mondo, chi);
    clientDellaPagina.cookie = db.client;
    const pagina = (await monta('app/about/page.tsx')).default as () => Promise<Elemento>;

    const testo = testoDi(await pagina());

    expect(testo, 'il conteggio dei negozi non arriva dalla vista pubblica').toContain('2 negozi locali attivi');
    expect(testo).not.toContain('venditori locali verificati');
    expect(db.letture.map((l) => l.tabella), 'conta ancora sulla tabella dei profili').not.toContain('profiles');
  });
});

describe('il profilo pubblico /u/<handle>', () => {
  async function apri(handle: string, mondo: MondoVetrina) {
    const servizio = databaseDellaVetrina(dati(), mondo, null, { servizio: true });
    clientDellaPagina.servizio = servizio.client;
    // Il client pubblico della pagina vede il mondo come lo vede un visitatore senza account.
    (globalThis as Record<string, unknown>).__CLIENT_ANONIMO__ = databaseDellaVetrina(dati(), mondo, null).client;
    const modulo = await monta('app/u/[handle]/page.tsx');
    const generaMetadati = modulo.generateMetadata as (p: { params: Promise<{ handle: string }> }) => Promise<{ title?: string; description?: string }>;
    const pagina = modulo.default as (p: { params: Promise<{ handle: string }> }) => Promise<Elemento>;
    const metadati = await generaMetadati({ params: Promise.resolve({ handle }) });
    return { metadati, pagina: () => pagina({ params: Promise.resolve({ handle }) }), servizio };
  }

  it.each(MONDI)('chi ha acceso il profilo pubblico si trova — %s', async (_n, mondo) => {
    const { metadati, pagina } = await apri('maria_pc', mondo);

    expect(metadati.title, 'il profilo pubblico risponde «non trovato»').toBe('@maria_pc · Maria · MyCity');
    const testo = testoDi(await pagina());
    expect(testo).toContain('maria_pc');
    expect(testo).toContain('Maria Rossi');
    expect(testo).toContain('Amo il pane buono');
  });

  it.each(MONDI)('chi NON ha acceso il profilo pubblico resta «non trovato», anche col client di servizio — %s', async (_n, mondo) => {
    const { metadati } = await apri('luca_privato', mondo);

    expect(metadati.title, 'il client di servizio mostra un profilo che la persona non ha reso pubblico').toBe('Profilo non trovato · MyCity');
  });

  it('la pagina chiede alla tabella solo le colonne che mostra', async () => {
    const { pagina, servizio } = await apri('maria_pc', DOPO);
    const testo = testoDi(await pagina());

    const chieste = servizio.letture
      .filter((l) => l.tabella === 'profiles')
      .flatMap((l) => l.colonne.split(',').map((c) => c.trim()));
    expect(chieste.length, 'la pagina non ha letto il profilo col client di servizio').toBeGreaterThan(0);
    expect(
      chieste.filter((c) => !['id', 'public_handle', 'public_bio', 'public_avatar_url', 'full_name'].includes(c)),
      'il client di servizio chiede colonne che la pagina non mostra',
    ).toEqual([]);
    for (const privato of ['maria@example.it', 'IT60X0542811101000000123456']) {
      expect(testo, `la pagina pubblica mostra ${privato}`).not.toContain(privato);
    }
  });
});
