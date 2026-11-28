/**
 * 27/11/2026 — DOPO «ESCI» LA PAGINA RESTAVA SU «CARICAMENTO…» PER SEMPRE.
 *
 * Nicola, dal telefono, uscendo dall'area dell'amministratore: la rotellina non
 * finiva più, con «Accedi» nella barra in basso. La causa sta nella coda dei cambi
 * pagina di Next (perché, in lib/auth/uscita.ts): se l'area riservata chiede
 * l'accesso mentre la sessione si chiude, il tasto lo richiede, e poi arriva un
 * `router.refresh()`, il rinfresco si aggancia al cambio pagina scartato e la sua
 * attesa non si chiude più.
 *
 * Qui gira la coda VERA di Next (createMutableActionQueue, quella del sito). Del
 * motore si finge solo la risposta del server: ogni cambio pagina «arriva» dopo
 * pochi millesimi. «Lo schermo» è l'ultimo stato chiesto a React, cioè quello che
 * la pagina disegnerà: se la sua attesa non si chiude, la pagina resta ferma.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { esciEVaiAllAccesso } from '@/lib/auth/uscita';

// Nel sito il costruttore di Next dà al router la sua copia di react-server-dom-webpack, che serve
// solo a leggere le pagine dal server: qui il server è finto, e al suo posto va un segnaposto. La
// coda caricata dopo è quella del pacchetto di Next, non una copia.
const richiedi = createRequire(import.meta.url);
const copiaDiNext = path.resolve(__dirname, 'aiuti/finti/rsc-client-vuoto.cjs');
const risolvi = (Module as unknown as { _resolveFilename: (r: string, ...resto: unknown[]) => string })._resolveFilename;
(Module as unknown as { _resolveFilename: typeof risolvi })._resolveFilename = (r, ...resto) =>
  risolvi(r === 'react-server-dom-webpack/client' ? copiaDiNext : r, ...resto);
const { createMutableActionQueue } = richiedi('next/dist/client/components/app-router-instance') as {
  createMutableActionQueue: (stato: unknown, ganci: null) => unknown;
};
const { ACTION_NAVIGATE, ACTION_REFRESH } = richiedi('next/dist/client/components/router-reducer/router-reducer-types') as {
  ACTION_NAVIGATE: string;
  ACTION_REFRESH: string;
};

const BASE = 'http://localhost';
const FERMO = 'ancora in caricamento';

type Schermo = { dove: string };

function sitoConLaCodaDiNext(partenza: string) {
  const coda = createMutableActionQueue({ dove: partenza }, null) as {
    action: (stato: Schermo, azione: { type: string; url?: URL }) => Promise<Schermo>;
    dispatch: (azione: Record<string, unknown>, setState: (s: unknown) => void) => void;
  };
  // Al posto del server: il cambio pagina arriva dopo 10 ms, il rinfresco resta dov'è.
  coda.action = (stato, azione) =>
    new Promise((fatto) =>
      setTimeout(() => fatto({ dove: azione.type === ACTION_NAVIGATE && azione.url ? azione.url.pathname + azione.url.search : stato.dove }), 10),
    );
  let schermo: unknown = { dove: partenza };
  const setState = (s: unknown) => {
    schermo = s;
  };
  const naviga = (href: string, navigateType: 'push' | 'replace') =>
    coda.dispatch(
      { type: ACTION_NAVIGATE, url: new URL(href, BASE), isExternalUrl: false, locationSearch: '', shouldScroll: true, navigateType, allowAliasing: true },
      setState,
    );
  const router = {
    push: (href: string) => naviga(href, 'push'),
    replace: (href: string) => naviga(href, 'replace'),
    refresh: () => coda.dispatch({ type: ACTION_REFRESH, origin: BASE }, setState),
  };
  /** Dove si ferma la pagina: l'indirizzo, oppure FERMO se l'attesa non si chiude entro un secondo. */
  const doveSiFerma = async (): Promise<string> => {
    const finale = await Promise.race([
      Promise.resolve(schermo as Schermo | Promise<Schermo>),
      new Promise<null>((r) => setTimeout(() => r(null), 1000)),
    ]);
    return finale ? finale.dove : FERMO;
  };
  return { router, doveSiFerma };
}

/**
 * La chiusura della sessione come la vede il sito: il layout di /admin, /seller o /rider si
 * accorge subito che non c'è più nessuno e chiede lui l'accesso, prima che `signOut` finisca.
 */
const chiusuraConLAreaRiservata = (router: { replace: (h: string) => void }, doveVaLArea: string) => async () => {
  router.replace(doveVaLArea);
};

describe('dopo «Esci» la pagina va all\'accesso e non resta in caricamento', () => {
  it('il vecchio «Esci» (cambio pagina + rinfresco) si blocca davvero con la coda di Next', async () => {
    // Se questa parte fallisce dopo un aggiornamento di Next, la trappola l'hanno chiusa loro.
    // Finché passa, dice che la prova sotto sa vedere il difetto.
    const { router, doveSiFerma } = sitoConLaCodaDiNext('/admin/today');
    await chiusuraConLAreaRiservata(router, '/sign-in')();
    router.push('/sign-in');
    router.refresh();
    expect(await doveSiFerma()).toBe(FERMO);
  });

  it.each([
    ['amministratore', '/admin/today', '/sign-in'],
    ['negozio', '/seller/dashboard', '/sign-in?returnTo=/seller'],
    ['fattorino', '/rider', '/sign-in?returnTo=/rider'],
  ])('dall\'area %s si arriva alla pagina di accesso', async (_area, partenza, doveVaLArea) => {
    const { router, doveSiFerma } = sitoConLaCodaDiNext(partenza);
    await esciEVaiAllAccesso(router, { esci: chiusuraConLAreaRiservata(router, doveVaLArea) });
    expect(await doveSiFerma()).toBe('/sign-in');
  });

  it('dopo il cambio della password si torna all\'accesso con il ritorno alle impostazioni', async () => {
    const { router, doveSiFerma } = sitoConLaCodaDiNext('/profile/settings');
    const verso = `/sign-in?returnTo=${encodeURIComponent('/profile/settings')}`;
    await esciEVaiAllAccesso(router, { verso, esci: chiusuraConLAreaRiservata(router, '/sign-in?returnTo=/profile/settings') });
    expect(await doveSiFerma()).toBe(verso);
  });

  it('nessun «Esci» del sito rimette il rinfresco dopo la chiusura della sessione', () => {
    const radice = path.resolve(__dirname, '../..');
    const sorgenti: string[] = [];
    const visita = (cartella: string) => {
      for (const nome of readdirSync(cartella)) {
        const pieno = path.join(cartella, nome);
        if (statSync(pieno).isDirectory()) visita(pieno);
        else if (/\.(tsx?|jsx?)$/.test(nome)) sorgenti.push(pieno);
      }
    };
    for (const c of ['app', 'components', 'lib']) visita(path.join(radice, c));
    // Collaudo del 27/11: il rinfresco torna anche scritto dopo la funzione nuova, col router chiamato
    // in un altro modo, sulla stessa riga o dopo qualche riga di commento. Si guarda la chiusura della
    // sessione (o la funzione) e le dieci righe dopo, qualunque sia il nome del router.
    const chiusura = /auth\.signOut\(|esciEVaiAllAccesso\(/;
    const rinfresco = /\.refresh\(\s*\)/;
    const colpevoli = sorgenti.filter((f) => {
      if (f.endsWith(path.join('lib', 'auth', 'uscita.ts'))) return false; // qui il rinfresco è solo nella spiegazione
      const righe = readFileSync(f, 'utf8').split('\n');
      return righe.some((r, i) => chiusura.test(r) && righe.slice(i, i + 11).some((dopo) => rinfresco.test(dopo)));
    });
    expect(colpevoli.map((f) => path.relative(radice, f))).toEqual([]);
  });
});
