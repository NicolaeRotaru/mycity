/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import CartCrossDeviceSync from '@/components/CartCrossDeviceSync';
import { addToCart, getCart, removeFromCart, CART_UPDATED_AT_KEY } from '@/lib/cart';
import { accendi } from './aiuti/schermo';

/**
 * R17-009 — Il carrello si riempiva di nuovo con la spesa già tolta (o già pagata) quando si usano due
 * dispositivi. Il telefono toglie la torta e la manda sul cloud; il computer, col carrello vecchio e
 * mai toccato dopo l'ultimo allineamento, si apre: prima si fondeva «con la quantità più alta», la
 * torta tornava nel carrello e poi di nuovo sul cloud. Qui due dispositivi veri (la sincronizzazione
 * vera, due localStorage) contro un cloud finto che tiene la riga come il database.
 */

type Riga = { items: unknown[]; updated_at: string };
const db = vi.hoisted(() => ({
  riga: null as null | { items: unknown[]; updated_at: string },
  scritture: [] as Array<{ items: unknown[]; updated_at: string }>,
  ritardo: null as null | Promise<void>,
}));

vi.mock('@/components/hooks/useUtente', () => ({ idUtenteInMemoria: async () => 'anna' }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: db.riga ? { ...db.riga, items: [...db.riga.items] } : null, error: null });
      q.upsert = async (r: { items: unknown[]; updated_at: string }) => {
        if (db.ritardo) await db.ritardo;
        db.scritture.push({ items: r.items, updated_at: r.updated_at });
        db.riga = { items: r.items, updated_at: r.updated_at };
        return { error: null };
      };
      return q;
    },
  },
}));

const PANE = { id: 'pane', name: 'Pane', price: 3 };
const TORTA = { id: 'torta', name: 'Torta', price: 18 };
const LATTE = { id: 'latte', name: 'Latte', price: 2 };

/** Il localStorage di ogni dispositivo, rimesso al suo posto quando il dispositivo si apre. */
type Dispositivo = Record<string, string>;
function salva(): Dispositivo {
  const d: Dispositivo = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    d[k] = localStorage.getItem(k)!;
  }
  return d;
}
function rimetti(d: Dispositivo) {
  localStorage.clear();
  for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v);
}

async function gira(volte = 20) {
  for (let i = 0; i < volte; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** Apre il sito sul dispositivo, aspetta la sincronizzazione (e l'invio dopo un cambio), lo chiude. */
async function apri(d: Dispositivo, gesto?: () => void): Promise<Dispositivo> {
  rimetti(d);
  const s = accendi(CartCrossDeviceSync);
  await gira();
  if (gesto) {
    gesto();
    await act(async () => { vi.advanceTimersByTime(1100); });
    await gira();
  }
  s.smonta();
  return salva();
}

const ids = () => getCart().map((r) => r.id).sort();

describe('R17-009 · la spesa tolta su un dispositivo non torna dall altro', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-11-25T20:00:00Z'));
    localStorage.clear();
    db.riga = null;
    db.scritture = [];
    db.ritardo = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('IL CASO: il telefono toglie la torta; il computer, col carrello vecchio, si apre e la torta non torna', async () => {
    // Sera: Anna riempie il carrello dal computer, che lo manda sul cloud.
    let computer = await apri({}, () => { addToCart({ ...PANE, quantity: 2 }); addToCart(TORTA); });
    expect(db.riga?.items.map((r) => (r as { id: string }).id).sort()).toEqual(['pane', 'torta']);
    // Il telefono si apre: scarica il carrello del cloud.
    vi.setSystemTime(new Date('2026-11-26T08:00:00Z'));
    let telefono = await apri({});
    expect(ids()).toEqual(['pane', 'torta']);
    // Sul telefono toglie la torta: il cloud resta col solo pane.
    vi.setSystemTime(new Date('2026-11-26T08:05:00Z'));
    telefono = await apri(telefono, () => removeFromCart('torta'));
    expect(db.riga?.items.map((r) => (r as { id: string }).id)).toEqual(['pane']);
    // La sera riapre il computer, che non ha toccato il carrello da ieri.
    vi.setSystemTime(new Date('2026-11-26T19:00:00Z'));
    computer = await apri(computer);
    expect(ids(), 'la torta tolta dal telefono è tornata nel carrello del computer').toEqual(['pane']);
    expect(db.riga?.items.map((r) => (r as { id: string }).id), 'la torta è tornata sul cloud').toEqual(['pane']);
    // E riaprendo il telefono la torta non ricompare.
    vi.setSystemTime(new Date('2026-11-26T19:10:00Z'));
    telefono = await apri(telefono);
    expect(ids()).toEqual(['pane']);
  });

  it('una quantità abbassata sull altro dispositivo non risale', async () => {
    let computer = await apri({}, () => addToCart({ ...PANE, quantity: 5 }));
    vi.setSystemTime(new Date('2026-11-26T08:00:00Z'));
    let telefono = await apri({});
    vi.setSystemTime(new Date('2026-11-26T08:05:00Z'));
    telefono = await apri(telefono, () => { removeFromCart('pane'); addToCart({ ...PANE, quantity: 1 }); });
    vi.setSystemTime(new Date('2026-11-26T19:00:00Z'));
    computer = await apri(computer);
    expect(getCart().map((r) => [r.id, r.quantity])).toEqual([['pane', 1]]);
    void telefono;
  });

  it('se anche il computer ha cambiato il carrello dopo l ultimo allineamento, niente si butta: si fondono', async () => {
    let computer = await apri({}, () => { addToCart(PANE); addToCart(TORTA); });
    vi.setSystemTime(new Date('2026-11-26T08:00:00Z'));
    let telefono = await apri({});
    vi.setSystemTime(new Date('2026-11-26T08:05:00Z'));
    telefono = await apri(telefono, () => removeFromCart('torta'));
    // Sul computer, senza rete, aggiunge il latte: il cambio resta solo nel suo carrello.
    rimetti(computer);
    addToCart(LATTE);
    computer = salva();
    vi.setSystemTime(new Date('2026-11-26T19:00:00Z'));
    computer = await apri(computer);
    expect(ids()).toContain('latte');
    expect(ids()).toContain('pane');
    void telefono;
  });

  it('un prodotto aggiunto mentre l invio è in volo non viene coperto dal cloud', async () => {
    let computer = await apri({}, () => addToCart(PANE));
    vi.setSystemTime(new Date('2026-11-26T08:00:00Z'));
    let telefono = await apri({});
    // Il telefono manda su un cambio, e la risposta tarda: intanto si aggiunge la torta.
    let sblocca!: () => void;
    db.ritardo = new Promise<void>((r) => { sblocca = r; });
    rimetti(telefono);
    const s = accendi(CartCrossDeviceSync);
    await gira();
    addToCart(LATTE);
    await act(async () => { vi.advanceTimersByTime(1100); });
    await gira(3);
    vi.setSystemTime(new Date('2026-11-26T08:00:05Z'));
    addToCart(TORTA);
    sblocca();
    db.ritardo = null;
    await gira();
    s.smonta();
    telefono = salva();
    // Un altro dispositivo cambia il cloud prima che il telefono mandi la torta.
    db.riga = { items: [{ ...PANE, quantity: 3 }, { ...LATTE, quantity: 1 }], updated_at: '2026-11-26T08:30:00.000Z' } as Riga;
    vi.setSystemTime(new Date('2026-11-26T09:00:00Z'));
    telefono = await apri(telefono);
    expect(ids(), 'la torta aggiunta durante l invio è sparita').toContain('torta');
    void computer;
  });

  it('l ora del telefono torna indietro: il prodotto aggiunto dopo non viene coperto dal cloud', async () => {
    const computer = await apri({}, () => addToCart(PANE));
    vi.setSystemTime(new Date('2026-11-26T08:00:00Z'));
    let telefono = await apri({});
    // L'ora del telefono viene corretta indietro di un'ora; senza rete si aggiunge la torta.
    rimetti(telefono);
    vi.setSystemTime(new Date('2026-11-26T07:00:00Z'));
    addToCart(TORTA);
    telefono = salva();
    // Intanto un altro dispositivo cambia il cloud.
    db.riga = { items: [{ ...PANE, quantity: 2 }], updated_at: '2026-11-26T08:30:00.000Z' };
    vi.setSystemTime(new Date('2026-11-26T07:10:00Z'));
    telefono = await apri(telefono);
    expect(ids(), 'la torta aggiunta con l ora indietro è sparita').toContain('torta');
    void computer;
  });

  it('una chiave vecchia (solo un numero) segue ancora la regola di prima: il cloud svuotato dopo svuota il locale', async () => {
    localStorage.setItem('cart', JSON.stringify([{ ...PANE, quantity: 2 }]));
    localStorage.setItem(CART_UPDATED_AT_KEY, String(Date.parse('2026-11-25T20:00:00Z')));
    localStorage.setItem('mc_cart_synced_at', String(Date.parse('2026-11-25T20:00:00Z')));
    db.riga = { items: [], updated_at: '2026-11-26T08:00:00.000Z' };
    await apri(salva());
    expect(getCart()).toEqual([]);
    expect(db.scritture).toHaveLength(0);
  });
});
