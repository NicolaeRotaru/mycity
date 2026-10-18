/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, Suspense } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';
import { databaseDellaVetrina, OGGI, DOPO, type Dati, type MondoVetrina } from './aiuti/database-della-vetrina';

/**
 * 18/10/2026 — LE LISTE CURATE DICONO ANCORA CHI LE HA CREATE QUANDO LA TABELLA DEI PROFILI SI CHIUDE.
 *
 * `/lists` e `/lists/[id]` mostrano «@handle» di chi ha creato la lista, col link al suo profilo
 * pubblico. Lo agganciavano alla tabella `profiles` dal browser, grazie alla regola «chi ha il
 * profilo pubblico si legge da tutti» che le migrazioni 110 e 161 tolgono: dopo, ogni lista
 * avrebbe perso il suo autore.
 *
 * Adesso il browser lo chiede alla rotta `/api/profili-pubblici`, che legge col client di
 * servizio. Qui si montano le due pagine vere; la loro `fetch` arriva alla rotta VERA, e la rotta
 * legge da un database finto senza regole (come il client di servizio). Le letture del browser
 * girano invece contro lo stesso database con le regole di chi guarda, oggi e dopo le migrazioni.
 *
 * Il client di servizio non guarda le regole: per questo si prova anche quello che la rotta NON
 * deve dire — l'handle di chi il profilo pubblico non l'ha acceso, e ogni colonna oltre id e handle.
 */

const MARIA = 'a0000000-0000-4000-8000-000000000001';
const LUCA = 'a0000000-0000-4000-8000-000000000002';
const PANE = 'a0000000-0000-4000-8000-000000000003';
const ANNA = 'a0000000-0000-4000-8000-000000000004';

function dati(): Dati {
  return {
    profiles: [
      {
        id: MARIA, role: 'buyer', is_approved: false, store_name: null, full_name: 'Maria Rossi', email: 'maria@example.it',
        public_profile_enabled: true, public_handle: 'maria_pc', public_bio: 'Amo il pane buono',
      },
      {
        // Variante scomoda: l'handle c'e' ancora, ma il profilo pubblico e' spento.
        id: LUCA, role: 'buyer', is_approved: false, store_name: null, full_name: 'Luca Bianchi', email: 'luca@example.it',
        public_profile_enabled: false, public_handle: 'luca_privato',
      },
      { id: PANE, role: 'seller', is_approved: true, store_name: 'Pane Quotidiano', public_profile_enabled: false, public_handle: null },
      { id: ANNA, role: 'buyer', is_approved: false, store_name: null, full_name: 'Anna Verdi' },
    ],
    products: [
      { id: 'p-focaccia', name: 'Focaccia al rosmarino', description: null, price: 4.5, images: null, seller_id: PANE, status: 'available' },
    ],
    product_lists: [
      { id: 'l-maria', owner_id: MARIA, title: 'Colazione della domenica', description: null, cover_emoji: null, is_public: true, is_featured: true, updated_at: '2026-10-18T09:00:00Z' },
      { id: 'l-luca', owner_id: LUCA, title: 'Le cose di Luca', description: null, cover_emoji: null, is_public: true, is_featured: false, updated_at: '2026-10-17T09:00:00Z' },
      { id: 'l-pane', owner_id: PANE, title: 'Il meglio del forno', description: null, cover_emoji: null, is_public: true, is_featured: false, updated_at: '2026-10-16T09:00:00Z' },
    ],
    product_list_items: [
      { list_id: 'l-maria', product_id: 'p-focaccia', sort_order: 0, note: 'Sempre fresca' },
    ],
  };
}

const MONDI: Array<[string, MondoVetrina]> = [[OGGI.nome, OGGI], [DOPO.nome, DOPO]];
const CHI: Array<[string, string | null]> = [['visitatore', null], ['un\'altra cliente', ANNA], ['un negoziante', PANE]];
const CASI = MONDI.flatMap(([m, mondo]) => CHI.map(([c, chi]) => [`${m} · ${c}`, mondo, chi] as const));

/** Il client di servizio della rotta: lo decide la prova. */
const servizio = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => servizio.client }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { GET } from '@/app/api/profili-pubblici/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const globale = globalThis as Record<string, unknown>;
type Opzioni = { queryKey: readonly unknown[]; queryFn?: (c: unknown) => Promise<unknown>; enabled?: boolean };

const fetchDiPrima = globalThis.fetch;
let chiamateAllaRotta: string[] = [];

beforeEach(() => {
  __resetRateLimitBuckets();
  chiamateAllaRotta = [];
  // La `fetch` della pagina arriva alla rotta VERA, come in produzione arriva al server.
  globalThis.fetch = (async (indirizzo: string) => {
    chiamateAllaRotta.push(String(indirizzo));
    return GET(new Request(new URL(String(indirizzo), 'http://localhost').toString()));
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = fetchDiPrima;
  servizio.client = null;
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__', '__DATI_QUERY__']) delete globale[k];
  document.body.innerHTML = '';
});

async function aSchermo(
  file: string,
  props: Record<string, unknown>,
  mondo: MondoVetrina,
  chi: string | null,
  opzioni: { serverGuasto?: boolean } = {},
) {
  const componente = (await monta(file)).default;
  globale.__CLIENT_SUPABASE__ = databaseDellaVetrina(dati(), mondo, chi).client;
  servizio.client = databaseDellaVetrina(dati(), mondo, null, {
    servizio: true,
    tabellaGuasta: opzioni.serverGuasto ? 'profiles' : undefined,
  }).client;
  globale.__UTENTE__ = chi ? { id: chi } : null;

  const risposte = new Map<string, unknown>();
  const chieste = new Map<string, Opzioni>();
  globale.__DATI_QUERY__ = (o: Opzioni) => {
    const k = JSON.stringify(o.queryKey);
    if (!risposte.has(k)) chieste.set(k, o);
    return risposte.get(k);
  };
  const disegna = () => accendi(() => createElement(Suspense, { fallback: null }, createElement(componente as never, props)));
  for (let giro = 0; giro < 4; giro += 1) {
    const s = disegna();
    await attendi();
    s.smonta();
    const nuove = [...chieste.entries()].filter(([k]) => !risposte.has(k));
    if (nuove.length === 0) break;
    for (const [k, o] of nuove) {
      risposte.set(k, o.enabled === false || !o.queryFn ? undefined : await o.queryFn({ queryKey: o.queryKey, meta: undefined }));
    }
  }
  const s = disegna();
  await attendi();
  await attendi();
  const testo = testoVisibile(s.radice);
  const link = Array.from(s.radice.querySelectorAll('a')).map((a) => a.getAttribute('href'));
  s.smonta();
  return { testo, link };
}

describe('la pagina delle liste', () => {
  it.each(CASI)('ogni lista dice chi l\'ha creata, se ha il profilo pubblico — %s', async (_n, mondo, chi) => {
    const { testo } = await aSchermo('app/lists/page.tsx', {}, mondo, chi);

    expect(testo).toContain('Colazione della domenica');
    expect(testo, 'la lista ha perso l\'autore').toContain('@maria_pc');
    expect(testo).toContain('Le cose di Luca');
    expect(testo, 'compare l\'handle di chi il profilo pubblico l\'ha spento').not.toContain('luca_privato');
  });
});

describe('quando la rotta degli autori non risponde', () => {
  it('le liste si vedono lo stesso, senza «@handle»', async () => {
    const { testo } = await aSchermo('app/lists/page.tsx', {}, DOPO, null, { serverGuasto: true });

    expect(chiamateAllaRotta.length, 'la pagina non ha chiesto gli autori alla rotta').toBeGreaterThan(0);
    expect(testo, 'un guasto sugli autori ha svuotato la pagina delle liste').toContain('Colazione della domenica');
    expect(testo).toContain('Il meglio del forno');
    expect(testo).not.toContain('@');
  });
});

describe('la pagina di una lista', () => {
  it.each(CASI)('porta al profilo pubblico di chi l\'ha creata — %s', async (_n, mondo, chi) => {
    const { testo, link } = await aSchermo('app/lists/[id]/page.tsx', { params: Promise.resolve({ id: 'l-maria' }) }, mondo, chi);

    expect(testo).toContain('Colazione della domenica');
    expect(link, 'il dettaglio della lista non porta più al profilo dell\'autore').toContain('/u/maria_pc');
  });

  it.each(MONDI)('chi ha spento il profilo pubblico non si nomina — %s', async (_n, mondo) => {
    const { testo, link } = await aSchermo('app/lists/[id]/page.tsx', { params: Promise.resolve({ id: 'l-luca' }) }, mondo, null);

    expect(testo).toContain('Le cose di Luca');
    expect(testo).not.toContain('luca_privato');
    expect(link).not.toContain('/u/luca_privato');
  });
});

describe('la rotta /api/profili-pubblici', () => {
  async function chiedi(query: string) {
    servizio.client = databaseDellaVetrina(dati(), DOPO, null, { servizio: true }).client;
    const r = await GET(new Request(`http://localhost/api/profili-pubblici?${query}`));
    return { stato: r.status, corpo: (await r.json()) as { ok: boolean; data?: unknown } };
  }

  it('dice solo id e handle, e solo di chi ha acceso il profilo pubblico', async () => {
    const { stato, corpo } = await chiedi(`id=${MARIA}&id=${LUCA}&id=${PANE}&id=${ANNA}`);

    expect(stato).toBe(200);
    expect(corpo.data).toEqual([{ id: MARIA, public_handle: 'maria_pc' }]);
  });

  it('al database chiede solo id e handle, col filtro sul profilo pubblico', async () => {
    const db = databaseDellaVetrina(dati(), DOPO, null, { servizio: true });
    servizio.client = db.client;
    await GET(new Request(`http://localhost/api/profili-pubblici?id=${MARIA}`));

    expect(db.letture).toEqual([{ tabella: 'profiles', colonne: 'id, public_handle' }]);
  });

  it.each([
    ['nessun id', ''],
    ['un id scritto male', 'id=maria'],
    ['troppi id', Array.from({ length: 51 }, (_, i) => `id=a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join('&')],
  ])('rifiuta la domanda con %s', async (_n, query) => {
    const { stato, corpo } = await chiedi(query);

    expect(stato).toBe(400);
    expect(corpo.ok).toBe(false);
  });

  it('chi chiede a raffica viene fermato', async () => {
    let ultimo = 0;
    for (let i = 0; i < 121; i += 1) ultimo = (await chiedi(`id=${MARIA}`)).stato;
    expect(ultimo).toBe(429);
  });
});

/**
 * Riesame del lotto, 18/10/2026: le liste aspettavano l'autore senza un tetto di tempo. Una rotta
 * lenta teneva le liste in caricamento. Adesso, passato il tetto, le liste arrivano senza «@handle».
 */
describe('quando la rotta degli autori e lenta', () => {
  const LISTE = [{ id: 'l1', owner_id: MARIA, title: 'Colazione della domenica' }];

  it('una rotta che non risponde mai, ma si lascia interrompere: le liste arrivano dopo il tetto, senza autore', async () => {
    const { conAutoriPubblici } = await import('@/lib/queries/profili-pubblici');
    let interrotta = false;
    const lenta = ((_u: string, init?: RequestInit) =>
      new Promise((_r, rifiuta) => {
        init?.signal?.addEventListener('abort', () => {
          interrotta = true;
          rifiuta(new DOMException('interrotta', 'AbortError'));
        });
      })) as unknown as typeof fetch;
    const inizio = performance.now();
    const liste = await conAutoriPubblici(LISTE, lenta, 50);
    expect(performance.now() - inizio, 'le liste hanno aspettato oltre il tetto').toBeLessThan(2000);
    expect(liste).toEqual([{ ...LISTE[0], owner: null }]);
    expect(interrotta, 'la domanda alla rotta non e stata interrotta').toBe(true);
  });

  it('una rotta che non risponde mai e ignora l interruzione: le liste arrivano lo stesso', async () => {
    const { conAutoriPubblici } = await import('@/lib/queries/profili-pubblici');
    const sorda = (() => new Promise(() => {})) as unknown as typeof fetch;
    const liste = await conAutoriPubblici(LISTE, sorda, 50);
    expect(liste).toEqual([{ ...LISTE[0], owner: null }]);
  });

  it('il tetto di attesa e di pochi secondi', async () => {
    const { ATTESA_MASSIMA_AUTORI_MS } = await import('@/lib/queries/profili-pubblici');
    expect(ATTESA_MASSIMA_AUTORI_MS).toBeGreaterThan(0);
    expect(ATTESA_MASSIMA_AUTORI_MS).toBeLessThanOrEqual(5000);
  });
});

