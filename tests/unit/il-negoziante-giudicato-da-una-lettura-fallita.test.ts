/**
 * La stessa malattia degli stati che mentivano, un piano SOTTO le pagine — e col metro sbagliato.
 *
 * Nel lotto precedente avevo scritto, nel corpo della richiesta di unione: «sulle pagine del
 * venditore nessuna lettura ingoia il proprio errore». Era falso, e la colpa era del metro:
 * l'invariante cercava la forma ESATTA `const { data } = await supabase`. Se il campo viene
 * rinominato — `const { data: orders } = …`, `const { count: n } = …` — quella espressione non lo
 * vede. Sei letture cieche stavano proprio nelle pagine che dichiaravo a posto.
 *
 * Rimisurato il 24/8 su `app/seller/` + `components/seller/`: **53 chiamate al database, 15
 * cieche**. Non erano pagine dimenticate: erano i COMPONENTI, che il perimetro vecchio
 * (`components/hooks/`) non guardava affatto. È il reperto che avevo lasciato aperto io stessa —
 * «il controllo sugli errori ingoiati guarda una cartella sola» — e qui si chiude allargando il
 * perimetro, non dichiarandolo.
 *
 * Le tre conseguenze, in ordine di quanto fanno male:
 *
 * · **La personalizzazione della vetrina cancellata.** `site/ThemePicker` fa lettura-modifica-
 *   scrittura: legge `store_customization`, ci cambia un colore, riscrive. Con l'errore ingoiato
 *   la lettura torna `undefined`, i valori di partenza prendono il posto di quelli veri, e la
 *   scrittura salva QUELLI. Copertina, sezioni e tema del negozio persi per cambiare un colore.
 *   Non è una schermata che mostra un numero sbagliato: è un dato del negoziante cancellato.
 *
 * · **Il verdetto falso sulla prima schermata.** La lista d'avvio calcola tutte e sei le spunte da
 *   un'unica lettura del profilo. Fallita quella, `p` resta `undefined`, ogni spunta diventa
 *   `false`, e la bacheca dice a un negozio finito che non ha fatto niente — compreso «Attiva
 *   pagamenti» a chi li ha già attivi. Il punteggio di salute fa lo stesso in numeri: esce **0**
 *   con l'etichetta peggiore, in rosso. E il conto dei prodotti: `(undefined ?? 0) >= 3` è falso,
 *   quindi «pubblica almeno 3 prodotti» resta acceso a chi ne ha quaranta.
 *
 * · **I bottoni dei soldi.** I due bottoni di Stripe decidono cosa mostrare dallo stato letto dal
 *   profilo. «Non ho letto» si traveste da «pagamenti non attivi»: uno invita a rifare
 *   l'iscrizione a chi l'ha già fatta, l'altro fa sparire la cassa a chi ce l'ha.
 *
 * Le prime due si curano allo stesso modo del lotto scorso — l'errore deve poter FALLIRE — più il
 * terzo esito dove il componente dà un verdetto: «non ho letto» non è «non hai fatto niente».
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Il metro, come funzione pura: è la parte che il lotto scorso aveva sbagliata.
// ─────────────────────────────────────────────────────────────────────────────

/** Toglie i commenti: questi file SPIEGANO la forma malata, e citarla non è commetterla. */
export const senzaCommenti = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

export type Chiamata = { frase: string; destinazione: string; riga: number; dopo: string };

/**
 * Ogni `await supabase…;` che tocca una tabella o una funzione del database.
 *
 * `dopo` non è «tutto il resto del file»: è la finestra fino all'INIZIO della chiamata successiva.
 * Il confine serve, e l'ha trovato una prova: con «tutto il resto», la parola `error` scritta nella
 * destrutturazione della lettura DOPO (`const { data: d2, error: e2 } = …`) copriva la lettura
 * PRIMA, che era cieca. Una lettura si copre col proprio errore, non con quello della vicina.
 */
export function chiamateAlDatabase(src: string): Chiamata[] {
  const t = senzaCommenti(src);
  const grezze = [...t.matchAll(/((?:const|let)\s+(?:\{[^}]*\}|\w+)\s*=\s*)?await\s+supabase[\s\S]*?;/g)]
    .filter((m) => /\.from\(|\.rpc\(/.test(m[0]));
  return grezze.map((m, i) => {
    const inizio = m.index ?? 0;
    const fine = inizio + m[0].length;
    const prossima = grezze[i + 1]?.index ?? t.length;
    return {
      frase: m[0],
      destinazione: (m[1] ?? '').trim(),
      riga: t.slice(0, inizio).split('\n').length,
      dopo: t.slice(fine, prossima),
    };
  });
}

/**
 * «Cieca» vuol dire: dopo questa chiamata, nessuno può sapere che è andata storta.
 *
 * Tre modi di NON esserlo:
 *  ① l'errore è legato con un nome E QUEL NOME SI LEGGE  → `const { data, error } = …; if (error)`
 *  ② la risposta finisce in una variabile e l'errore si legge dopo → `const r = …; if (r.error)`
 *  ③ la chiamata lancia da sola → `.throwOnError()`
 *
 * ⚠️ IL PUNTO ① È LA CORREZIONE CHE QUESTO FILE ESISTE PER PORTARE, E NON ERA IL PRIMO METRO CHE
 * HO SCRITTO. La prima versione si accontentava che l'errore fosse LEGATO. Provata rompendo i fix
 * apposta, è rimasta verde tutte e tre le volte: togliere `if (error) throw error` lascia in piedi
 * la destrutturazione, e per quel metro il file era a posto. **Legare l'errore e non guardarlo è
 * cieco esattamente quanto non legarlo** — anzi peggio, perché sembra a posto a chi rilegge.
 *
 * Il nome si cerca solo fino alla chiamata successiva: l'errore o lo si guarda subito, o quello che
 * si legge dopo è l'errore di un'altra lettura. Senza quel confine, in un file con due letture la
 * prima si copriva con la seconda.
 */
export function letturaCieca(c: Chiamata): boolean {
  if (/\.throwOnError\(\s*\)/.test(c.frase)) return false;
  const finestra = c.dopo;   // il confine lo mette chi estrae: vedi `chiamateAlDatabase`
  const dest = c.destinazione;
  const legato = dest.match(/\{[^}]*\berror\b\s*(?::\s*(\w+))?/);
  if (legato) {
    const nome = legato[1] ?? 'error';
    // Come IDENTIFICATORE, non come proprietà di qualcun altro. Senza il `(?<![.\w$])` la parola
    // dentro `toast.error(...)` bastava a dichiarare guardata una lettura che non lo era: la
    // mutazione su StripeConnectButton è rimasta verde proprio per questo.
    if (new RegExp(`(?<![.\\w$])${nome}\\b`).test(finestra)) return false;
  }
  const variabile = dest.match(/^(?:const|let)\s+(\w+)\s*=/)?.[1];
  if (variabile && new RegExp(`\\b${variabile}\\.error\\b`).test(finestra)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// ① Il metro sa riconoscere le forme che il metro vecchio si perdeva.
// ─────────────────────────────────────────────────────────────────────────────

const unaChiamata = (src: string) => chiamateAlDatabase(src)[0];

describe('il metro vede anche le forme rinominate', () => {
  const cieche: [string, string][] = [
    ['la forma nuda', "const { data } = await supabase.from('t').select('*');"],
    ['il campo rinominato', "const { data: orders } = await supabase.from('orders').select('*');"],
    ['il conteggio', "const { count: n } = await supabase.from('t').select('id', { head: true });"],
    ['due campi, nessuno è l\'errore', "const { data: a, count: b } = await supabase.from('t').select('*');"],
    ['la variabile che nessuno interroga', "const r = await supabase.from('t').select('*');\nreturn r.data;"],
    ['una funzione del database', "const { data } = await supabase.rpc('f', {});"],
  ];
  for (const [nome, src] of cieche) {
    it(`cieca: ${nome}`, () => {
      const c = unaChiamata(src);
      expect(c, 'la chiamata deve essere riconosciuta').toBeTruthy();
      expect(letturaCieca(c)).toBe(true);
    });
  }

  const vedenti: [string, string][] = [
    ['errore legato e letto', "const { data, error } = await supabase.from('t').select('*');\nif (error) throw error;"],
    ['errore legato, rinominato e letto', "const { data: o, error: e } = await supabase.from('t').select('*');\nif (e) throw e;"],
    ['solo l\'errore, e viene letto', "const { error } = await supabase.from('t').update({}).eq('id', 1);\nif (error) throw error;"],
    ['la variabile interrogata dopo', "const r = await supabase.from('t').select('*');\nif (r.error) throw r.error;"],
    ['lancia da sola', "const { data } = await supabase.from('t').select('*').throwOnError();"],
    ['l\'errore restituito a chi chiama', "const { data, error } = await supabase.from('t').select('*');\nreturn { data, error };"],
  ];
  for (const [nome, src] of vedenti) {
    it(`non cieca: ${nome}`, () => {
      const c = unaChiamata(src);
      expect(c, 'la chiamata deve essere riconosciuta').toBeTruthy();
      expect(letturaCieca(c)).toBe(false);
    });
  }

  it('legare l\'errore e non leggerlo è cieco quanto non legarlo', () => {
    // È la mutazione che ha bocciato il primo metro: togliere `if (error) throw error` lascia in
    // piedi la destrutturazione, e il metro vecchio diceva verde.
    const legatoEIgnorato = "const { data, error } = await supabase.from('t').select('*');\nreturn data;";
    expect(letturaCieca(unaChiamata(legatoEIgnorato))).toBe(true);
  });

  it('l\'errore di una lettura non si copre con quello della lettura dopo', () => {
    // Senza il confine alla chiamata successiva, la prima si sarebbe salvata leggendo il nome
    // `error` della seconda.
    const due = "const { data, error } = await supabase.from('a').select('*');\n" +
      "const { data: d2, error: e2 } = await supabase.from('b').select('*');\nif (e2) throw e2;";
    const c = chiamateAlDatabase(due);
    expect(c).toHaveLength(2);
    expect(letturaCieca(c[0]), 'la prima è cieca').toBe(true);
    expect(letturaCieca(c[1]), 'la seconda no').toBe(false);
  });

  it('«toast.error» non è guardare il proprio errore', () => {
    // Terza bocciatura del metro, e la più insidiosa: il bottone di Stripe aveva un `toast.error`
    // nel catch dieci righe sotto, e quella parola bastava a farlo passare per sano.
    const src = "const { data, error } = await supabase.from('t').select('*');\n" +
      "try { fare(); } catch (e) { toast.error(e); console.error(e); }\nreturn data;";
    expect(letturaCieca(unaChiamata(src))).toBe(true);
  });

  it('il metro VECCHIO si perdeva il campo rinominato — è il motivo di questo file', () => {
    const vecchio = /const\s*\{\s*data\s*\}\s*=\s*await\s+supabase/;
    const rinominata = "const { data: orders } = await supabase.from('orders').select('*');";
    expect(vecchio.test(rinominata), 'il metro vecchio la vedeva').toBe(false);
    expect(letturaCieca(unaChiamata(rinominata)), 'il metro nuovo la vede').toBe(true);
  });

  it('un commento che CITA la forma malata non è un\'accusa', () => {
    const src = "// prima qui c'era const { data } = await supabase.from('t').select('*');\nconst { data, error } = await supabase.from('t').select('*');\nif (error) throw error;";
    const c = chiamateAlDatabase(src);
    expect(c).toHaveLength(1);
    expect(letturaCieca(c[0])).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② L'invariante sul codice VERO, col perimetro allargato ai componenti.
// ─────────────────────────────────────────────────────────────────────────────

const RADICE = process.cwd();
const PERIMETRO = ['app/seller', 'components/seller', 'components/hooks'];

function sorgenti(dir: string): string[] {
  const fuori: string[] = [];
  const cammina = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) cammina(p);
      else if (/\.(tsx|ts)$/.test(n) && !/\.test\.tsx?$/.test(n)) fuori.push(p);
    }
  };
  cammina(dir);
  return fuori;
}

const file = PERIMETRO.flatMap((p) => sorgenti(join(RADICE, p)));

describe('l\'invariante di struttura sull\'area venditore', () => {
  const tutte = file.flatMap((f) =>
    chiamateAlDatabase(readFileSync(f, 'utf8')).map((c) => ({ ...c, file: relative(RADICE, f) })),
  );

  it('c\'è qualcosa da misurare: una lista vuota non è un verde', () => {
    // Il giorno che l'espressione smette di riconoscere le chiamate, questa riga diventa rossa
    // invece di lasciar passare un verde a mani vuote.
    expect(tutte.length).toBeGreaterThanOrEqual(40);
    expect(file.length).toBeGreaterThanOrEqual(30);
  });

  it('nessuna chiamata al database resta cieca al proprio errore', () => {
    const cieche = tutte.filter(letturaCieca).map((c) => `${c.file}:${c.riga}`);
    expect(cieche).toEqual([]);
  });

  it('il perimetro copre i COMPONENTI, non solo le pagine e gli hook', () => {
    // È il reperto che avevo lasciato aperto: «il controllo guarda una cartella sola». Le quindici
    // letture cieche del 24/8 stavano quasi tutte qui dentro, fuori dal perimetro vecchio.
    const daiComponenti = tutte.filter((c) => c.file.startsWith('components/seller/'));
    expect(daiComponenti.length).toBeGreaterThanOrEqual(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ Chi dà un VERDETTO sul negozio ha il terzo esito, non due.
// ─────────────────────────────────────────────────────────────────────────────

describe('«non ho letto» non si traveste da «non hai fatto niente»', () => {
  const verdetti: [string, string][] = [
    ['la lista d\'avvio', 'components/seller/SellerOnboardingChecklist.tsx'],
    ['il punteggio di salute', 'components/seller/SellerHealthScore.tsx'],
  ];
  for (const [nome, f] of verdetti) {
    it(`${nome} distingue la lettura fallita`, () => {
      const src = senzaCommenti(readFileSync(join(RADICE, f), 'utf8'));
      expect(src, 'deve chiedere alla lettura se è fallita').toMatch(/\bisError\b/);
      // e deve farci qualcosa: un ramo che esce prima di calcolare il verdetto.
      expect(src, 'deve avere un ramo per la lettura fallita').toMatch(/if\s*\(\s*isError/);
      expect(src, 'deve offrire di riprovare').toMatch(/\brefetch\b/);
    });
  }

  it('il ripiego non si prende più direttamente dalla lettura', () => {
    // `const { data: checks = [] } = useQuery(...)`: con la lettura fallita il ripiego prende il
    // posto del dato, e il verdetto si calcola su una lista vuota. È la forma esatta del difetto.
    for (const [, f] of verdetti) {
      const src = senzaCommenti(readFileSync(join(RADICE, f), 'utf8'));
      expect(src, `${f} si prende un ripiego dentro la lettura`).not.toMatch(
        /const\s*\{[^}]*data:\s*\w+\s*=\s*(\[\]|\{\})/,
      );
    }
  });
});
