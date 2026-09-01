import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PASSAGGI_LECITI,
  passaggioLecito,
  passaggiDa,
  COLONNA_ORARIO_DEL_PASSAGGIO,
  type OrderStatus,
} from '@/lib/order-status';

/**
 * 27/8/2026 (R014) — LE REGOLE DEI PASSAGGI VIVEVANO SOLO DENTRO IL DATABASE.
 *
 * Quali passaggi di stato sono leciti, e a chi, era scritto in un posto solo:
 * il guardiano `enforce_order_update_rules` della migrazione 114. Nel codice
 * del sito la stessa conoscenza era riscritta a mano, una condizione per
 * pulsante, in due pagine diverse: quella del negoziante e quella del
 * fattorino.
 *
 * Il modo in cui si rompe: basta che una condizione e il guardiano si
 * allontanino di un passo, e il negoziante vede un pulsante che al clic
 * risponde «Non hai i permessi per questa azione» — un messaggio che non
 * c'entra niente con quello che ha fatto, su un ordine che sta aspettando di
 * essere preparato. Lui riprova, poi telefona.
 *
 * Adesso la tabella sta in `lib/order-status.ts`, i pulsanti la leggono, e
 * questo file la confronta con quello che il database accetta davvero: le due
 * copie non possono più allontanarsi in silenzio.
 */

describe('chi puo portare l ordine da uno stato all altro', () => {
  it('il negoziante accetta un ordine nuovo e lo dichiara pronto', () => {
    expect(passaggioLecito('NEW', 'ACCEPTED', 'negoziante')).toBe(true);
    expect(passaggioLecito('ACCEPTED', 'READY', 'negoziante')).toBe(true);
  });

  it('il negoziante non puo saltare la preparazione', () => {
    expect(
      passaggioLecito('NEW', 'READY', 'negoziante'),
      'il pulsante «pronto» comparirebbe su un ordine appena arrivato, e il database lo rifiuterebbe',
    ).toBe(false);
  });

  it('il negoziante non prende in carico la consegna al posto del fattorino', () => {
    expect(passaggioLecito('READY', 'ASSIGNED', 'negoziante')).toBe(false);
    expect(passaggioLecito('PICKED_UP', 'OUT_FOR_DELIVERY', 'negoziante')).toBe(false);
  });

  it('il fattorino prende l ordine pronto e poi parte per la consegna', () => {
    expect(passaggioLecito('READY', 'ASSIGNED', 'fattorino')).toBe(true);
    expect(passaggioLecito('PICKED_UP', 'OUT_FOR_DELIVERY', 'fattorino')).toBe(true);
  });

  it('il fattorino non accetta ordini al posto del negozio', () => {
    expect(passaggioLecito('NEW', 'ACCEPTED', 'fattorino')).toBe(false);
    expect(passaggioLecito('ACCEPTED', 'READY', 'fattorino')).toBe(false);
  });

  it('da uno stato senza uscite non parte nessun pulsante', () => {
    expect(passaggiDa('DELIVERED', 'negoziante')).toEqual([]);
    expect(passaggiDa('CANCELED', 'fattorino')).toEqual([]);
    expect(passaggiDa('NEW', 'negoziante')).toEqual(['ACCEPTED']);
  });

  it('l orario del passaggio non lo sceglie chi preme il pulsante', () => {
    // Prima il nome della colonna da scrivere arrivava dal punto in cui si
    // premeva il pulsante: era il browser a dire al database quale casella
    // riempire. Adesso lo decide lo stato di arrivo, e basta.
    expect(COLONNA_ORARIO_DEL_PASSAGGIO.ACCEPTED).toBe('accepted_at');
    expect(COLONNA_ORARIO_DEL_PASSAGGIO.READY).toBe('ready_at');
    expect(COLONNA_ORARIO_DEL_PASSAGGIO.DELIVERED, 'la consegna la data il database, non il browser').toBeUndefined();
  });
});

/**
 * La parità con il database. Questo blocco legge il guardiano vero — la
 * funzione `enforce_order_update_rules` della migrazione 114 — e ne ricava
 * l'elenco dei passaggi che il database accetta. Se qualcuno ne aggiunge uno di
 * là o di qua e si scorda l'altra parte, qui diventa rosso.
 */
function passaggiScrittiNelDatabase(): { da: string; a: string; chi: string }[] {
  const sql = readFileSync('migrations/114_hardening_radiografia.sql', 'utf8');
  const inizio = sql.indexOf('IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN');
  const fine = sql.indexOf("RAISE EXCEPTION 'orders: transizione", inizio);
  expect(inizio, 'il guardiano dei passaggi non e piu dove ci si aspetta').toBeGreaterThan(-1);
  expect(fine).toBeGreaterThan(inizio);
  // Via l'`IF` esterno («lo stato e cambiato?»): i rami veri cominciano dopo.
  const sezione = sql.slice(inizio, fine).replace(/^[\s\S]*?\bTHEN\b/, '');

  const fuori: { da: string; a: string; chi: string }[] = [];
  for (const ramo of sezione.split(/\bELSIF\b/)) {
    const condizione = ramo.split(/\bTHEN\b/)[0];
    const vecchi = [...condizione.matchAll(/OLD\.delivery_status\s*=\s*'(\w+)'/g)].map((m) => m[1]);
    const nuovi = [...condizione.matchAll(/NEW\.delivery_status\s*=\s*'(\w+)'/g)].map((m) => m[1]);
    if (vecchi.length === 0 || vecchi.length !== nuovi.length) continue;
    const chi = /e_rider_approvato|rider_id\s*=\s*uid/.test(condizione) ? 'fattorino' : 'negoziante';
    for (let i = 0; i < vecchi.length; i++) fuori.push({ da: vecchi[i], a: nuovi[i], chi });
  }
  return fuori;
}

describe('la tabella dei passaggi e quella che il database accetta', () => {
  it('il database e il sito elencano gli stessi passaggi, per le stesse persone', () => {
    const dalDatabase = passaggiScrittiNelDatabase()
      .map((p) => `${p.chi}: ${p.da} → ${p.a}`)
      .sort();
    const dalSito = PASSAGGI_LECITI.map((p) => `${p.chi}: ${p.da} → ${p.a}`).sort();

    expect(dalDatabase.length, 'non sono riuscito a leggere i passaggi dalla migrazione 114').toBeGreaterThan(0);
    expect(
      dalSito,
      'i pulsanti del sito e il guardiano del database non sono piu d accordo: qualcuno vedra un pulsante che risponde «non hai i permessi»',
    ).toEqual(dalDatabase);
  });

  it('ogni colonna d orario che il sito scrive e fra quelle che il database consente', () => {
    const sql = readFileSync('migrations/114_hardening_radiografia.sql', 'utf8');
    const elenco = sql.slice(sql.indexOf('consentiti text[] := ARRAY['), sql.indexOf('];', sql.indexOf('consentiti text[] := ARRAY[')));
    for (const colonna of Object.values(COLONNA_ORARIO_DEL_PASSAGGIO)) {
      expect(
        elenco.includes(`'${colonna}'`),
        `il sito scrive ${colonna} ma il database rifiuta quella colonna: il pulsante darebbe errore`,
      ).toBe(true);
    }
  });
});

/** Le due pagine dei pulsanti leggono la tabella, non se la riscrivono. */
describe('le pagine degli ordini leggono la tabella condivisa', () => {
  it('la pagina del negoziante non passa piu il nome di una colonna dal browser', () => {
    const pagina = readFileSync('app/seller/orders/[id]/page.tsx', 'utf8');
    expect(
      pagina.includes('timestampField'),
      'la pagina del negoziante lascia ancora scrivere al browser il nome della colonna da riempire',
    ).toBe(false);
  });

  it('i pulsanti nascono dalla tabella, in tutte e due le pagine', () => {
    for (const pagina of ['app/seller/orders/[id]/page.tsx', 'app/rider/orders/[id]/page.tsx']) {
      expect(
        readFileSync(pagina, 'utf8').includes('passaggioLecito('),
        `${pagina} riscrive le regole dei passaggi a mano`,
      ).toBe(true);
    }
  });
});

/** Un controllo di forma: la tabella copre solo stati veri. */
describe('la tabella non nomina stati che non esistono', () => {
  it('ogni stato citato e uno degli stati dell ordine', () => {
    const stati: OrderStatus[] = [
      'NEW', 'ACCEPTED', 'READY', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELED',
    ];
    for (const p of PASSAGGI_LECITI) {
      expect(stati).toContain(p.da);
      expect(stati).toContain(p.a);
    }
  });
});
