/**
 * @vitest-environment jsdom
 */
/**
 * 8/9/2026 — NELLA PAGINA «TODAY» GLI ULTIMI DIECI ORDINI POTEVANO ESSERE DI
 * GIOVEDÌ SCORSO, E SEMBRAVANO DI STAMATTINA.
 *
 * È la pagina che l'amministrazione apre per prima. In cima sette numeri che
 * partono da mezzanotte: «Ordini oggi», «GMV oggi», «Consegnati», «Nuovi
 * signup». In fondo una tabella che di mezzanotte non sapeva niente: nessun
 * filtro sulla data, quindi gli ultimi dieci ordini ESISTENTI, di qualunque
 * giorno. E la colonna «Quando» stampava solo ora e minuti, con
 * `toLocaleTimeString`: un ordine di tre giorni fa si presentava come «18:42»,
 * identico a uno di stamattina.
 *
 * Alle nove del mattino la stessa schermata diceva due cose opposte — «Ordini
 * oggi: 0» sopra, dieci righe con orari plausibili sotto — e vince quello che
 * sembra più concreto: l'elenco. Con pochi ordini al giorno non era il caso
 * raro: era il caso normale. La frase del riquadro vuoto, «Nessun ordine ancora
 * oggi», prometteva pure che lì dentro ci fossero gli ordini di oggi.
 *
 * Qui si prova tutta la catena, perché il difetto stava in tre punti e ripararne
 * uno solo non basta: la LETTURA (ha una finestra? la dichiara?), la DECISIONE
 * su come si scrive una data (`lib/ordini-recenti`, pura, eseguita davvero) e la
 * PAGINA montata per intero — se domani qualcuno rimette `toLocaleTimeString`
 * nella cella, l'ultimo blocco diventa rosso.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { leggiCruscottoOggi } from '@/lib/queries/cruscotto-oggi';
import {
  etichettaQuando,
  intestazioneOrdiniRecenti,
  GIORNI_DI_ORDINI_RECENTI,
  QUANTI_ORDINI_RECENTI,
} from '@/lib/ordini-recenti';
import { NON_LETTO } from '@/lib/letture-cruscotto';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

type Riga = Record<string, unknown>;

/**
 * Un finto PostgREST ridotto a quello che questa lettura usa davvero. I filtri
 * li applica sul serio: è l'unico modo perché la prova possa accorgersi che una
 * finestra sulla data non c'è.
 */
function fintoDatabase(tabelle: Record<string, Riga[]>) {
  class Query {
    private colonne = '*';
    private conteggio: string | null = null;
    private testa = false;
    private filtri: Array<{ tipo: string; colonna: string; valore: unknown }> = [];
    private crescente = true;
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
    is(c: string, v: unknown) { return this.filtro('is', c, v); }
    gte(c: string, v: unknown) { return this.filtro('gte', c, v); }
    lt(c: string, v: unknown) { return this.filtro('lt', c, v); }
    in(c: string, v: readonly unknown[]) { return this.filtro('in', c, v); }
    order(_c: string, o?: { ascending?: boolean }) { this.crescente = o?.ascending !== false; return this; }
    limit(n: number) { this.tetto = n; return this; }
    range(da: number, a: number) { this.da = da; this.a = a; return this; }

    private righe(): Riga[] {
      let righe = [...(tabelle[this.tabella] ?? [])];
      for (const f of this.filtri) {
        const val = (r: Riga) => r[f.colonna];
        if (f.tipo === 'eq') righe = righe.filter((r) => val(r) === f.valore);
        else if (f.tipo === 'is') righe = righe.filter((r) => (val(r) ?? null) === (f.valore ?? null));
        else if (f.tipo === 'in') righe = righe.filter((r) => (f.valore as unknown[]).includes(val(r)));
        else if (f.tipo === 'gte') righe = righe.filter((r) => String(val(r)) >= String(f.valore));
        else if (f.tipo === 'lt') righe = righe.filter((r) => String(val(r)) < String(f.valore));
      }
      righe.sort((x, y) => {
        const a = String(x.created_at ?? '');
        const b = String(y.created_at ?? '');
        return this.crescente ? (a < b ? -1 : a > b ? 1 : 0) : (a > b ? -1 : a < b ? 1 : 0);
      });
      return righe;
    }

    then<T>(risolvi: (v: { data: Riga[] | null; error: null; count: number | null }) => T) {
      const tutte = this.righe();
      const count = this.conteggio === 'exact' ? tutte.length : null;
      if (this.testa) return Promise.resolve(risolvi({ data: [], error: null, count }));
      const da = this.da ?? 0;
      const a = this.a ?? da + (this.tetto ?? 1000) - 1;
      return Promise.resolve(risolvi({ data: tutte.slice(da, a + 1), error: null, count }));
    }
  }
  return { client: { from: (t: string) => new Query(t) } as unknown as SupabaseClient };
}

const ADESSO = new Date('2026-09-08T09:00:00');
/** Un istante a `giorni` indietro, sempre alle 18:42 — l'ora non cambia mai. */
const alle1842Di = (giorniFa: number, base: Date = ADESSO) => {
  const d = new Date(base);
  d.setHours(18, 42, 0, 0);
  d.setDate(d.getDate() - giorniFa);
  return d;
};

const ordine = (i: number, quando: Date, extra: Riga = {}): Riga => ({
  id: `ordine-000${i}`,
  total_price: 10,
  delivery_status: 'DELIVERED',
  created_at: quando.toISOString(),
  delivery_full_name: 'Nicola',
  seller: { store_name: 'Pane Quotidiano' },
  ...extra,
});

describe('la lettura degli «ultimi ordini» ha una finestra, e la dichiara', () => {
  const mattinaSenzaOrdiniNuovi = () => ({
    // Nessun ordine oggi: è il caso normale delle nove del mattino.
    orders: [
      ordine(1, alle1842Di(2)),
      ordine(2, alle1842Di(4)),
      // Un ordine di un mese fa. Prima finiva nell'elenco «di oggi».
      ordine(3, alle1842Di(30)),
    ],
    profiles: [],
    rider_sos_events: [],
    disputes: [],
  });

  it('non pesca nell\'archivio: un ordine di un mese fa non è «cosa sta succedendo adesso»', async () => {
    const db = fintoDatabase(mattinaSenzaOrdiniNuovi());
    const oggi = await leggiCruscottoOggi(db.client, ADESSO);
    const identificativi = oggi.recentOrders.map((o) => o.id);
    expect(
      identificativi,
      'La tabella prendeva gli ultimi dieci ordini ESISTENTI: senza nessun filtro sulla data ci finiva dentro anche roba di un mese fa',
    ).not.toContain('ordine-0003');
    expect(identificativi, 'gli ordini dentro la finestra ci devono essere').toContain('ordine-0001');
  });

  it('la finestra viaggia col dato: la pagina non se la deve ricordare', async () => {
    const db = fintoDatabase(mattinaSenzaOrdiniNuovi());
    const oggi = await leggiCruscottoOggi(db.client, ADESSO);
    expect(
      oggi.finestraOrdiniRecentiGiorni,
      'Senza la finestra dentro il risultato, il titolo della tabella resta una frase scritta a mano che nessuno aggiorna',
    ).toBe(GIORNI_DI_ORDINI_RECENTI);
    expect(GIORNI_DI_ORDINI_RECENTI, 'la finestra deve essere un numero scritto e sensato').toBeGreaterThan(0);
    expect(GIORNI_DI_ORDINI_RECENTI).toBeLessThanOrEqual(30);
  });

  it('«Ordini oggi» resta zero: la tabella più larga non gonfia i numeri della giornata', async () => {
    const db = fintoDatabase(mattinaSenzaOrdiniNuovi());
    const oggi = await leggiCruscottoOggi(db.client, ADESSO);
    expect(oggi.ordersTodayCount, 'oggi non ha ancora comprato nessuno').toBe(0);
    expect(oggi.recentOrders.length, 'ma gli ultimi giorni qualcosa è successo').toBeGreaterThan(0);
  });
});

describe('come si scrive la colonna «Quando»', () => {
  it('l\'ora nuda solo per gli ordini di oggi', () => {
    expect(etichettaQuando(alle1842Di(0), ADESSO)).toBe('18:42');
  });

  it('ieri lo dice', () => {
    expect(
      etichettaQuando(alle1842Di(1), ADESSO),
      'Un ordine di ieri usciva «18:42», identico a uno di stamattina',
    ).toBe('ieri 18:42');
  });

  it('più indietro di ieri scrive il giorno, non solo l\'ora', () => {
    const scritto = etichettaQuando(alle1842Di(3), ADESSO);
    expect(
      scritto,
      'Tre giorni fa e stamattina si scrivevano nello stesso identico modo: «18:42»',
    ).not.toMatch(/^\d{1,2}:\d{2}$/);
    expect(scritto, 'il giorno del mese deve esserci').toMatch(/^5 /);
    expect(scritto, 'e anche l\'ora').toContain('18:42');
  });

  it('se l\'anno è un altro, c\'è anche l\'anno', () => {
    const anniFa = new Date(alle1842Di(3));
    anniFa.setFullYear(anniFa.getFullYear() - 1);
    expect(
      etichettaQuando(anniFa, ADESSO),
      'Il 5 settembre dell\'anno scorso si leggeva uguale al 5 settembre di quest\'anno',
    ).toContain(String(anniFa.getFullYear()));
  });

  it('una data che non si riesce a leggere non diventa mezzanotte', () => {
    expect(etichettaQuando(null, ADESSO), 'un buco non è un orario').toBe(NON_LETTO);
    expect(etichettaQuando('non-una-data', ADESSO)).toBe(NON_LETTO);
    expect(etichettaQuando(undefined, ADESSO)).toBe(NON_LETTO);
  });
});

describe('il titolo della tabella e la frase di quando è vuota', () => {
  it('con una finestra di più giorni non promettono «oggi»', () => {
    const i = intestazioneOrdiniRecenti(7);
    expect(i.titolo, 'il titolo deve dire da che giorno parte l\'elenco').toContain('ultimi 7 giorni');
    expect(i.titolo).toContain(String(QUANTI_ORDINI_RECENTI));
    expect(
      i.vuoto,
      '«Nessun ordine ancora oggi» prometteva che lì dentro ci fossero gli ordini di oggi, e non era vero',
    ).not.toContain('oggi');
    expect(i.vuoto).toContain('7 giorni');
  });

  it('se la finestra è davvero oggi, allora «oggi» si può dire', () => {
    const i = intestazioneOrdiniRecenti(0);
    expect(i.titolo).toContain('oggi');
    expect(i.vuoto).toBe('Nessun ordine ancora oggi.');
  });

  it('se la finestra non arriva, non si tira a indovinare', () => {
    for (const senza of [undefined, null, Number.NaN, -3]) {
      const i = intestazioneOrdiniRecenti(senza as number);
      expect(i.titolo, 'senza sapere la finestra non si può scrivere «oggi»').not.toContain('oggi');
      expect(i.vuoto).not.toContain('oggi');
    }
  });
});

/**
 * I moduli qui sopra non bastano: il difetto si vedeva A SCHERMO. Qui la pagina
 * viene montata per davvero, con due ordini alla stessa ora e a tre giorni di
 * distanza — prima uscivano due celle identiche.
 */
describe('la pagina «Today» montata per davvero', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__DATI_QUERY__;
  });

  const numeri = (recentOrders: unknown[], finestra: number) => ({
    ordersTodayCount: 0, gmvToday: 0, deliveredToday: 0, ordersPendingCount: 0,
    ordersProblemCount: 0, sellersPendingCount: 0, sosActiveCount: 0, disputesOpenCount: 0,
    signupsTodayCount: 0, recentOrders, campione: false, finestraOrdiniRecentiGiorni: finestra,
  });

  /** L'ultima colonna di ogni riga della tabella: è «Quando». */
  const celleQuando = (radice: HTMLElement) =>
    Array.from(radice.querySelectorAll('tbody tr')).map((r) => {
      const celle = r.querySelectorAll('td');
      return (celle[celle.length - 1]?.textContent ?? '').trim();
    });

  it('un ordine di tre giorni fa non si scrive come uno di stamattina', async () => {
    // L'orologio vero: la pagina usa `new Date()`, e deve funzionare con quello.
    const oggi = alle1842Di(0, new Date());
    const treGiorniFa = alle1842Di(3, new Date());
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = numeri(
      [ordine(1, oggi), ordine(2, treGiorniFa)],
      GIORNI_DI_ORDINI_RECENTI,
    );
    const mod = await monta('app/admin/today/page.tsx');
    const s = accendi(mod.default as ComponentType);
    const [cellaOggi, cellaVecchia] = celleQuando(s.radice);

    expect(cellaOggi, 'l\'ordine di oggi tiene l\'ora nuda: lì non nasconde niente').toBe('18:42');
    expect(
      cellaVecchia,
      'Le due righe uscivano identiche — «18:42» e «18:42» — e chi guardava credeva che fossero tutte e due di stamattina',
    ).not.toBe(cellaOggi);
    expect(
      cellaVecchia,
      'La cella di un ordine vecchio non può essere una sola ora: il giorno deve esserci',
    ).not.toMatch(/^\d{1,2}:\d{2}$/);
    expect(cellaVecchia, 'e il giorno è quello dell\'ordine').toMatch(new RegExp(`^${treGiorniFa.getDate()} `));
    s.smonta();
  }, 60000);

  it('il titolo dice da che giorno parte, e il riquadro vuoto non promette «oggi»', async () => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = numeri([], GIORNI_DI_ORDINI_RECENTI);
    const mod = await monta('app/admin/today/page.tsx');
    const s = accendi(mod.default as ComponentType);
    const testo = (s.radice.textContent ?? '').replace(/\s+/g, ' ');

    expect(
      testo,
      'La tabella si chiamava «Ultimi 10 ordini» sopra una lettura che di oggi non sapeva niente',
    ).toContain(`ultimi ${GIORNI_DI_ORDINI_RECENTI} giorni`);
    expect(
      testo,
      '«Nessun ordine ancora oggi» sotto un elenco di sette giorni è una promessa che la pagina non può mantenere',
    ).not.toContain('Nessun ordine ancora oggi');
    expect(testo, 'la frase vera parla della finestra che ha letto').toContain(`Nessun ordine negli ultimi ${GIORNI_DI_ORDINI_RECENTI} giorni`);
    s.smonta();
  }, 60000);
});
