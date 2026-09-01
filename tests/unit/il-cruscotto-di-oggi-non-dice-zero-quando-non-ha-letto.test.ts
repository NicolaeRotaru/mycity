/**
 * @vitest-environment jsdom
 */
/**
 * 27/8/2026 (R162) — IL CRUSCOTTO «OGGI» DELL'AMMINISTRAZIONE DICEVA ZERO
 * QUANDO NON ERA RIUSCITO A LEGGERE, E SI FERMAVA A MILLE ORDINI.
 *
 * È la prima pagina che si apre la mattina. Otto letture partivano insieme e
 * nessuna guardava se fosse andata a buon fine: i risultati si prendevano con
 * `?? []` e `?? 0`. Una lettura caduta usciva a schermo come «zero ordini, zero
 * incasso, zero iscritti» — cioè esattamente come una giornata in cui non ha
 * comprato nessuno. Chi guarda ci crede: o corre a cercare un guasto che non
 * c'è, o resta tranquillo mentre qualcosa è rotto davvero.
 *
 * Il secondo difetto è più subdolo perché arriva dopo. PostgREST risponde con
 * al massimo mille righe anche quando nessuno ha chiesto un limite, e nel
 * codice non c'era nessun numero: sembrava una lettura completa. Le tre letture
 * degli ordini contavano le righe che tornavano indietro, quindi dal
 * millesimo ordine della giornata in poi «Ordini oggi» e «GMV oggi» sarebbero
 * scesi da soli — proprio nel giorno in cui il numero comincia a contare.
 *
 * Il terzo: gli «ordini in problema» (NEW o ACCEPTED da più di quattro ore) non
 * avevano nessun limite indietro nel tempo. Contavano gli ordini fermi
 * dell'anno scorso insieme a quelli di stamattina, e chi legge la riga rossa
 * crede che siano tutti da lavorare adesso.
 *
 * Qui la lettura viene eseguita per davvero contro un finto PostgREST che si
 * comporta come quello vero nelle due cose che qui contano: taglia a mille
 * righe senza dirlo, e sa rispondere «quante ce ne sono» solo se glielo chiedi
 * con `count: 'exact'`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { leggiCruscottoOggi, GIORNI_DI_ORDINI_FERMI } from '@/lib/queries/cruscotto-oggi';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/** Il tetto che PostgREST applica da solo, in silenzio, a ogni lettura senza limite. */
const TETTO_SILENZIOSO = 1000;

type Riga = Record<string, unknown>;
type Guasto = { message: string } | null;

type Chiamata = {
  tabella: string;
  colonne: string;
  conteggioEsatto: boolean;
  soloTesta: boolean;
  filtri: Array<{ tipo: string; colonna: string; valore: unknown }>;
};

/**
 * Un finto PostgREST. I filtri li applica davvero sulle righe, e soprattutto
 * riproduce il modo in cui quello vero si rompe: senza `count: 'exact'` l'unico
 * numero che puoi avere è quante righe ti ha mandato, e le righe si fermano a
 * mille senza nessun avviso.
 */
function fintoDatabase(
  tabelle: Record<string, Riga[]>,
  guasto: (c: Chiamata) => Guasto = () => null,
) {
  const chiamate: Chiamata[] = [];

  class Query {
    private colonne = '*';
    private conteggio: string | null = null;
    private testa = false;
    private filtri: Chiamata['filtri'] = [];
    private da: number | null = null;
    private a: number | null = null;
    private tetto: number | null = null;
    constructor(private readonly tabella: string) {}

    select(colonne = '*', opzioni?: { count?: string; head?: boolean }) {
      this.colonne = colonne;
      this.conteggio = opzioni?.count ?? null;
      this.testa = opzioni?.head === true;
      return this;
    }
    private filtro(tipo: string, colonna: string, valore: unknown) {
      this.filtri.push({ tipo, colonna, valore });
      return this;
    }
    eq(c: string, v: unknown) { return this.filtro('eq', c, v); }
    neq(c: string, v: unknown) { return this.filtro('neq', c, v); }
    is(c: string, v: unknown) { return this.filtro('is', c, v); }
    gte(c: string, v: unknown) { return this.filtro('gte', c, v); }
    lte(c: string, v: unknown) { return this.filtro('lte', c, v); }
    lt(c: string, v: unknown) { return this.filtro('lt', c, v); }
    gt(c: string, v: unknown) { return this.filtro('gt', c, v); }
    in(c: string, v: readonly unknown[]) { return this.filtro('in', c, v); }
    order() { return this; }
    limit(n: number) { this.tetto = n; return this; }
    range(da: number, a: number) { this.da = da; this.a = a; return this; }

    private righe(): Riga[] {
      let righe = [...(tabelle[this.tabella] ?? [])];
      for (const f of this.filtri) {
        const val = (r: Riga) => r[f.colonna];
        if (f.tipo === 'eq') righe = righe.filter((r) => val(r) === f.valore);
        else if (f.tipo === 'neq') righe = righe.filter((r) => val(r) !== f.valore);
        else if (f.tipo === 'is') righe = righe.filter((r) => (val(r) ?? null) === (f.valore ?? null));
        else if (f.tipo === 'in') righe = righe.filter((r) => (f.valore as unknown[]).includes(val(r)));
        else if (f.tipo === 'gte') righe = righe.filter((r) => String(val(r)) >= String(f.valore));
        else if (f.tipo === 'gt') righe = righe.filter((r) => String(val(r)) > String(f.valore));
        else if (f.tipo === 'lte') righe = righe.filter((r) => String(val(r)) <= String(f.valore));
        else if (f.tipo === 'lt') righe = righe.filter((r) => String(val(r)) < String(f.valore));
      }
      return righe;
    }

    then<T>(risolvi: (v: { data: Riga[] | null; error: Guasto; count: number | null }) => T) {
      const chiamata: Chiamata = {
        tabella: this.tabella,
        colonne: this.colonne,
        conteggioEsatto: this.conteggio === 'exact',
        soloTesta: this.testa,
        filtri: this.filtri,
      };
      chiamate.push(chiamata);
      const rotto = guasto(chiamata);
      if (rotto) return Promise.resolve(risolvi({ data: null, error: rotto, count: null }));

      const tutte = this.righe();
      // Il conteggio vero lo dà solo chi lo chiede: è la differenza fra sapere
      // quanti ordini ci sono e sapere quante righe ti sono arrivate.
      const count = this.conteggio === 'exact' ? tutte.length : null;
      if (this.testa) return Promise.resolve(risolvi({ data: [], error: null, count }));

      // La finestra chiesta, oppure il tetto che il server applica da solo.
      const da = this.da ?? 0;
      const a = this.a ?? da + (this.tetto ?? TETTO_SILENZIOSO) - 1;
      const finestra = Math.min(a - da + 1, TETTO_SILENZIOSO);
      return Promise.resolve(risolvi({ data: tutte.slice(da, da + finestra), error: null, count }));
    }
  }

  return {
    chiamate,
    client: { from: (tabella: string) => new Query(tabella) } as unknown as SupabaseClient,
  };
}

const ADESSO = new Date('2026-08-27T15:00:00Z');
const oggiAlle = (ora: number) => `2026-08-27T${String(ora).padStart(2, '0')}:00:00Z`;

const ordine = (i: number, extra: Riga = {}): Riga => ({
  id: `ordine-${i}`,
  total_price: 10,
  delivery_status: 'DELIVERED',
  created_at: oggiAlle(9),
  delivery_full_name: 'Nicola',
  seller: { store_name: 'Pane Quotidiano' },
  ...extra,
});

/** Una giornata normale: pochi ordini, niente di rotto. */
const giornataNormale = () => ({
  orders: [
    ordine(1),
    ordine(2, { delivery_status: 'CANCELED', total_price: 999 }),
    ordine(3, { delivery_status: 'NEW', created_at: oggiAlle(14) }),
  ],
  profiles: [{ id: 'u1', role: 'buyer', is_approved: true, created_at: oggiAlle(8) }],
  rider_sos_events: [],
  disputes: [],
});

describe('il cruscotto «Oggi» quando una lettura non riesce', () => {
  it('non consegna una giornata a zero: la lettura fallita risale', async () => {
    // La rete cade sulla lettura degli ordini di oggi. Prima usciva
    // `ordersTodayCount: 0, gmvToday: 0`: identico a un marketplace fermo.
    const db = fintoDatabase(giornataNormale(), (c) =>
      c.tabella === 'orders' && c.colonne.includes('total_price') && !c.colonne.includes('created_at')
        ? { message: 'connessione persa' }
        : null,
    );
    await expect(
      leggiCruscottoOggi(db.client, ADESSO),
      'Con la lettura degli ordini caduta il cruscotto tornava «zero ordini, zero incasso»: chi guarda non poteva distinguerlo da una giornata vuota',
    ).rejects.toThrow();
  });

  it('anche il conteggio dei nuovi iscritti, se cade, ferma la pagina', async () => {
    const db = fintoDatabase(giornataNormale(), (c) =>
      c.tabella === 'profiles' ? { message: 'permesso negato' } : null,
    );
    await expect(
      leggiCruscottoOggi(db.client, ADESSO),
      'Un conteggio caduto usciva come «zero nuovi iscritti» e come «zero venditori da approvare»',
    ).rejects.toThrow();
  });

  it('quando tutto va bene i numeri sono quelli veri', async () => {
    const db = fintoDatabase(giornataNormale());
    const oggi = await leggiCruscottoOggi(db.client, ADESSO);
    expect(oggi.ordersTodayCount, 'gli ordini di oggi sono tre').toBe(3);
    // L'ordine annullato non fa incasso: 10 + 10, non 1019.
    expect(oggi.gmvToday, 'l\'incasso di oggi non conta gli ordini annullati').toBe(20);
    expect(oggi.deliveredToday, 'uno solo è stato consegnato').toBe(1);
    expect(oggi.ordersPendingCount, 'c\'è un ordine ancora da accettare').toBe(1);
  });
});

describe('il cruscotto «Oggi» in una giornata da più di mille ordini', () => {
  const tanti = {
    orders: Array.from({ length: 2500 }, (_, i) =>
      ordine(i, { total_price: 2, delivery_status: i % 2 === 0 ? 'DELIVERED' : 'NEW' }),
    ),
    profiles: Array.from({ length: 1500 }, (_, i) => ({
      id: `p-${i}`, role: 'buyer', is_approved: true, created_at: oggiAlle(8),
    })),
    rider_sos_events: [],
    disputes: [],
  };

  it('conta tutti gli ordini della giornata, non i primi mille', async () => {
    const db = fintoDatabase(tanti);
    const oggi = await leggiCruscottoOggi(db.client, ADESSO);
    expect(
      oggi.ordersTodayCount,
      'Superati i mille ordini in un giorno, «Ordini oggi» si fermava a mille e la crescita sembrava un tetto',
    ).toBe(2500);
    expect(
      oggi.gmvToday,
      'L\'incasso della giornata veniva sommato solo sulle prime mille righe arrivate: il marketplace sembrava incassare meno di quanto incassava',
    ).toBe(5000);
    expect(oggi.deliveredToday, 'metà erano consegnati').toBe(1250);
  });

  it('gli ordini ancora da accettare li conta il database, non le righe arrivate', async () => {
    const db = fintoDatabase(tanti);
    const oggi = await leggiCruscottoOggi(db.client, ADESSO);
    expect(
      oggi.ordersPendingCount,
      'Il numero di ordini «NEW» si fermava a mille perché veniva letto contando le righe ricevute invece di chiederlo al database',
    ).toBe(1250);
  });

  it('i nuovi iscritti li conta il database', async () => {
    const db = fintoDatabase(tanti);
    const oggi = await leggiCruscottoOggi(db.client, ADESSO);
    expect(oggi.signupsTodayCount, 'i nuovi iscritti di oggi sono millecinquecento').toBe(1500);
  });

  it('dice a chi guarda quando ha letto un campione invece di tutto', async () => {
    // Oltre il tetto duro della lettura a finestre il numero è per forza
    // parziale: deve dirlo, non mostrarlo come se fosse il totale.
    const troppi = {
      ...tanti,
      orders: Array.from({ length: 21_000 }, (_, i) => ordine(i, { total_price: 1 })),
    };
    const db = fintoDatabase(troppi);
    const oggi = await leggiCruscottoOggi(db.client, ADESSO);
    expect(oggi.campione, 'la giornata è stata letta a metà e il cruscotto non lo diceva').toBe(true);
  });
});

describe('gli ordini fermi da più di quattro ore', () => {
  it('si contano dentro una finestra di giorni, non da sempre', async () => {
    const vecchio = new Date(ADESSO.getTime() - 400 * 86_400_000).toISOString();
    const db = fintoDatabase({
      orders: [
        // Fermo da stamattina: è quello che l'amministrazione deve lavorare oggi.
        ordine(1, { delivery_status: 'ACCEPTED', created_at: oggiAlle(6) }),
        // Fermo da più di un anno: rimasto lì, non è il lavoro di stamattina.
        ordine(2, { delivery_status: 'NEW', created_at: vecchio }),
      ],
      profiles: [],
      rider_sos_events: [],
      disputes: [],
    });
    const oggi = await leggiCruscottoOggi(db.client, ADESSO);
    expect(
      oggi.ordersProblemCount,
      'La riga rossa «ordini in problema» sommava gli ordini fermi di sempre a quelli di stamattina: sembrava un incendio che nessuno poteva spegnere',
    ).toBe(1);
  });

  it('la finestra è dichiarata, non lasciata al caso', () => {
    expect(GIORNI_DI_ORDINI_FERMI, 'la finestra degli ordini fermi deve essere un numero scritto e sensato').toBeGreaterThan(0);
    expect(GIORNI_DI_ORDINI_FERMI).toBeLessThanOrEqual(30);
  });
});

/**
 * Il modulo qui sopra non basta: se la pagina rimettesse lo zero al posto
 * dell'errore, la lettura riparata non servirebbe a niente. Qui la pagina viene
 * montata per davvero, con la lettura caduta, e si guarda cosa legge chi apre
 * il cruscotto la mattina.
 */
describe('la pagina «Today», con la lettura caduta', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__ESITO_QUERY__;
    delete (globalThis as Record<string, unknown>).__DATI_QUERY__;
  });

  it('dice che non è riuscita a leggere, e non mostra nessun numero', async () => {
    (globalThis as Record<string, unknown>).__ESITO_QUERY__ = {
      isError: true, error: new Error('connessione persa'), data: undefined,
    };
    const mod = await monta('app/admin/today/page.tsx');
    const s = accendi(mod.default as ComponentType);
    const testo = s.radice.textContent ?? '';

    expect(
      testo,
      'Con la lettura caduta la pagina non diceva niente: chi apre il cruscotto non poteva sapere che i numeri non erano arrivati',
    ).toContain('Non sono riuscito a leggere');
    expect(
      testo,
      'La pagina mostrava lo stesso la torre dei numeri: uno zero letto come «oggi non ha comprato nessuno»',
    ).not.toContain('GMV oggi');
    expect(testo, 'e nemmeno il conto degli ordini').not.toContain('Ordini oggi');
    s.smonta();
  }, 60000);

  it('quando i numeri ci sono li mostra, e dice se ha letto solo un campione', async () => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = {
      ordersTodayCount: 20_000, gmvToday: 40_000, deliveredToday: 12, ordersPendingCount: 3,
      ordersProblemCount: 0, sellersPendingCount: 0, sosActiveCount: 0, disputesOpenCount: 0,
      signupsTodayCount: 4, recentOrders: [], campione: true,
    };
    const mod = await monta('app/admin/today/page.tsx');
    const s = accendi(mod.default as ComponentType);
    const testo = s.radice.textContent ?? '';

    expect(testo, 'i numeri della giornata devono comparire').toContain('Ordini oggi');
    expect(
      testo,
      'La giornata era stata letta solo in parte e la pagina mostrava il numero come se fosse il totale',
    ).toContain('campione');
    s.smonta();
  }, 60000);
});
