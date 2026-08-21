import { describe, it, expect, vi } from 'vitest';
import {
  chiaveTentativo,
  chiudiTentativo,
  decisioneSuChiaveOccupata,
  ABBANDONATO_DOPO_MS,
} from '@/lib/ordini/tentativo';

/**
 * I DUE BLOCCANTI DELL'ORDINE IN CONTANTI (radiografia del 21/8/2026).
 *
 * ① CHI RIORDINA LA STESSA SPESA NON ORDINA NIENTE, E LEGGE «ORDINE EFFETTUATO».
 *    La chiave del tentativo era l'impronta del carrello: contenuto, totale,
 *    ritiro. Un carrello uguale ha impronta uguale — per sempre. Maria compra
 *    due filoni ogni martedì: il martedì dopo il server riconosceva la chiave,
 *    restituiva gli ordini della settimana prima e il sito le diceva «Ordine
 *    effettuato». Lei aspettava il pane, al negozio non arrivava niente. È il
 *    caso più normale che esista per un panificio.
 *
 * ② IL DOPPIO CLIC VELOCE CREAVA DUE ORDINI VERI.
 *    La chiave si LEGGEVA all'inizio e si SCRIVEVA alla fine, dopo aver creato
 *    gli ordini. Due invii partiti nello stesso istante leggevano entrambi
 *    «nessuna chiave»: il negozio preparava due spese, il fattorino ne
 *    consegnava una, il credito veniva tolto due volte.
 */

function depositoFinto(iniziale: Record<string, string> = {}) {
  const dati = { ...iniziale };
  return {
    dati,
    getItem: (k: string) => dati[k] ?? null,
    setItem: (k: string, v: string) => { dati[k] = v; },
    removeItem: (k: string) => { delete dati[k]; },
  };
}

describe('la chiave identifica il tentativo, non la spesa', () => {
  it('due spese identiche in momenti diversi hanno chiavi diverse', () => {
    let n = 0;
    const genera = () => `chiave-${++n}`;

    // Martedì: ordina, e l'ordine va a buon fine.
    const d = depositoFinto();
    const primoMartedi = chiaveTentativo(d, genera);
    chiudiTentativo(d);

    // Martedì dopo: stesso identico carrello.
    const secondoMartedi = chiaveTentativo(d, genera);

    expect(secondoMartedi).not.toBe(primoMartedi);
  });

  it('lo stesso invio ripetuto tiene la stessa chiave', () => {
    let n = 0;
    const d = depositoFinto();
    const primo = chiaveTentativo(d, () => `chiave-${++n}`);
    const ripetuto = chiaveTentativo(d, () => `chiave-${++n}`);
    expect(ripetuto).toBe(primo);
  });

  it('una pagina ricaricata a metà invio ritrova la chiave di prima', () => {
    let n = 0;
    const d = depositoFinto();
    const prima = chiaveTentativo(d, () => `chiave-${++n}`);
    // Il componente muore e rinasce: il deposito però resta.
    const dopoIlRicaricamento = chiaveTentativo(d, () => `chiave-${++n}`);
    expect(dopoIlRicaricamento).toBe(prima);
  });

  it('senza deposito (navigazione privata) non si pianta: dà comunque una chiave', () => {
    const k = chiaveTentativo(null, () => 'di-scorta');
    expect(k).toBe('di-scorta');
  });

  it('se il deposito rifiuta di scrivere, non si pianta', () => {
    const rotto = {
      getItem: () => null,
      setItem: () => { throw new Error('memoria negata'); },
      removeItem: vi.fn(),
    };
    expect(chiaveTentativo(rotto, () => 'di-scorta')).toBe('di-scorta');
  });
});

describe('chi arriva secondo sulla stessa chiave', () => {
  it('se gli ordini ci sono già, se li riprende invece di crearne altri', () => {
    expect(decisioneSuChiaveOccupata({ ordiniGia: [{ id: 'o1' }], natoDaMs: 5 }))
      .toBe('restituisci-ordini');
  });

  it('se il gemello sta ancora lavorando, aspetta: il doppione non nasce', () => {
    expect(decisioneSuChiaveOccupata({ ordiniGia: [], natoDaMs: 1_000 }))
      .toBe('gemello-in-corso');
    expect(decisioneSuChiaveOccupata({ ordiniGia: null, natoDaMs: ABBANDONATO_DOPO_MS - 1 }))
      .toBe('gemello-in-corso');
  });

  it('se quell invio è morto per strada, la chiave si libera: il cliente non resta bloccato', () => {
    expect(decisioneSuChiaveOccupata({ ordiniGia: null, natoDaMs: ABBANDONATO_DOPO_MS + 1 }))
      .toBe('chiave-abbandonata');
  });
});
