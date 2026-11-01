import { describe, it, expect } from 'vitest';
import {
  raccogliOrdiniDaEsportare, contenutoCsvOrdini, nomeFileOrdini, TETTO_LETTURE,
  type OrdineDaEsportare,
} from '@/lib/ordini/esporta-ordini';
import {
  raccogliUtentiDaEsportare, contenutoCsvUtenti, nomeFileUtenti, TETTO_LETTURE_UTENTI,
  type UtenteDaEsportare,
} from '@/lib/admin/esporta-utenti';

/**
 * LE DUE ESPORTAZIONI CSV (ordini e utenti) SONO UNA SOLA (1/11/2026).
 *
 * Prima l'algoritmo era copiato due volte e le copie divergevano: gli ordini
 * tenevano la prima riga senza id e perdevano le altre in silenzio, gli utenti
 * le scartavano tutte; il nome file degli ordini lasciava `--` e accenti.
 * Qui lo STESSO finto database passa attraverso le due funzioni pubbliche, e
 * le due devono dare lo stesso risultato: stessi id, stessa fine, stesso tetto,
 * stesso trattamento delle righe senza id.
 */

type Grezza = { id?: string | null };

/** Un finto `.range()`: restituisce la fetta, estremi inclusi, e conta le letture. */
function databaseFinto(righe: Grezza[], tettoServer = Infinity) {
  const chiamate: Array<[number, number]> = [];
  const leggi = async (da: number, a: number) => {
    chiamate.push([da, a]);
    return righe.slice(da, Math.min(a + 1, da + tettoServer));
  };
  return { leggi, chiamate };
}

const comeOrdine = (r: Grezza) => ({
  id: r.id, created_at: '2026-10-01T10:00:00Z', delivery_full_name: 'Cliente',
  delivery_city: 'Piacenza', delivery_status: 'DELIVERED', total_price: 10,
  seller: { store_name: 'Pane Quotidiano' }, rider: null,
}) as unknown as OrdineDaEsportare;
const comeUtente = (r: Grezza) => ({ id: r.id, email: 'x@y.it' }) as unknown as UtenteDaEsportare;

async function attraversoLeDue(righe: Grezza[], opz: { perLettura: number; tettoLetture?: number }, tettoServer?: number) {
  const dbO = databaseFinto(righe, tettoServer);
  const dbU = databaseFinto(righe, tettoServer);
  const ordini = await raccogliOrdiniDaEsportare(
    async (da, a) => (await dbO.leggi(da, a)).map(comeOrdine), opz);
  const utenti = await raccogliUtentiDaEsportare(
    async (da, a) => (await dbU.leggi(da, a)).map(comeUtente), opz);
  return { ordini, utenti, chiamateO: dbO.chiamate, chiamateU: dbU.chiamate };
}

describe('ordini e utenti passano dalla stessa lettura a finestre', () => {
  it('doppioni, fine a zero righe e server che taglia corto: stesso risultato', async () => {
    // L'ordine 3 ricompare nella finestra dopo (una riga nuova lo ha spinto giù).
    const righe = ['1', '2', '3', '3', '4', '5', '6', '7'].map((id) => ({ id }));
    const { ordini, utenti, chiamateO, chiamateU } = await attraversoLeDue(righe, { perLettura: 3 }, 2);
    expect(ordini.righe.map((r) => r.id)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(utenti.righe.map((r) => r.id)).toEqual(ordini.righe.map((r) => r.id));
    expect(ordini.completo).toBe(true);
    expect(utenti.completo).toBe(true);
    expect(chiamateU).toEqual(chiamateO);
    expect(ordini.letture).toBe(utenti.letture);
  });

  it('il tetto ferma tutti e due allo stesso modo, e lo dichiarano', async () => {
    const infinite = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}` }));
    const { ordini, utenti } = await attraversoLeDue(infinite, { perLettura: 2, tettoLetture: 3 });
    for (const r of [ordini, utenti]) {
      expect(r.completo).toBe(false);
      expect(r.motivo).toBe('tetto');
      expect(r.letture).toBe(3);
      expect(r.righe).toHaveLength(6);
    }
  });

  it('il tetto di default resta 60 per gli ordini e 30 per gli utenti (un parametro, non una copia)', async () => {
    const infinite = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}` }));
    const { ordini, utenti } = await attraversoLeDue(infinite, { perLettura: 1 });
    expect(TETTO_LETTURE).toBe(60);
    expect(TETTO_LETTURE_UTENTI).toBe(30);
    expect(ordini.letture).toBe(60);
    expect(utenti.letture).toBe(30);
  });
});

describe('le righe senza id: trattate uguale, contate, mai perse in silenzio', () => {
  const righe: Grezza[] = [{ id: 'a' }, { id: null }, { id: 'b' }, {}, { id: '' }, { id: 'c' }];

  it('restano fuori in tutti e due, e il numero si sa', async () => {
    const { ordini, utenti } = await attraversoLeDue(righe, { perLettura: 4 });
    expect(ordini.righe.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(utenti.righe.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(ordini.senzaId).toBe(3);
    expect(utenti.senzaId).toBe(3);
  });

  it('il file non sembra intero: avviso col numero in prima riga e -PARZIALE nel nome', async () => {
    const { ordini, utenti } = await attraversoLeDue(righe, { perLettura: 4 });
    expect(ordini.completo).toBe(false);
    expect(utenti.completo).toBe(false);
    const primaO = contenutoCsvOrdini(ordini).replace(/^﻿/, '').split('\n')[0];
    const primaU = contenutoCsvUtenti(utenti).replace(/^﻿/, '').split('\n')[0];
    expect(primaO).toContain('INCOMPLETO');
    expect(primaO).toContain('3 righe sono arrivate senza identificativo');
    expect(primaU).toContain('INCOMPLETO');
    expect(primaU).toContain('3 righe sono arrivate senza identificativo');
    expect(nomeFileOrdini({ oggi: '2026-11-01', completo: ordini.completo })).toBe('mycity-ordini-2026-11-01-PARZIALE.csv');
    expect(nomeFileUtenti({ oggi: '2026-11-01', completo: utenti.completo })).toBe('mycity-utenti-2026-11-01-PARZIALE.csv');
  });
});

describe('il nome del file: stesse regole per ordini e utenti', () => {
  it('un filtro accentato non lascia accenti né trattini doppi o ai bordi', () => {
    const nome = nomeFileOrdini({ oggi: '2026-11-01', completo: true, filtro: 'Città consegnàta ' });
    expect(nome).toBe('mycity-ordini-2026-11-01-citta-consegnata.csv');
    expect(nome).not.toContain('--');
    expect(nome).toMatch(/^[a-z0-9.-]+$/);
  });

  it('lo stesso filtro dà lo stesso pezzo di nome nei due file', () => {
    const filtro = '  Perché? Sì!  ';
    const o = nomeFileOrdini({ oggi: '2026-11-01', completo: false, filtro });
    const u = nomeFileUtenti({ oggi: '2026-11-01', completo: false, filtro });
    expect(o.replace('mycity-ordini-', '')).toBe(u.replace('mycity-utenti-', ''));
    expect(o).toBe('mycity-ordini-2026-11-01-perche-si-PARZIALE.csv');
  });

  it('una ricerca di soli simboli o caratteri non latini resta una ricerca nel nome', () => {
    for (const ricerca of ['王', 'Иван', '!!!']) {
      expect(nomeFileUtenti({ oggi: '2026-11-01', completo: true, ricerca }))
        .toBe('mycity-utenti-2026-11-01-cerca.csv');
    }
    expect(nomeFileUtenti({ oggi: '2026-11-01', completo: true, ricerca: '   ' }))
      .toBe('mycity-utenti-2026-11-01.csv');
  });
});

describe('con le sole righe senza id, l avviso non dice una cosa falsa', () => {
  const righe: Grezza[] = [{ id: 'a' }, { id: null }, { id: 'b' }];

  it('la lettura e arrivata in fondo: niente «il resto non e stato scaricato»', async () => {
    const { ordini, utenti } = await attraversoLeDue(righe, { perLettura: 10 });
    expect(ordini.motivo).toBe('senza-id');
    expect(utenti.motivo).toBe('senza-id');
    const primaO = contenutoCsvOrdini(ordini).replace(/^\uFEFF/, '').split('\n')[0];
    const primaU = contenutoCsvUtenti(utenti).replace(/^\uFEFF/, '').split('\n')[0];
    for (const prima of [primaO, primaU]) {
      expect(prima).toContain('INCOMPLETO');
      expect(prima).toContain('1 riga è arrivata senza identificativo');
      expect(prima).not.toMatch(/resto non/);
      expect(prima).not.toMatch(/solo i primi/);
    }
  });

  it('quando invece ferma il tetto, il «resto non scaricato» resta', async () => {
    const infinite = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}` }));
    const { ordini, utenti } = await attraversoLeDue(infinite, { perLettura: 2, tettoLetture: 2 });
    expect(contenutoCsvOrdini(ordini)).toMatch(/resto non/);
    expect(contenutoCsvUtenti(utenti)).toMatch(/resto non/);
  });
});
