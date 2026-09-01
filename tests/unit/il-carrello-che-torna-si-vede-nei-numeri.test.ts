/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/8/2026 (R164) — IL RECUPERO CARRELLI GIRAVA ALLA CIECA.
 *
 * `abandoned_carts` ha da sempre una colonna `recovered`, e la funzione che
 * sceglie chi ricontattare filtra su `recovered = false`. Ma `recovered = true`
 * non lo scriveva nessuno, in nessun punto del progetto: la colonna era nata e
 * rimasta a zero.
 *
 * Peggio: la riga spariva del tutto al momento dell'acquisto. A ordine fatto il
 * browser chiama `clearCart()`, che chiamava la copia sul server con il
 * carrello vuoto — e vuoto voleva dire CANCELLA. Il carrello recuperato si
 * cancellava nell'istante esatto in cui diventava una notizia.
 *
 * Costo: l'email «hai dimenticato qualcosa» è una delle poche leve di ricavo
 * già costruite, e non si poteva sapere quanto rendesse — quindi non si poteva
 * decidere se tenerla, cambiarla o spegnerla.
 *
 * Terzo effetto: il salvataggio non azzerava `recovery_email_sent_at`, e la
 * funzione di scelta pretende che sia NULL. Chi riceveva l'email e NON comprava
 * non ne riceveva mai più una, qualunque cosa mettesse nel carrello dopo.
 *
 * Questa prova non legge file: fa lavorare la copia sul server con un finto
 * database che si ricorda cosa gli è stato chiesto.
 */

type Chiamata = { tipo: 'update' | 'delete' | 'upsert'; valori?: Record<string, unknown> };

const chiamate: Chiamata[] = [];
let utente: { id: string } | null = { id: 'u1' };

function catena(tipo: Chiamata['tipo'], valori?: Record<string, unknown>) {
  chiamate.push({ tipo, valori });
  const c: Record<string, unknown> = {};
  for (const m of ['eq', 'lt', 'select', 'in', 'is']) c[m] = () => c;
  c.then = (risolvi: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(risolvi);
  return c;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: () => ({
      update: (v: Record<string, unknown>) => catena('update', v),
      delete: () => catena('delete'),
      upsert: (v: Record<string, unknown>) => catena('upsert', v),
    }),
    auth: {
      getSession: async () => ({ data: { session: utente ? { user: utente } : null }, error: null }),
    },
  },
}));

import { syncAbandonedCart } from '@/lib/cart-sync';

const RIGA = { id: 'p1', name: 'Focaccia', price: 4.5, quantity: 2, sellerId: 's1' };

beforeEach(() => {
  chiamate.length = 0;
  utente = { id: 'u1' };
});

describe('la copia del carrello sul server', () => {
  it('a ordine fatto la riga si MARCA come recuperata, non sparisce', async () => {
    await syncAbandonedCart([], { totale: 0, dopoUnOrdine: true });

    const cancellata = chiamate.find((c) => c.tipo === 'delete');
    expect(
      cancellata,
      'il carrello recuperato viene cancellato proprio quando diventa una notizia: la campagna resta non misurabile',
    ).toBeUndefined();

    const marcata = chiamate.find((c) => c.tipo === 'update');
    expect(marcata, 'nessuno scrive che quel carrello e tornato').toBeTruthy();
    expect(marcata?.valori?.recovered).toBe(true);
    expect(marcata?.valori?.recovered_at, 'recuperato senza sapere quando: non si puo misurare a quanti giorni arriva').toBeTruthy();
  });

  it('ma se e la persona a svuotare il carrello, la riga si cancella davvero', async () => {
    // Non e' un recupero: e' uno che ha cambiato idea. Segnarlo «recuperato»
    // gonfierebbe il risultato della campagna con acquisti mai avvenuti.
    await syncAbandonedCart([], { totale: 0 });
    expect(chiamate.find((c) => c.tipo === 'delete')).toBeTruthy();
    expect(chiamate.find((c) => c.tipo === 'update')).toBeUndefined();
  });

  it('un carrello con dentro roba diversa torna a poter ricevere l email', async () => {
    await syncAbandonedCart([RIGA], { totale: 9 });
    const salvata = chiamate.find((c) => c.tipo === 'upsert');
    expect(salvata).toBeTruthy();
    expect(
      salvata?.valori?.recovery_email_sent_at,
      'chi ha ricevuto l email una volta e non ha comprato non ne ricevera mai piu una, qualunque cosa metta nel carrello dopo',
    ).toBeNull();
    expect(salvata?.valori?.recovered).toBe(false);
    expect(salvata?.valori?.cart_total).toBe(9);
  });

  it('senza nessuno collegato non si tocca niente', async () => {
    utente = null;
    await syncAbandonedCart([RIGA], { totale: 9 });
    expect(chiamate).toHaveLength(0);
  });
});

/** `clearCart` non aspetta la copia sul server: qui le si da il tempo di finire. */
const respira = () => new Promise((r) => setTimeout(r, 0));

describe('svuotare il carrello dopo un ordine', () => {
  it('clearCart({ dopoUnOrdine: true }) marca, clearCart() cancella', async () => {
    localStorage.clear();
    const { clearCart } = await import('@/lib/cart');

    clearCart({ dopoUnOrdine: true });
    await respira();
    expect(chiamate.map((c) => c.tipo), 'dopo un ordine la riga viene cancellata').toContain('update');

    chiamate.length = 0;
    clearCart();
    await respira();
    expect(chiamate.map((c) => c.tipo)).toContain('delete');
  });
});
