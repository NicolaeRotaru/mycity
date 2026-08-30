import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { schedeInFondo, serveIlPulsanteAccount } from '@/lib/ui/schede-in-fondo';

/**
 * 30/8/2026 (R097) — AL VENDITORE IN MODALITA' ACQUISTO COMPARIVA UN SECONDO
 * PULSANTE «TU», SOSPESO IN MEZZO ALLO SCHERMO.
 *
 * Il pulsante tondo che galleggia in basso a destra si disegnava sulla sola
 * condizione «è un venditore o un amministratore». Ma quando il venditore passa
 * in modalità acquisto — cioè quando compra dai colleghi, ed è un cliente a
 * tutti gli effetti — le sue schede diventano quelle di un cliente, e fra
 * quelle la porta all'account c'è già. Due porte per lo stesso pannello.
 *
 * E non era nemmeno appoggiato alla barra: per il venditore la posizione è
 * `bottom-44` (176 px), quindi il cerchio da 56 px restava a metà del bordo
 * destro, sopra la griglia — coprendo prezzo e pulsante «+» di una scheda
 * prodotto su schermi stretti. Chi lo vede non capisce cosa sia.
 *
 * La regola giusta è una domanda sui dati: il pulsante serve solo se fra le
 * schede non c'è già una voce «Io». Scritta così non può tornare fuori
 * sincrono con l'elenco delle schede — che è come il difetto era nato.
 */

/** Le etichette non contano qui: si prova quali schede ci sono, non come si chiamano. */
const t = (chiave: string) => chiave;

const CLIENTE = { isAuthenticated: true, isSeller: false, isRider: false, isAdmin: false, sellerShopping: false };
const VENDITORE = { ...CLIENTE, isSeller: true };
const VENDITORE_CHE_COMPRA = { ...VENDITORE, sellerShopping: true };
const FATTORINO = { ...CLIENTE, isRider: true };
const AMMINISTRATORE = { ...CLIENTE, isAdmin: true };
const OSPITE = { ...CLIENTE, isAuthenticated: false };

describe('il pulsante «Tu» che galleggia', () => {
  it('al venditore che sta comprando NON serve: la sua barra ha gia la voce «Io»', () => {
    const schede = schedeInFondo(VENDITORE_CHE_COMPRA, t);

    expect(
      schede.filter((s) => s.isAccount),
      'in modalita acquisto la barra non ha piu la porta all account',
    ).toHaveLength(1);
    expect(
      serveIlPulsanteAccount(schede),
      'compare un secondo pulsante «Tu» sospeso sopra la griglia dei prodotti',
    ).toBe(false);
  });

  it('al venditore al lavoro serve: la sua barra la voce «Io» non ce l ha', () => {
    const schede = schedeInFondo(VENDITORE, t);
    expect(schede.some((s) => s.isAccount)).toBe(false);
    expect(serveIlPulsanteAccount(schede)).toBe(true);
  });

  it('all amministratore serve, al fattorino e al cliente no', () => {
    expect(serveIlPulsanteAccount(schedeInFondo(AMMINISTRATORE, t))).toBe(true);
    expect(serveIlPulsanteAccount(schedeInFondo(FATTORINO, t))).toBe(false);
    expect(serveIlPulsanteAccount(schedeInFondo(CLIENTE, t))).toBe(false);
  });

  it('mai due porte per lo stesso pannello, per nessuno', () => {
    for (const chi of [CLIENTE, VENDITORE, VENDITORE_CHE_COMPRA, FATTORINO, AMMINISTRATORE, OSPITE]) {
      const schede = schedeInFondo(chi, t);
      const porte = schede.filter((s) => s.isAccount).length + (serveIlPulsanteAccount(schede) ? 1 : 0);
      expect(porte, `due modi diversi di aprire lo stesso pannello per ${JSON.stringify(chi)}`).toBe(1);
    }
  });
});

describe('le schede in fondo, per chi le guarda', () => {
  it('il venditore che compra vede la barra del cliente, non la sua', () => {
    expect(schedeInFondo(VENDITORE_CHE_COMPRA, t).map((s) => s.href)).toEqual(
      schedeInFondo(CLIENTE, t).map((s) => s.href),
    );
  });

  it('sono sempre cinque: e la regola della barra in fondo', () => {
    for (const chi of [CLIENTE, VENDITORE, VENDITORE_CHE_COMPRA, FATTORINO, AMMINISTRATORE, OSPITE]) {
      expect(schedeInFondo(chi, t)).toHaveLength(5);
    }
  });

  it('i numeri delle palline arrivano da fuori', () => {
    const schede = schedeInFondo(CLIENTE, t, { carrello: 3, messaggi: 7 });
    expect(schede.find((s) => s.href === '/cart')?.badge).toBe(3);
    expect(schedeInFondo(VENDITORE, t, { messaggi: 7 }).find((s) => s.href === '/messages')?.badge).toBe(7);
  });
});

/**
 * La guardia strutturale, come in `la-cassa-fa-lo-stesso-conto`: quella qui
 * sopra ESEGUE la regola, questa verifica che la barra la usi davvero invece di
 * riscriversi in casa l'elenco dei ruoli. Da sola non basterebbe; insieme
 * all'altra chiude il difetto.
 */
describe('la barra in fondo non si rifa la regola in casa', () => {
  const barra = readFileSync('components/MobileTabBar.tsx', 'utf8');

  it('chiede a chi di dovere se il pulsante serve', () => {
    expect(barra, 'la barra non usa piu la regola condivisa').toContain('serveIlPulsanteAccount(tabs)');
  });

  it('non decide piu il pulsante guardando i ruoli', () => {
    expect(
      barra,
      'e tornata la condizione sui ruoli: al venditore che compra rispunta il secondo «Tu»',
    ).not.toMatch(/\{\(isSeller \|\| isAdmin\) &&/);
  });
});
