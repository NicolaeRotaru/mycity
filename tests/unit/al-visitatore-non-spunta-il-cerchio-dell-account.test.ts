/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { schedeInFondo, serveIlPulsanteAccount } from '@/lib/ui/schede-in-fondo';

/**
 * 3/9/2026 — SUL TELEFONO, A CHI NON HA UN ACCOUNT, SPUNTAVA UN CERCHIO GRIGIO SOPRA I PRODOTTI.
 *
 * ── Cosa vedeva chi arrivava per la prima volta ──────────────────────────────────────────────
 * Il caso normale: il QR in vetrina, il volantino, il link su WhatsApp. Si apre MyCity dal
 * telefono, senza aver mai fatto l'accesso. In fondo c'e' la barra con cinque schede — Home,
 * Cerca, Negozi, Carrello, Accedi — e fino a qui tutto giusto. Ma in basso a destra, staccato,
 * galleggiava un SECONDO pulsante tondo bianco da 56 pixel senza scritta, appoggiato sopra la
 * colonna destra della griglia prodotti: proprio dove stanno il prezzo e il pulsante «+».
 * Chi lo toccava apriva un pannello che dice «Ciao / utente» con «Il mio profilo» e
 * «Impostazioni» — due porte che il sito rimanda al login — e un pulsante rosso «Esci»: gli si
 * proponeva di uscire da un account che non ha mai avuto. Attrito e sfiducia nel momento esatto
 * in cui sta decidendo se comprare.
 *
 * ── Perche' si accendeva ─────────────────────────────────────────────────────────────────────
 * La regola condivisa e' «serve solo se fra le schede non c'e' gia' una porta all'account», e
 * guarda solo le schede. Fra quelle del visitatore la porta all'account non c'e' — c'e' «Accedi»,
 * che e' un'altra cosa — quindi rispondeva «serve». La regola era nata per un problema diverso
 * (togliere il doppione al venditore che compra) ed era stata verificata su un ramo solo dei
 * quattro. Mancava la meta' ovvia: un pannello account serve a chi UN ACCOUNT CE L'HA.
 *
 * ── Che prova e' questa ──────────────────────────────────────────────────────────────────────
 * La barra viene MONTATA davvero, con gli stati e gli effetti, una volta per ogni tipo di
 * persona, e si guarda cosa esce a video: e' il comportamento, non una parola cercata in un file.
 * Il primo blocco mostra che la regola condivisa, da sola, direbbe ancora «serve» al visitatore:
 * serve a dire dove il difetto vive ancora, e che qui e' tenuto fuori dalla barra.
 *
 * ⚠️ Cosa questa prova NON copre, e resta aperto: il menu account per «nessun ruolo» continua a
 * elencare «Il mio profilo» e «Impostazioni» (`lib/account-menu.ts`) e il pannello continua a
 * disegnare «Esci» senza condizioni (`components/MobileAccountSheet.tsx`). Da qui quel pannello
 * non si apre piu' — nessuna scheda e nessun cerchio lo aprono — ma le due voci restano da
 * sistemare in quei due file.
 */

/** Le etichette non contano qui: si prova cosa compare, non come si chiama. */
const t = (chiave: string) => chiave;

const CLIENTE = { isAuthenticated: true, isSeller: false, isRider: false, isAdmin: false, sellerShopping: false };
const OSPITE = { ...CLIENTE, isAuthenticated: false };

let Barra: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  const modulo = await monta('components/MobileTabBar.tsx');
  Barra = modulo.default as ComponentType<Record<string, unknown>>;
}, 60000);

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__PROFILO__;
});

/** Monta la barra come la vedrebbe una certa persona, e restituisce cosa c'e' a video. */
function barraPer(profilo: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).__PROFILO__ = profilo;
  (globalThis as Record<string, unknown>).__PERCORSO_FINTO__ = '/';
  const s = accendi(Barra);
  // Il cerchio «Tu» e' l'unico pulsante che galleggia: la barra a schede e' un <nav>, e i suoi
  // pulsanti stanno dentro, non sono `fixed`.
  const cerchio = s.radice.querySelector<HTMLElement>('button.fixed');
  const porteAlPannello = s.radice.querySelectorAll('[aria-haspopup="dialog"]');
  const schede = s.radice.querySelectorAll('nav ul > li');
  return { s, cerchio, porteAlPannello, schede };
}

describe('la regola condivisa, da sola, al visitatore direbbe ancora di si', () => {
  it('fra le schede di chi non ha fatto l accesso non c e nessuna porta all account', () => {
    const schede = schedeInFondo(OSPITE, t);
    expect(schede.some((s) => s.isAccount), 'c e «Accedi», che non e la porta a un account').toBe(false);
    // È il pezzo di difetto che vive fuori dal mio territorio: `serveIlPulsanteAccount` guarda solo
    // le schede, quindi al visitatore risponde «serve». La barra adesso non le crede sulla parola.
    expect(serveIlPulsanteAccount(schede)).toBe(true);
  });
});

describe('la barra in fondo, montata, per chi la guarda', () => {
  it('al visitatore senza account NON esce nessun cerchio sopra i prodotti', () => {
    const { s, cerchio, porteAlPannello, schede } = barraPer({});
    expect(schede.length, 'la barra non e comparsa: la prova non sta guardando niente').toBe(5);
    expect(
      cerchio,
      'a chi non ha un account riappare il cerchio grigio senza scritta, appoggiato sopra prezzo e ' +
        'pulsante «+» della griglia prodotti',
    ).toBeNull();
    expect(
      porteAlPannello.length,
      'a chi non ha un account si riapre una porta al menu account, con dentro «Esci»',
    ).toBe(0);
    s.smonta();
  }, 60000);

  it('al cliente nemmeno: la sua porta all account e gia una scheda della barra', () => {
    const { s, cerchio, porteAlPannello } = barraPer({ isAuthenticated: true, isBuyer: true });
    expect(cerchio, 'due porte per lo stesso pannello: il doppione del 30/8 e tornato').toBeNull();
    expect(porteAlPannello.length, 'la scheda «Tu» deve restare l unica porta').toBe(1);
    s.smonta();
  }, 60000);

  it('al venditore al lavoro il cerchio SERVE ancora: la sua barra non ha la scheda «Tu»', () => {
    // La meta' che non va persa curando l'altra: senza questo pulsante il venditore non ha nessun
    // modo di aprire il suo menu dal telefono.
    const { s, cerchio } = barraPer({ isAuthenticated: true, isSeller: true });
    expect(
      cerchio,
      'il venditore resta senza nessuna porta al proprio account: la cura ha tolto troppo',
    ).not.toBeNull();
    expect(cerchio?.getAttribute('aria-label')).toBe('Tu');
    s.smonta();
  }, 60000);

  it('e all amministratore anche: le sue schede sono tutte di lavoro', () => {
    const { s, cerchio } = barraPer({ isAuthenticated: true, isAdmin: true });
    expect(cerchio, "l amministratore resta senza porta al proprio menu").not.toBeNull();
    s.smonta();
  }, 60000);
});
