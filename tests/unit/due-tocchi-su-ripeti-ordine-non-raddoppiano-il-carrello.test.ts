/**
 * 3/9/2026 — DUE TOCCHI SU «RIPETI ORDINE» METTEVANO NEL CARRELLO IL DOPPIO DELLA ROBA.
 *
 * Prima di aggiungere, `riordina` rilegge i prezzi di adesso sul database. Su un telefono lento
 * sono qualche decimo di secondo in cui sullo schermo non succede niente: chi tocca una seconda
 * volta faceva partire un secondo giro, e il carrello somma. Maria riordinava due focacce da Pane
 * Quotidiano e ne trovava quattro.
 *
 * La prova non guarda il pulsante: guarda il CARRELLO. Il carrello finto qui sotto somma le
 * quantità esattamente come quello vero (`lib/cart.ts`, `addToCart`), quindi se la guardia salta il
 * numero raddoppia e questa prova diventa rossa.
 *
 * Due tempi, perché il doppio tocco arriva in due modi: il secondo tocco mentre il primo lavora, e
 * il secondo tocco subito dopo che il primo ha finito.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type RigaCarrello = { id: string; name: string; price: number; quantity: number };

const stato = vi.hoisted(() => ({
  carrello: [] as RigaCarrello[],
  svuotamenti: 0,
  /** 'subito' = il database risponde all'istante; 'ferma' = risponde quando lo dico io. */
  lettura: 'subito' as 'subito' | 'ferma',
  /** Cosa risponde la finestra «hai già qualcosa nel carrello». */
  risposta: 'aggiungi' as 'aggiungi' | 'sostituisci',
  sblocca: null as null | (() => void),
}));

vi.mock('@/lib/cart', () => ({
  getCart: () => stato.carrello,
  clearCart: () => { stato.svuotamenti += 1; stato.carrello = []; },
  // Somma alla quantità già presente, come quello vero: è il punto in cui nasceva il doppio.
  addToCart: (item: { id: string; name: string; price: number; quantity?: number }) => {
    const esistente = stato.carrello.find((r) => r.id === item.id);
    if (esistente) esistente.quantity += item.quantity ?? 1;
    else stato.carrello.push({ ...item, quantity: item.quantity ?? 1 });
  },
}));

vi.mock('@/components/ConfirmDialog', () => ({
  confirmDialog: () => Promise.resolve(stato.risposta === 'sostituisci'),
}));

vi.mock('sonner', () => ({
  toast: { success: () => {}, error: () => {} },
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: () => (stato.lettura === 'subito'
          ? Promise.resolve({ data: [] })
          : new Promise((res) => { stato.sblocca = () => res({ data: [] }); })),
      }),
    }),
  },
}));

/** Ogni prova riparte da un modulo pulito: la guardia vive nel modulo. */
async function caricaRiordino() {
  vi.resetModules();
  return import('@/lib/riordino');
}

/** Aspetta che la lettura dei prezzi sia partita davvero (l'import è asincrono). */
async function attendiLettura() {
  for (let i = 0; i < 100 && !stato.sblocca; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
  }
  if (!stato.sblocca) throw new Error('la lettura dei prezzi non è mai partita: la prova non misura niente');
}

const focacce = (quantita: number) => [{
  productId: 'p-focaccia', name: 'Focaccia', quantity: quantita, prezzoStorico: 3.5,
}];

const quantitaDi = (id: string) => stato.carrello.find((r) => r.id === id)?.quantity ?? 0;

beforeEach(() => {
  stato.carrello = [];
  stato.svuotamenti = 0;
  stato.lettura = 'subito';
  stato.risposta = 'aggiungi';
  stato.sblocca = null;
});

describe('la decisione «è lo stesso tocco?», da sola', () => {
  it('lo stesso riordino ripetuto subito è un dito che ha toccato due volte', async () => {
    const { eUnDoppioTocco, FINESTRA_DOPPIO_TOCCO_MS } = await caricaRiordino();
    const prima = { impronta: 'due-focacce', quando: 1_000_000 };

    expect(eUnDoppioTocco('due-focacce', prima, 1_000_200)).toBe(true);
    expect(eUnDoppioTocco('due-focacce', prima, 1_000_000 + FINESTRA_DOPPIO_TOCCO_MS)).toBe(false);
    expect(eUnDoppioTocco('un-altro-ordine', prima, 1_000_200)).toBe(false);
    expect(eUnDoppioTocco('due-focacce', null, 1_000_200)).toBe(false);
  });
});

describe('«Ripeti ordine» toccato due volte', () => {
  it('il secondo tocco arriva mentre il primo legge i prezzi: nel carrello restano due focacce, non quattro', async () => {
    const { riordina } = await caricaRiordino();
    stato.lettura = 'ferma';

    const primo = riordina(focacce(2));
    const secondo = riordina(focacce(2)); // il dito tocca di nuovo: sullo schermo non è successo niente

    await attendiLettura();
    stato.sblocca!(); // adesso il database risponde
    const [aggiuntiPrimo, aggiuntiSecondo] = await Promise.all([primo, secondo]);

    expect(quantitaDi('p-focaccia'), 'il carrello ha il doppio della roba').toBe(2);
    expect(aggiuntiPrimo).toBe(1);
    expect(aggiuntiSecondo, 'il secondo tocco non deve aggiungere niente').toBe(0);
  });

  it('il secondo tocco arriva subito dopo la fine del primo: il carrello non raddoppia', async () => {
    const { riordina } = await caricaRiordino();

    expect(await riordina(focacce(2))).toBe(1);
    expect(await riordina(focacce(2)), 'il secondo tocco non deve aggiungere niente').toBe(0);

    expect(quantitaDi('p-focaccia'), 'il carrello ha il doppio della roba').toBe(2);
  });

  it('non svuota il carrello una seconda volta: chi aveva scelto «sostituisci» non perde altro', async () => {
    const { riordina } = await caricaRiordino();
    stato.carrello = [{ id: 'p-latte', name: 'Latte', price: 1.4, quantity: 1 }];
    stato.risposta = 'sostituisci';

    await riordina(focacce(2));
    await riordina(focacce(2));

    expect(stato.svuotamenti).toBe(1);
  });
});

describe('la guardia non blocca quello che è davvero un altro riordino', () => {
  it('un ordine diverso, toccato subito dopo, entra nel carrello', async () => {
    const { riordina } = await caricaRiordino();

    await riordina(focacce(2));
    const aggiunti = await riordina([{ productId: 'p-pane', name: 'Pane', quantity: 1, prezzoStorico: 2 }]);

    expect(aggiunti).toBe(1);
    expect(quantitaDi('p-pane')).toBe(1);
    expect(quantitaDi('p-focaccia')).toBe(2);
  });

  it('lo stesso ordine con quantità diverse è un riordino diverso', async () => {
    const { riordina } = await caricaRiordino();

    await riordina(focacce(2));
    const aggiunti = await riordina(focacce(3));

    expect(aggiunti).toBe(1);
    expect(quantitaDi('p-focaccia')).toBe(5);
  });
});
