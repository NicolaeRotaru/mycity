// La scheda del cliente deve trovare quello che c'è (28/11/2026).
// La prova vera, il 28/11 tra le 02:10 e le 02:20: la routine «Chiedi all'AD» è stata lanciata sulle 10 attività
// della mappa dei venditori, col compito di allora. In modalità standard non ha trovato niente per 6 su 7,
// e ha consigliato un abbonamento a due negozi chiusi per sempre. Le stesse ricerche in «extended» hanno trovato
// telefono, orari, profili e storia (per esempio Torrefazione Pelizzeni e Solo Cose Belle).
// Questi controlli tengono ferme le regole: se qualcuno le toglie, diventano rossi.
import { describe, expect, it } from 'vitest';
import { COMPITO } from '@/lib/agenti/compito';
import { leggiOverpass } from '@/lib/agenti/osm';

describe('il compito della scheda del cliente', () => {
  it('chiede le ricerche in modalità «extended», mai «standard»', () => {
    expect(COMPITO).toContain('SEMPRE con WebSearch in modalità «extended», mai «standard»');
  });

  it('la prima ricerca usa anche la via, per trovare gli elenchi giusti', () => {
    expect(COMPITO).toContain('1. «<nome> <via> <città>»');
    expect(COMPITO).toMatch(/PagineGialle, Virgilio, PagineBianche/);
  });

  it('il sito trovato va in «sito.url», così il programma lo misura', () => {
    expect(COMPITO).toContain('mettilo SEMPRE in «sito.url», anche se non l\'hai aperto');
  });

  it('dice di controllare se l’attività è chiusa, trasferita o ha cambiato nome', () => {
    expect(COMPITO).toContain('chiuso definitivamente');
    expect(COMPITO).toContain('prima voce di «in_30_secondi» e di «attenzione»');
  });

  it('resta sotto il tetto del flusso 14', () => {
    expect(COMPITO.length).toBeLessThan(30000);
  });
});

// Il 28/11, 6 attività su 10 della mappa erano «shop=food» su OpenStreetMap: la scheda non sapeva che tipo
// fossero e contava zero concorrenti vicini. Ora «shop=food» è «Alimentari» e sta con gastronomie e macellerie.
describe('la mappa libera riconosce gli alimentari generici', () => {
  const elementi = [
    { type: 'node', id: 1, lat: 45.053, lon: 9.6912, tags: { name: 'Spaccio Serafini', shop: 'food' } },
    { type: 'node', id: 2, lat: 45.0531, lon: 9.6913, tags: { name: 'Il Pollivendolo', shop: 'butcher' } },
    { type: 'node', id: 3, lat: 45.0532, lon: 9.6914, tags: { name: 'Bar lontano dal tipo', amenity: 'bar' } },
  ];
  it('dà il tipo «Alimentari» e conta la macelleria vicina come concorrente', () => {
    const r = leggiOverpass(elementi as never, 45.053, 9.6912, 'Spaccio Serafini', 450);
    expect(r.luogo?.tipo).toBe('Alimentari');
    expect(r.concorrenti.map((c) => c.nome)).toEqual(['Il Pollivendolo']);
  });
});
