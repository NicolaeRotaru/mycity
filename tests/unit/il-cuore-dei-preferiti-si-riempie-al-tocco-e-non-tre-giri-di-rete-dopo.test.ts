/**
 * 3/9/2026 — IL CUORE DEI PREFERITI SI RIEMPIVA TRE GIRI DI RETE DOPO IL TOCCO.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────
 * Si toccava il cuore su una scheda di catalogo e restava grigio. Doveva prima partire la domanda
 * «chi sei» al servizio di accesso, poi la riga scritta nel database, poi la rilettura dell'intero
 * elenco dei preferiti: solo alla fine di quei tre giri il cuore diventava pieno. L'unica cosa
 * immediata era il battito dell'animazione, su un cuore che non era cambiato.
 *
 * Su una rete lenta chi compra tocca due o tre volte, convinto di aver sbagliato mira. E ogni tocco
 * in più è una riga in più che il database poi rifiuta, perché la coppia (utente, prodotto) è unica.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────
 * Non che da qualche parte ci sia scritta la parola «ottimistico». ESEGUE le regole del tocco
 * (`lib/preferiti/tocco-del-cuore.ts`) dentro la cache vera di react-query, con un finto server che
 * risponde quando decidiamo noi:
 *
 *   ① nell'istante in cui la scrittura parte — cioè prima di qualunque risposta — il cuore che si
 *      vede è già cambiato;
 *   ② se il server RIFIUTA, il cuore torna esattamente com'era: un cuore pieno su un preferito che
 *      non è stato salvato è la stessa bugia di prima, girata dall'altra parte;
 *   ③ quello che si scrive è quello che si vede, anche a due tocchi rapidi: aggiungi e poi togli,
 *      mai due volte aggiungi (che il database rifiuterebbe come doppione);
 *   ④ senza la lista in mano non si ribalta niente e non si scrive alla cieca: «non lo so» non
 *      diventa un sì.
 *
 * ⚠️ Cosa NON prova: che a schermo il battito e il colore siano gradevoli. Qui non c'è un browser:
 * l'occhio su un telefono vero resta da fare.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import {
  CHIAVE_PREFERITI,
  PREFERITI_NON_LETTI,
  insiemeDopoIlTocco,
  opzioniDelTocco,
  versoDaScrivere,
  type Verso,
} from '@/lib/preferiti/tocco-del-cuore';

/**
 * Il banco di prova: la cache vera, e un server che risponde quando lo diciamo noi.
 * `inizio` a `undefined` = la lista non è mai stata letta (il terzo stato).
 */
function banco(inizio?: string[]) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  if (inizio) qc.setQueryData(CHIAVE_PREFERITI, new Set<string>(inizio));

  const scritte: Array<{ id: string; verso: Verso }> = [];
  let laScritturaEPartita!: () => void;
  const partita = new Promise<void>((res) => {
    laScritturaEPartita = res;
  });
  let rispondi!: (esito: 'accetta' | Error) => void;
  const risposta = new Promise<void>((res, rej) => {
    rispondi = (esito) => (esito === 'accetta' ? res() : rej(esito));
  });

  const osservatore = new MutationObserver(
    qc,
    opzioniDelTocco(qc, async (id, verso) => {
      scritte.push({ id, verso });
      laScritturaEPartita();
      await risposta;
    }),
  );

  return {
    scritte,
    partita,
    rispondi,
    /** I cuori come li vede chi guarda la pagina in questo istante. */
    cuori: () => qc.getQueryData<Set<string>>(CHIAVE_PREFERITI),
    tocca: (id: string) => osservatore.mutate(id).catch((e: unknown) => e),
  };
}

/** Lo stesso banco, ma il server dice sempre di sì all'istante: serve per i tocchi rapidi. */
function bancoRapido(inizio: string[]) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData(CHIAVE_PREFERITI, new Set<string>(inizio));
  const scritte: Array<{ id: string; verso: Verso }> = [];
  const osservatore = new MutationObserver(
    qc,
    opzioniDelTocco(qc, async (id, verso) => {
      scritte.push({ id, verso });
    }),
  );
  return {
    scritte,
    cuori: () => qc.getQueryData<Set<string>>(CHIAVE_PREFERITI),
    tocca: (id: string) => osservatore.mutate(id).catch((e: unknown) => e),
  };
}

describe('① il cuore cambia sotto il dito, non tre giri di rete dopo', () => {
  it('quando la scrittura parte, il cuore che si vede è già pieno', async () => {
    const b = banco([]);
    const inVolo = b.tocca('pane-1');

    // Qui il server non ha ancora risposto: siamo nell'istante in cui prima restava grigio.
    await b.partita;
    expect(
      [...(b.cuori() ?? [])],
      'il cuore resta vuoto finché il server non risponde: chi tocca crede di aver sbagliato mira',
    ).toContain('pane-1');

    b.rispondi('accetta');
    await inVolo;
    expect([...(b.cuori() ?? [])]).toContain('pane-1');
  });

  it('e togliere è immediato allo stesso modo', async () => {
    const b = banco(['pane-1', 'libro-2']);
    const inVolo = b.tocca('pane-1');

    await b.partita;
    expect(b.cuori()).toEqual(new Set(['libro-2']));

    b.rispondi('accetta');
    await inVolo;
  });
});

describe('② se il server rifiuta, il cuore torna com’era', () => {
  it("un'aggiunta rifiutata non lascia il cuore pieno", async () => {
    const b = banco(['libro-2']);
    const inVolo = b.tocca('pane-1');

    await b.partita;
    expect(b.cuori()).toEqual(new Set(['libro-2', 'pane-1']));

    b.rispondi(new Error('il database ha detto no'));
    await inVolo;
    expect(
      b.cuori(),
      'resta un cuore pieno su un preferito che non è stato salvato: la bugia di prima, girata',
    ).toEqual(new Set(['libro-2']));
  });

  it('e una rimozione rifiutata non lascia il cuore vuoto', async () => {
    const b = banco(['pane-1', 'libro-2']);
    const inVolo = b.tocca('pane-1');

    await b.partita;
    expect(b.cuori()).toEqual(new Set(['libro-2']));

    b.rispondi(new Error('il database ha detto no'));
    await inVolo;
    expect(b.cuori()).toEqual(new Set(['pane-1', 'libro-2']));
  });

  it("l'errore arriva a chi ha toccato, invece di sparire", async () => {
    const b = banco([]);
    const inVolo = b.tocca('pane-1');
    await b.partita;
    b.rispondi(new Error('il database ha detto no'));
    expect(await inVolo).toBeInstanceOf(Error);
  });
});

describe('③ si scrive quello che si vede, anche a due tocchi rapidi', () => {
  it('il primo tocco chiede di aggiungere', async () => {
    const b = banco([]);
    const inVolo = b.tocca('pane-1');
    await b.partita;
    expect(b.scritte).toEqual([{ id: 'pane-1', verso: 'aggiungi' }]);
    b.rispondi('accetta');
    await inVolo;
  });

  it('due tocchi di fila chiedono aggiungi e poi togli, non due volte aggiungi', async () => {
    const b = bancoRapido([]);
    const primo = b.tocca('pane-1');
    const secondo = b.tocca('pane-1');
    await Promise.all([primo, secondo]);

    expect(
      b.scritte.map((s) => s.verso),
      'due volte «aggiungi» sono due righe uguali: la seconda il database la rifiuta come doppione',
    ).toEqual(['aggiungi', 'togli']);
    expect(b.cuori(), 'due tocchi riportano il cuore al punto di partenza').toEqual(new Set<string>());
  });

  it('la regola in sé: cuore pieno a schermo vuol dire riga da aggiungere', () => {
    expect(versoDaScrivere(new Set(['pane-1']), 'pane-1')).toBe('aggiungi');
    expect(versoDaScrivere(new Set(['libro-2']), 'pane-1')).toBe('togli');
  });

  it("e il tocco ribalta solo il prodotto toccato, non l'elenco", () => {
    expect(insiemeDopoIlTocco(new Set(['libro-2']), 'pane-1')).toEqual(new Set(['libro-2', 'pane-1']));
    expect(insiemeDopoIlTocco(new Set(['libro-2', 'pane-1']), 'pane-1')).toEqual(new Set(['libro-2']));
    const prima = new Set(['libro-2']);
    insiemeDopoIlTocco(prima, 'pane-1');
    expect(prima, "l'elenco di partenza non si tocca: serve per rimettere le cose a posto").toEqual(
      new Set(['libro-2']),
    );
  });
});

describe('④ senza la lista in mano non si ribalta niente e non si scrive alla cieca', () => {
  it('«non lo so» non diventa un sì, e nessuna riga parte', async () => {
    const b = banco(undefined);
    const esito = await b.tocca('pane-1');

    expect(b.cuori(), 'una lista mai letta diventa una lista letta: il terzo stato sparisce').toBeUndefined();
    expect(b.scritte, 'si scrive nel database senza sapere cosa c’è già dentro').toEqual([]);
    expect((esito as Error).message).toBe(PREFERITI_NON_LETTI);
  });
});

/**
 * Il freno strutturale: le regole qui sopra valgono solo se l'aggancio vero le usa. Senza questo
 * pezzo avrei una regola scritta bene e nessuno obbligato a passarci.
 */
describe("l'aggancio dei preferiti passa da queste regole", () => {
  const hook = readFileSync('components/hooks/useFavorites.ts', 'utf8');
  const senzaCommenti = hook.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('useFavorites usa le regole del tocco invece di riscriverle', () => {
    expect(senzaCommenti).toContain('opzioniDelTocco(');
  });

  it('e nel percorso del tocco non c’è più la chiamata di rete «chi sei»', () => {
    expect(
      senzaCommenti,
      'la domanda al servizio di accesso torna in mezzo al tocco: è il primo dei tre giri di rete',
    ).not.toContain('auth.getUser(');
  });
});
