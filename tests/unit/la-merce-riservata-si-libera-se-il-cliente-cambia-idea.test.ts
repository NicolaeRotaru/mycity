import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liberaRiserveAbbandonate, type ClientRiserve } from '@/lib/ordini/riserve-abbandonate';

/**
 * L'ULTIMO PEZZO RESTAVA «ESAURITO» PER DUE ORE, A CHI LO AVEVA RISERVATO LUI.
 *
 * Sabato alle 11 Luca vuole l'ultima torta. Preme «Paga con carta»: il server
 * scala la merce e apre la pagina di Stripe. Sulla pagina ci ripensa e torna
 * indietro per pagare alla consegna — oppure per cambiare la fascia. Stripe non
 * avvisa nessuno, la riserva vive due ore, e il secondo tentativo trova zero
 * pezzi: «Stock insufficiente per Torta (0 disponibili)». La torta resta
 * invenduta fino alle 13, anche per gli altri clienti.
 *
 * Qui la funzione si ESEGUE con un database finto, e si guarda cosa chiama.
 */

type Esito = { data: unknown[] | null; error?: { message: string } | null };
type Op = { tavola: string; tipo: 'select' | 'update'; valori?: Record<string, unknown> };

interface Catena {
  select: (colonne?: string) => Catena;
  update: (valori: Record<string, unknown>) => Catena;
  eq: (colonna: string, valore: unknown) => Catena;
  in: (colonna: string, valori: unknown[]) => Catena;
  limit: (n: number) => Catena;
  then: <R>(risolvi: (e: Esito) => R) => Promise<R>;
}

function fintoDatabase(risposte: {
  pending?: unknown[];
  ordini?: unknown[];
  rivendicati?: unknown[];
  erroreLettura?: { message: string };
  erroreOrdini?: { message: string };
}) {
  const ops: Op[] = [];
  const chiamate: Array<{ nome: string; args: Record<string, unknown> }> = [];

  const rispostaPer = (op: Op): Esito => {
    if (op.tavola === 'orders') {
      return { data: risposte.ordini ?? [], error: risposte.erroreOrdini ?? null };
    }
    if (op.tipo === 'update') return { data: risposte.rivendicati ?? [{ id: 'p1' }], error: null };
    return { data: risposte.pending ?? [], error: risposte.erroreLettura ?? null };
  };

  const client = {
    from(tavola: string): Catena {
      const op: Op = { tavola, tipo: 'select' };
      const c: Catena = {
        select: () => c,
        update: (valori) => { op.tipo = 'update'; op.valori = valori; return c; },
        eq: () => c,
        in: () => c,
        limit: () => c,
        then: (risolvi) => { ops.push(op); return Promise.resolve(rispostaPer(op)).then(risolvi); },
      };
      return c;
    },
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chiamate.push({ nome, args });
      return { error: null };
    },
  };

  return { admin: client as unknown as ClientRiserve, ops, chiamate };
}

const tentativoAbbandonato = {
  id: 'p1',
  groups: [{ items: [{ productId: 'torta', quantity: 1, variantId: null }] }],
  coupon_code: 'BENVENUTO5',
  stripe_session_id: 'cs_vecchia',
  delivery: { impronta_carrello: 'carrello-con-fascia-oggi' },
};

describe('un secondo tentativo dello stesso cliente chiude il primo', () => {
  it('rimette in vendita la merce, restituisce il codice e chiude il pagamento vecchio', async () => {
    const { admin, chiamate } = fintoDatabase({ pending: [tentativoAbbandonato] });
    const chiuse: string[] = [];

    const esito = await liberaRiserveAbbandonate(admin, {
      buyerId: 'luca',
      improntaDaTenere: 'carrello-con-fascia-domani',
      soloConProdotti: ['torta'],
      chiudiSessione: async (id) => { chiuse.push(id); },
    });

    expect(esito.liberati).toEqual(['p1']);
    expect(chiamate.find((c) => c.nome === 'restore_stock')?.args).toEqual({
      p_items: [{ product_id: 'torta', variant_id: null, qty: 1 }],
    });
    expect(chiamate.find((c) => c.nome === 'release_coupon')?.args).toEqual({ p_code: 'BENVENUTO5' });
    expect(chiuse).toEqual(['cs_vecchia']);
  });

  it('lo stesso identico carrello NON si tocca: quella sessione si riusa', async () => {
    const { admin, chiamate } = fintoDatabase({ pending: [tentativoAbbandonato] });
    const esito = await liberaRiserveAbbandonate(admin, {
      buyerId: 'luca',
      improntaDaTenere: 'carrello-con-fascia-oggi',
      soloConProdotti: ['torta'],
    });
    expect(esito.liberati).toEqual([]);
    expect(chiamate).toEqual([]);
  });

  it('un carrello che non c’entra con questo acquisto resta in piedi', async () => {
    const { admin, chiamate } = fintoDatabase({ pending: [tentativoAbbandonato] });
    const esito = await liberaRiserveAbbandonate(admin, {
      buyerId: 'luca',
      improntaDaTenere: 'altro',
      soloConProdotti: ['pane'],
    });
    expect(esito.liberati).toEqual([]);
    expect(chiamate).toEqual([]);
  });
});

describe('le tre cautele: non si rimette a scaffale merce già venduta', () => {
  it('tentativo che ha già degli ordini → non si tocca niente', async () => {
    const { admin, chiamate } = fintoDatabase({
      pending: [tentativoAbbandonato],
      ordini: [{ stripe_session_id: 'cs_vecchia' }],
    });
    const esito = await liberaRiserveAbbandonate(admin, { buyerId: 'luca', improntaDaTenere: 'altro' });
    expect(esito.liberati).toEqual([]);
    expect(chiamate).toEqual([]);
  });

  it('riga già presa da altri (lavoro periodico o avviso di Stripe) → nessun doppio ripristino', async () => {
    const { admin, chiamate } = fintoDatabase({ pending: [tentativoAbbandonato], rivendicati: [] });
    const esito = await liberaRiserveAbbandonate(admin, { buyerId: 'luca', improntaDaTenere: 'altro' });
    expect(esito.liberati).toEqual([]);
    expect(chiamate).toEqual([]);
  });

  it('se la lettura degli ordini non riesce, non si libera niente', async () => {
    const { admin, chiamate } = fintoDatabase({
      pending: [tentativoAbbandonato],
      erroreOrdini: { message: 'rete' },
    });
    const esito = await liberaRiserveAbbandonate(admin, { buyerId: 'luca', improntaDaTenere: 'altro' });
    expect(esito.liberati).toEqual([]);
    expect(chiamate).toEqual([]);
  });

  it('se la lettura dei tentativi non riesce, l’acquisto va avanti lo stesso', async () => {
    const { admin } = fintoDatabase({ erroreLettura: { message: 'rete' } });
    const esito = await liberaRiserveAbbandonate(admin, { buyerId: 'luca' });
    expect(esito.liberati).toEqual([]);
  });
});

describe('le due rotte liberano PRIMA di guardare le disponibilità', () => {
  const radice = process.cwd();

  it('la rotta con la carta libera prima di riservare', () => {
    const src = readFileSync(join(radice, 'app/api/stripe/checkout/route.ts'), 'utf8');
    const libera = src.indexOf('liberaRiserveAbbandonate(');
    const riserva = src.indexOf("rpc('reserve_stock'");
    expect(libera, 'la rotta con la carta non libera piu i tentativi abbandonati').toBeGreaterThan(0);
    expect(libera).toBeLessThan(riserva);
  });

  it('la rotta dei contanti libera prima di leggere i prodotti', () => {
    const src = readFileSync(join(radice, 'app/api/orders/cod/route.ts'), 'utf8');
    const libera = src.indexOf('liberaRiserveAbbandonate(');
    const leggeProdotti = src.indexOf(".from('products')");
    expect(libera, 'la rotta dei contanti non libera piu i tentativi abbandonati').toBeGreaterThan(0);
    // Liberare dopo la lettura non servirebbe a niente: il numero in mano
    // sarebbe già quello vecchio, e il cliente leggerebbe «0 disponibili».
    expect(libera).toBeLessThan(leggeProdotti);
  });
});
