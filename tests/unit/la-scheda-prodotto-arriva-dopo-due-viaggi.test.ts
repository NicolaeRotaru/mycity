import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, hydrate, type DehydratedState } from '@tanstack/react-query';
import { databaseCoiPermessi, OGGI, DOPO_LA_161, type Mondo, type Dati } from './aiuti/database-coi-permessi';
import { domandaProdotto, negozioDellaSchedaOperativo } from '@/lib/queries/catalogo';
import {
  domandaVendutoDa,
  leggiVendutoDa,
  dimenticaLaVistaSenza126,
  motivoDelNo,
} from '@/lib/queries/venduto-da';

/**
 * 16/10/2026 — LA SCHEDA PRODOTTO ASPETTAVA QUATTRO VIAGGI DI RETE, IN FILA, A OGNI VISITA.
 *
 * Il 15/10 il negozio della scheda ha smesso di arrivare agganciato al prodotto (R3) e il guscio
 * ha cominciato a portare anche «Venduto da» (R55). Ogni pezzo con la sua domanda, una dopo
 * l'altra: prodotto → negozio → «Venduto da» completo (in produzione fallisce sempre: la
 * migrazione 126 non c'e') → «Venduto da» ridotto. Il collaudo l'ha misurato col database finto
 * e 50 ms a viaggio: 208 ms, mai piu' di una lettura in volo. Prima del 15/10 erano due viaggi.
 * E il commento del guscio diceva che tanto la pagina e' in cache: non lo e', `app/layout.tsx`
 * e' `force-dynamic`, quindi lo pagava ogni cliente che apriva la focaccia da WhatsApp.
 *
 * Qui si conta la catena VERA: ogni lettura del database finto parte dopo un giro di orologio,
 * e si guarda quante letture stanno una dietro l'altra. Ogni visita ha un client nuovo, come sul
 * server vero (un client per richiesta): la memoria del «no» della 126 deve stare nel processo,
 * non nel client.
 *
 * Seconda meta': un indirizzo storpiato (/store/wp-login.php, un link tagliato) faceva scrivere
 * «la vista pubblica dei negozi non risponde» con la vista che stava benissimo.
 */

const { server } = vi.hoisted(() => ({ server: { client: null as unknown } }));
vi.mock('@/lib/supabase/anonimo', () => ({ creaClientAnonimo: () => server.client }));

const PANE = 'n-pane';
const SEGRETA = 'n-segreta';

function dati(): Dati {
  return {
    profiles: [
      {
        id: PANE, role: 'seller', is_approved: true, store_name: 'Pane Quotidiano',
        store_address: 'Via Roma 1, Piacenza', store_phone: '0523 000000', offers_express: true,
        store_hours: { lun: '7-13' }, store_description: 'Forno a legna',
        business_legal_name: 'Pane Quotidiano', business_form: 'S.r.l.', business_vat_number: '01234567890',
        business_address: 'Via Roma 1', business_city: 'Piacenza', business_zip: '29121',
      },
      { id: SEGRETA, role: 'seller', is_approved: false, store_name: 'Bottega Segreta' },
    ],
    products: [
      { id: 'p-focaccia', name: 'Focaccia al rosmarino', description: 'Lievitata 24 ore', price: 4.5, images: ['f.jpg'], seller_id: PANE, status: 'available', created_at: '2026-10-10', category_id: 'c-forno', stock: 10, has_variants: false },
      { id: 'p-panettone', name: 'Panettone segreto', description: null, price: 19.9, images: null, seller_id: SEGRETA, status: 'available', created_at: '2026-10-11', category_id: 'c-forno', stock: 7, has_variants: false },
    ],
    categories: [{ id: 'c-forno', slug: 'forno', name: 'Forno', parent_id: null }],
  };
}

type Viaggio = { tabella: string; colonne: string; inFila: number };

/**
 * Il database finto, con la rete in mezzo. Ogni lettura risponde dopo un giro di orologio;
 * `inFila` dice quante letture sono state aspettate prima di lei (piu' uno). Due letture che
 * partono insieme hanno lo stesso numero; una che parte dopo la risposta di un'altra, il successivo.
 */
function conLaRete(mondo: Mondo) {
  const vero = databaseCoiPermessi(dati(), mondo, null).client as unknown as { from: (t: string) => object };
  const viaggi: Viaggio[] = [];
  let finite = 0;
  const client = {
    from(tabella: string) {
      const domanda = vero.from(tabella) as Record<string | symbol, unknown> & PromiseLike<unknown>;
      let colonne = '';
      const conRete: object = new Proxy(domanda, {
        get(bersaglio, chiave) {
          if (chiave === 'then') {
            return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
              const viaggio: Viaggio = { tabella, colonne, inFila: finite + 1 };
              viaggi.push(viaggio);
              return new Promise((r) => setTimeout(r, 1))
                .then(() => Promise.resolve(bersaglio.then((x) => x)))
                .then((risposta) => {
                  finite = Math.max(finite, viaggio.inFila);
                  return risposta;
                })
                .then(ok, ko);
            };
          }
          const valore = bersaglio[chiave];
          if (typeof valore !== 'function') return valore;
          return (...argomenti: unknown[]) => {
            if (chiave === 'select') colonne = String(argomenti[0] ?? '*');
            (valore as (...a: unknown[]) => unknown).apply(bersaglio, argomenti);
            return conRete;
          };
        },
      });
      return conRete;
    },
  };
  return { client, viaggi, catena: () => Math.max(0, ...viaggi.map((v) => v.inFila)) };
}

/** Una visita alla scheda: un client nuovo, come una richiesta nuova sul server vero. */
async function visita(mondo: Mondo, id = 'p-focaccia') {
  const rete = conLaRete(mondo);
  server.client = rete.client;
  const { precaricaProdotto } = await import('@/lib/queries/precarico');
  const stato = await precaricaProdotto(id);
  return { stato, viaggi: rete.viaggi, catena: rete.catena() };
}

/** Un database che non deve essere chiamato: se il browser va in rete, lo dice. */
const esplode = {
  from: () => {
    throw new Error('il browser e andato in rete: la risposta del server non e servita');
  },
};

function browserCon(stato: DehydratedState) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
  hydrate(qc, stato);
  return qc;
}

let righeDiErrore: string[] = [];
let righeDiAvviso: string[] = [];
const ORA_ZERO = Date.UTC(2026, 9, 16, 9, 0, 0);

beforeEach(() => {
  dimenticaLaVistaSenza126();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ORA_ZERO);
  righeDiErrore = [];
  righeDiAvviso = [];
  vi.spyOn(console, 'error').mockImplementation((r: unknown) => void righeDiErrore.push(String(r)));
  vi.spyOn(console, 'warn').mockImplementation((r: unknown) => void righeDiAvviso.push(String(r)));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  server.client = null;
});

const avvisiDella126 = () => righeDiAvviso.filter((r) => r.includes('126'));

describe('il guscio della scheda prodotto: quanti viaggi in fila prima di mostrare il prodotto', () => {
  it('oggi in produzione (senza la 126): la prima scheda del processo ne fa tre, tutte le altre due', async () => {
    const prima = await visita(OGGI);
    expect(prima.viaggi.map((v) => v.tabella)).toEqual(['products', 'seller_public_profiles', 'seller_public_profiles']);
    expect(prima.catena).toBe(3);
    expect(avvisiDella126(), 'il no della 126 deve lasciare una riga nei registri del server').toHaveLength(1);

    const seconda = await visita(OGGI);
    expect(
      seconda.viaggi.map((v) => v.tabella),
      'la lettura destinata a fallire riparte a ogni visita: il no della 126 non e ricordato',
    ).toEqual(['products', 'seller_public_profiles']);
    expect(seconda.catena, 'prima di vedere il prodotto il cliente aspetta piu di due viaggi in fila').toBe(2);
    expect(seconda.viaggi[1]!.colonne).not.toContain('business_');
    expect(avvisiDella126(), 'una riga a ogni visita: il registro si riempie della stessa frase').toHaveLength(1);
  });

  it('dopo la 126: due viaggi in fila, e il riquadro ha ragione sociale e partita IVA', async () => {
    const { stato, viaggi, catena } = await visita(DOPO_LA_161);
    expect(viaggi.map((v) => v.tabella)).toEqual(['products', 'seller_public_profiles']);
    expect(catena).toBe(2);

    const browser = browserCon(stato);
    const venduto = await browser.fetchQuery(domandaVendutoDa(esplode, PANE));
    expect(venduto).toMatchObject({ business_legal_name: 'Pane Quotidiano', business_vat_number: '01234567890' });
    expect(avvisiDella126()).toEqual([]);
  });

  it.each<[string, Mondo]>([
    ['oggi in produzione', OGGI],
    ['dopo la 126', DOPO_LA_161],
  ])('la scheda e «Venduto da» arrivano con la forma che il browser si farebbe da solo — %s', async (_n, mondo) => {
    await visita(mondo); // la prima visita, quella che impara se la 126 c'e'
    const { stato } = await visita(mondo);
    const browser = browserCon(stato);
    const scheda = await browser.fetchQuery(domandaProdotto(esplode, 'p-focaccia'));
    const venduto = await browser.fetchQuery(domandaVendutoDa(esplode, PANE));

    // Le stesse domande, fatte dal browser da solo contro lo stesso database.
    const daSolo = databaseCoiPermessi(dati(), mondo, null).client;
    expect(scheda).toEqual(await domandaProdotto(daSolo, 'p-focaccia').queryFn());
    expect(venduto).toEqual(await leggiVendutoDa(daSolo, PANE));
    expect(negozioDellaSchedaOperativo(scheda!)).toBe(true);
  });

  it('il no della 126 si ricorda dieci minuti e non di piu, anche con le visite che continuano', async () => {
    await visita(OGGI);
    // Le visite continuano ogni tre minuti: usare la memoria non deve allungarla.
    for (const minuti of [3, 6, 9]) {
      vi.setSystemTime(ORA_ZERO + minuti * 60_000);
      const { viaggi } = await visita(OGGI);
      expect(viaggi).toHaveLength(2);
    }
    // Nicola applica la 126. Dentro i dieci minuti il riquadro resta ridotto: e' il prezzo della memoria.
    vi.setSystemTime(ORA_ZERO + 9 * 60_000 + 59_000);
    const ancoraRidotto = await visita(DOPO_LA_161);
    expect(browserCon(ancoraRidotto.stato).getQueryData(['venduto-da', PANE])).toMatchObject({ business_vat_number: null });

    // Passati i dieci minuti si richiede tutto: la partita IVA torna senza riavviare niente.
    vi.setSystemTime(ORA_ZERO + 10 * 60_000 + 1_000);
    const dopo = await visita(DOPO_LA_161);
    expect(dopo.viaggi[1]!.colonne, 'la memoria non scade: la 126 applicata non si vedrebbe piu').toContain('business_vat_number');
    const venduto = await browserCon(dopo.stato).fetchQuery(domandaVendutoDa(esplode, PANE));
    expect(venduto).toMatchObject({ business_vat_number: '01234567890' });
  });

  it('per il prodotto di un negozio non approvato non porta «Venduto da», e la scheda dice non operativo', async () => {
    const rete = conLaRete({ ...DOPO_LA_161, prodottiDeiNonApprovatiVisibili: true });
    server.client = rete.client;
    const { precaricaProdotto } = await import('@/lib/queries/precarico');
    const stato = await precaricaProdotto('p-panettone');
    expect(stato.queries.map((q) => q.queryKey[0])).toEqual(['products']);
    const scheda = await browserCon(stato).fetchQuery(domandaProdotto(esplode, 'p-panettone'));
    expect(negozioDellaSchedaOperativo(scheda!)).toBe(false);
  });

  it('se la vista dei negozi non risponde, il server non consegna una scheda «non operativa»: il browser riprova', async () => {
    const vero = databaseCoiPermessi(dati(), DOPO_LA_161, null).client;
    server.client = {
      from: (t: string) =>
        t === 'seller_public_profiles'
          ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '08006', message: 'connessione persa' } }) }) }) }
          : vero.from(t),
    };
    const { precaricaProdotto } = await import('@/lib/queries/precarico');
    const stato = await precaricaProdotto('p-focaccia');
    expect(stato.queries, 'una scheda senza negozio direbbe «il negozio non e operativo» a un negozio che lo e').toEqual([]);
    expect(righeDiErrore.filter((r) => r.includes('non risponde')), 'il guasto vero deve restare nei registri').toHaveLength(1);
  });
});

/** Un database che risponde come Postgres a un id che non e' un codice valido. */
function databaseCheNonCapisceLId() {
  const chieste: string[] = [];
  const catena: Record<string, unknown> = {
    select: (c: string) => {
      chieste.push(c);
      return catena;
    },
    eq: () => catena,
    in: () => catena,
    maybeSingle: async () => ({
      data: null,
      error: { code: '22P02', message: 'invalid input syntax for type uuid: "wp-login.php"' },
    }),
  };
  return { client: { from: () => catena }, chieste };
}

describe('un indirizzo di negozio storpiato non e un guasto della vista', () => {
  it('Postgres risponde 22P02: e un negozio che non puo esistere, non una vista rotta', () => {
    expect(motivoDelNo({ code: '22P02', message: 'invalid input syntax for type uuid' })).toBe('id-impossibile');
    expect(motivoDelNo({ code: '42703', message: 'column does not exist' })).toBe('mancano-le-colonne');
    expect(motivoDelNo({ code: '08006', message: 'connessione persa' })).toBe('guasto');
  });

  it('«Venduto da» per un id storpiato: nessun riquadro, e nessuna riga nei registri', async () => {
    const { client } = databaseCheNonCapisceLId();
    expect(await leggiVendutoDa(client, 'wp-login.php')).toBeNull();
    expect(righeDiErrore, 'falso allarme: «la vista pubblica dei negozi non risponde»').toEqual([]);
    expect(righeDiAvviso).toEqual([]);
  });

  it('la pagina del negozio aperta da un robot (/store/wp-login.php) non scrive «non risponde»', async () => {
    server.client = databaseCheNonCapisceLId().client;
    const { precaricaNegozio } = await import('@/lib/queries/precarico');
    await precaricaNegozio('wp-login.php');
    expect(righeDiErrore.filter((r) => r.includes('non risponde'))).toEqual([]);
    expect(righeDiErrore).toEqual([]);
  });

  it('anche quando la memoria della 126 e accesa e la domanda e quella ridotta', async () => {
    await visita(OGGI); // il processo impara che la 126 manca
    righeDiErrore = [];
    const { client, chieste } = databaseCheNonCapisceLId();
    expect(await leggiVendutoDa(client, 'wp-login.php')).toBeNull();
    expect(chieste[0], 'qui doveva partire la domanda ridotta').not.toContain('business_');
    expect(righeDiErrore).toEqual([]);
  });

  it('un 22P02 non viene preso per «manca la 126»: il negozio vero dopo riceve il riquadro completo', async () => {
    await leggiVendutoDa(databaseCheNonCapisceLId().client, 'wp-login.php');
    const dati126 = await leggiVendutoDa(databaseCoiPermessi(dati(), DOPO_LA_161, null).client, PANE);
    expect(dati126).toMatchObject({ business_vat_number: '01234567890' });
    expect(avvisiDella126()).toEqual([]);
  });

  it('un guasto vero, invece, resta un guasto: errore nei registri e la domanda fallisce', async () => {
    const rotto = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '08006', message: 'connessione persa' } }) }) }),
      }),
    };
    await expect(leggiVendutoDa(rotto, PANE)).rejects.toMatchObject({ code: '08006' });
    expect(righeDiErrore.filter((r) => r.includes('non risponde'))).toHaveLength(1);
  });
});
