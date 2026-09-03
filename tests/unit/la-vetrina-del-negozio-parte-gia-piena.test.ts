/**
 * 3/9/2026 — LA PAGINA DEL NEGOZIO ARRIVAVA VUOTA E SI RIEMPIVA DOPO.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────
 * La vetrina è un componente del browser. Nome, orari, copertina, sezioni: se li
 * andava a prendere DOPO aver scaricato ed eseguito il JavaScript. Chi apriva un
 * negozio da un telefono in 4G vedeva quindi lo scheletro del server, poi la
 * pagina che si svuotava per l'attesa del browser, e alla fine il negozio.
 *
 * ── Il punto delicato, e il motivo per cui questa prova esiste ───────────────
 * Perché il lavoro del server serva a qualcosa, la domanda che fa lui e quella
 * che fa il browser devono essere LA STESSA: stessa chiave e stessa forma della
 * risposta. Se differiscono anche solo di una lettera nella chiave, il browser
 * non riconosce quello che ha in mano e va in rete lo stesso — il precarico
 * diventa un viaggio in più invece di uno in meno, e nessuno se ne accorge
 * perché la pagina funziona uguale.
 *
 * Qui le due chiavi si confrontano davvero, una accanto all'altra, e poi si fa
 * girare il precarico vero e la domanda come la farebbe il browser, con un
 * database che ESPLODE se qualcuno lo chiama.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, hydrate } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';
import { domandaNegozio } from '@/lib/queries/catalogo';

const NEGOZIO = {
  id: 'negozio-1',
  store_name: 'Salumeria del Borgo',
  store_phone: '+39 0523 000000',
  store_address: 'Via Roma 1, Piacenza',
  store_lat: 45.05,
  store_lng: 9.7,
  is_approved: true,
  stripe_charges_enabled: true,
  stripe_payouts_enabled: true,
  store_logo: null,
  store_hours: null,
  store_media: null,
  store_description: 'Salumi piacentini',
  store_customization: null,
  store_site: null,
  founded_year: 1978,
};

/** Cosa ha chiesto il server, e con quale elenco di colonne. */
const letture: Array<{ tabella: string; colonne: string }> = [];
let clienteRotto = false;
/** Il database finge di non avere ancora le colonne della migrazione 124. */
let schemaIndietro = false;

vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => {
    if (clienteRotto) throw new Error('variabili di configurazione mancanti');
    return {
      from: (tabella: string) => {
        let colonne = '';
        const catena: Record<string, unknown> = {
          select: (c: string) => {
            colonne = c;
            return catena;
          },
          eq: () => catena,
          maybeSingle: async () => {
            letture.push({ tabella, colonne });
            // Prima della 124 la vista non ha le due colonne di Stripe: il
            // database non le ignora, rifiuta la lettura intera.
            if (schemaIndietro && colonne.includes('stripe_charges_enabled')) {
              return { data: null, error: { code: '42703', message: 'column does not exist' } };
            }
            return { data: NEGOZIO, error: null };
          },
        };
        return catena;
      },
    };
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

/** Un database che non deve essere chiamato: se lo chiamano, la prova lo dice. */
const databaseCheEsplode = {
  from: () => {
    throw new Error('il browser è andato in rete: il precarico del server non è servito a niente');
  },
};

/** Un browser come quello vero: stessa cache, stesso mezzo minuto di freschezza. */
function browser() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 30 * 1000, retry: false } } });
}

beforeEach(() => {
  letture.length = 0;
  clienteRotto = false;
  schemaIndietro = false;
});

describe('le due domande sul negozio sono la stessa domanda', () => {
  it('la chiave della pagina è quella del registro delle chiavi, non una simile', () => {
    expect(domandaNegozio(databaseCheEsplode, 'negozio-1').queryKey)
      .toEqual(queryKeys.stores.detail('negozio-1'));
  });

  it('la chiave con cui il server mette via è LA STESSA con cui il browser va a cercare', async () => {
    const { precaricaNegozio } = await import('@/lib/queries/precarico');
    const statoDalServer = await precaricaNegozio('negozio-1');

    // È il confronto che il difetto chiedeva: le due chiavi, una accanto
    // all'altra. Una lettera di differenza qui e tutto il resto è inutile.
    expect(
      statoDalServer.queries.map((q) => q.queryKey),
      'il server non ha messo via niente sotto nessuna chiave',
    ).toContainEqual(queryKeys.stores.detail('negozio-1'));

    const chiaveDelServer = statoDalServer.queries[0]!.queryKey;
    const chiaveDelBrowser = domandaNegozio(databaseCheEsplode, 'negozio-1').queryKey;
    expect(chiaveDelServer).toEqual(chiaveDelBrowser);
  });

  it('e chiedono le stesse colonne: una forma diversa e la pagina rilegge tutto', async () => {
    const { precaricaNegozio } = await import('@/lib/queries/precarico');
    await precaricaNegozio('negozio-1');

    const hook = readFileSync(join(process.cwd(), 'components/store-sections/useStorePageData.ts'), 'utf8');
    expect(
      hook,
      'la vetrina si è riscritta la sua domanda invece di usare quella condivisa: le due possono divergere',
    ).toContain('domandaNegozio(supabase, id)');
    expect(hook, 'nel componente è tornato un elenco di colonne scritto a mano').not.toContain('seller_public_profiles');

    expect(letture[0]?.tabella).toBe('seller_public_profiles');
    expect(letture[0]?.colonne).toContain('store_customization');
    expect(letture[0]?.colonne).toContain('store_site');
  });
});

describe('la vetrina del negozio', () => {
  it('arriva al browser già piena: la pagina non chiede più niente al database', async () => {
    const { precaricaNegozio } = await import('@/lib/queries/precarico');
    const statoDalServer = await precaricaNegozio('negozio-1');

    const qc = browser();
    hydrate(qc, statoDalServer);

    // Poi il browser fa la SUA domanda, quella scritta dentro il componente.
    // Se la chiave non coincidesse, qui partirebbe una lettura vera — e il
    // database esplode.
    const negozio = await qc.fetchQuery(domandaNegozio(databaseCheEsplode, 'negozio-1'));

    expect(negozio, 'il negozio non è arrivato dentro la pagina').not.toBeNull();
    expect(negozio!.store_name).toBe('Salumeria del Borgo');
    expect(negozio!.founded_year).toBe(1978);
  });

  it('il guscio della pagina consegna davvero il precarico alla pagina', () => {
    // Un precarico che nessuno consegna è lavoro fatto e buttato: è esattamente
    // la forma del difetto di partenza. Non basta che la parola compaia nel
    // file — la riga dell'import la contiene comunque: si guarda che il valore
    // letto dal server sia PROPRIO quello che avvolge la pagina.
    const src = readFileSync(join(process.cwd(), 'app/store/[id]/layout.tsx'), 'utf8');

    const nome = src.match(/const\s+(\w+)\s*=\s*await\s+precaricaNegozio\(/)?.[1];
    expect(nome, 'il guscio non legge più il negozio sul server').toBeTruthy();

    const consegna = new RegExp(
      `<HydrationBoundary\\s+state=\\{${nome}\\}>\\s*\\{[\\w.]*children\\}\\s*</HydrationBoundary>`,
    );
    expect(
      src,
      'il negozio viene letto sul server ma non arriva alla pagina: il viaggio è fatto e buttato',
    ).toMatch(consegna);
  });
});

describe('quello che c’era prima non si è perso per strada', () => {
  it('se la migrazione 124 non è ancora applicata, il negozio si legge lo stesso', async () => {
    // La domanda è stata spostata di file: il ripiego sulle due colonne di
    // Stripe doveva venire con lei. Senza, dal minuto dell'unione a quello
    // della firma sul database la vetrina non si aprirebbe affatto.
    schemaIndietro = true;
    const { precaricaNegozio } = await import('@/lib/queries/precarico');

    const qc = browser();
    hydrate(qc, await precaricaNegozio('negozio-1'));
    const negozio = await qc.fetchQuery(domandaNegozio(databaseCheEsplode, 'negozio-1'));

    expect(letture.length, 'non ha riprovato senza le colonne nuove').toBe(2);
    expect(letture[1]!.colonne, 'ha riprovato con le stesse colonne di prima').not.toContain('stripe_charges_enabled');
    expect(negozio?.store_name, 'su un database indietro la vetrina resta chiusa').toBe('Salumeria del Borgo');
  });

  it('se il precarico non riesce, la pagina si apre lo stesso', async () => {
    // Un precarico è un'ottimizzazione, non un requisito: una pagina che non si
    // apre perché il server non ha potuto leggere sarebbe molto peggio del
    // problema che questo risolve.
    clienteRotto = true;
    const { precaricaNegozio } = await import('@/lib/queries/precarico');

    const stato = await precaricaNegozio('negozio-1');

    expect(stato, 'il precarico ha lanciato: la pagina non si aprirebbe').toBeTruthy();
    expect(stato.queries, 'senza dati il precarico deve essere vuoto, non inventato').toHaveLength(0);
    expect(letture, 'con la configurazione rotta non si tenta nemmeno la lettura').toEqual([]);
  });
});
