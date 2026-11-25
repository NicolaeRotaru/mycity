/**
 * @vitest-environment jsdom
 */
/**
 * 25/11/2026 — Terzo collaudo dei più account (lib/account/piu-account.ts): con «Aggiungi un altro
 * account» la spesa del primo account finiva nel carrello del secondo, anche sul server. La pagina di
 * accesso, con A ancora dentro, riscaricava il carrello di A nel browser; poi entrava B e la
 * sincronizzazione lo fondeva nel suo.
 *
 * Casi (dato → atteso), con la sincronizzazione VERA (components/CartCrossDeviceSync.tsx) e un
 * database finto che risponde come quello vero. Dal quarto collaudo la regola non dipende dalla strada
 * (Nicola: «rifai la base»): quando entra un altro account, la spesa nel browser va da parte per chi
 * c'era, prima di ogni fusione.
 *  · «Aggiungi», poi entra B → nessuna scrittura del carrello di B con la spesa di A;
 *  · un link dalla pagina di accesso e poi «indietro» (il segno dell'aggiunta si perde) → lo stesso;
 *  · carrello da ospite → si fonde nell'account che entra, come sempre;
 *  · senza più account → la sincronizzazione fa come prima.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const db = vi.hoisted(() => ({
  carrelli: {} as Record<string, { items: unknown[]; updated_at: string }>,
  scritture: [] as Array<{ user_id: string; items: unknown[] }>,
  utente: null as string | null,
  ascolto: null as null | ((evento: string, sessione: { user: { id: string } } | null) => void),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (f: (e: string, s: { user: { id: string } } | null) => void) => {
        db.ascolto = f;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      getSession: async () => ({ data: { session: db.utente ? { user: { id: db.utente } } : null } }),
    },
    from: () => {
      let chi = '';
      const q = {
        select: () => q,
        eq: (_c: string, v: string) => { chi = v; return q; },
        maybeSingle: async () => ({ data: db.carrelli[chi] ?? null, error: null }),
        upsert: async (riga: { user_id: string; items: unknown[]; updated_at: string }) => {
          db.scritture.push({ user_id: riga.user_id, items: riga.items });
          db.carrelli[riga.user_id] = { items: riga.items, updated_at: riga.updated_at };
          return { error: null };
        },
      };
      return q;
    },
  },
}));
vi.mock('@/components/hooks/useUtente', () => ({ idUtenteInMemoria: async () => db.utente }));
vi.mock('@/lib/cart', async (originale) => ({
  ...(await originale<typeof import('@/lib/cart')>()),
  // il carrello abbandonato parla col server: qui non serve
  syncAbandonedCart: async () => undefined,
}));

import CartCrossDeviceSync from '@/components/CartCrossDeviceSync';
import { CHIAVE_AGGIUNTA } from '@/lib/account/piu-account';

const SPESA_DI_A = [{ id: 'pane', quantity: 2 }];
const accesi: Root[] = [];

async function aspetta() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function monta() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  accesi.push(root);
  await act(async () => { root.render(createElement(CartCrossDeviceSync)); });
  await aspetta();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  db.carrelli = { a: { items: SPESA_DI_A, updated_at: new Date().toISOString() } };
  db.scritture = [];
  db.utente = 'a';
  db.ascolto = null;
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
});

describe('più account e il carrello: la spesa di un account non va mai a un altro', () => {
  it('«Aggiungi»: sulla pagina di accesso A ha il suo carrello; entra B e la spesa di A va da parte, non a B', async () => {
    sessionStorage.setItem(CHIAVE_AGGIUNTA, 'a');
    await monta();
    expect(JSON.parse(localStorage.getItem('cart') ?? '[]')).toEqual(SPESA_DI_A); // è ancora di A: va bene
    db.utente = 'b';
    await act(async () => { db.ascolto?.('SIGNED_IN', { user: { id: 'b' } }); });
    await aspetta();
    expect(db.scritture.filter((w) => w.user_id === 'b')).toEqual([]);
    expect(localStorage.getItem('cart')).toBeNull();
    expect(JSON.parse(localStorage.getItem('mycity:da-parte:a:cart') ?? 'null')).toEqual(SPESA_DI_A);
  });

  it('un link dalla pagina di accesso e poi «indietro» (segno dell aggiunta perso): B non riceve la spesa di A (quarto collaudo)', async () => {
    await monta(); // nessun segno di aggiunta
    expect(JSON.parse(localStorage.getItem('cart') ?? '[]')).toEqual(SPESA_DI_A);
    db.utente = 'b';
    await act(async () => { db.ascolto?.('SIGNED_IN', { user: { id: 'b' } }); });
    await aspetta();
    expect(db.scritture.filter((w) => w.user_id === 'b')).toEqual([]);
    expect(localStorage.getItem('cart')).toBeNull();
  });

  it('il carrello da ospite si fonde nell account che entra, come sempre', async () => {
    db.utente = null;
    localStorage.setItem('cart', JSON.stringify([{ id: 'latte', quantity: 1 }]));
    await monta();
    db.utente = 'b';
    await act(async () => { db.ascolto?.('SIGNED_IN', { user: { id: 'b' } }); });
    await aspetta();
    expect(db.scritture.filter((w) => w.user_id === 'b').map((w) => w.items)).toEqual([[{ id: 'latte', quantity: 1 }]]);
  });

  it('senza più account la sincronizzazione scarica il carrello come prima', async () => {
    await monta();
    expect(JSON.parse(localStorage.getItem('cart') ?? '[]').map((r: { id: string }) => r.id)).toEqual(['pane']);
  });
});
