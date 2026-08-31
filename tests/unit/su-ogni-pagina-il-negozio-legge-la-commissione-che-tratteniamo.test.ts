import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { TOPICS } from '@/app/seller/help/domande';
import { spiegazioneCommissione, testoIntero } from '@/app/seller/earnings/commissione';
import { computeApplicationFeeCents } from '@/lib/stripe/client';

/**
 * 31/8/2026 (R037) — LA STESSA BUGIA IN DUE POSTI, CHIUSA IN UNO SOLO.
 *
 * Il 30/8 abbiamo raddrizzato la risposta del Centro venditori («L'8% sul
 * venduto» → la percentuale vera) e abbiamo dichiarato chiuso il difetto. Ma la
 * frase sbagliata stava anche sulla pagina «Guadagni», cioe' esattamente dove il
 * negoziante va a guardare i suoi soldi, e li' e' rimasta viva un altro giorno:
 * «Su MyCity paghi solo l'8% del venduto», mentre la cassa ne tratteneva il 10.
 * La prova di allora leggeva una pagina sola, quindi era verde su meta' difetto.
 *
 * Percio' questa prova non guarda un file: guarda TUTTE le pagine dove parliamo
 * di commissione al negozio, e confronta quello che gli diciamo con quello che
 * gli togliamo davvero — `computeApplicationFeeCents`, la funzione che divide i
 * soldi di ogni ordine. Se domani la commissione cambia e una pagina resta
 * indietro, o se qualcuno ribatte a mano una percentuale, questo file diventa
 * rosso. Non puo' piu' restare vivo a meta'.
 */

const RADICE = process.cwd();

/** Su 100 € di venduto: quanto ne trattiene davvero la cassa, in percentuale. */
const VENDUTO_DI_PROVA_CENTS = 10_000;
const PERCENTUALE_TRATTENUTA_DAVVERO =
  (computeApplicationFeeCents(VENDUTO_DI_PROVA_CENTS) / VENDUTO_DI_PROVA_CENTS) * 100;

/**
 * Il testo come arriva agli occhi, non come sta nel sorgente: nella pagina la
 * frase era spezzata da un `<strong>` e l'apostrofo era scritto `&apos;`. Un
 * controllo che non sappia leggere quelle due forme darebbe per assente proprio
 * la versione del difetto che c'era davvero in produzione.
 */
function leggibile(sorgente: string): string {
  return sorgente
    .replace(/&apos;|&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]*>/g, '');
}

/** Le percentuali dette in una frase: «solo l'8% del venduto» → [8]. */
function percentualiCitate(testo: string): number[] {
  return [...leggibile(testo).matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((m) => Number(m[1].replace(',', '.')));
}

/**
 * I commenti restano fuori dal censimento: qui si guarda cosa legge il
 * negoziante, non cosa leggono i programmatori. (Il numero nei commenti resta
 * comunque agganciato alla costante nei file che contano.)
 */
function senzaCommenti(sorgente: string): string {
  return sorgente
    .replace(/\/\*[\s\S]*?\*\//g, '\n')
    .split('\n')
    .map((riga) => (riga.trimStart().startsWith('//') ? '' : riga))
    .join('\n');
}

/** Una riga parla di commissione al negozio? */
const PARLA_DI_COMMISSIONE = /commission|trattenia|tratteni|sul venduto|del venduto/i;

type PromessaScritta = { riga: number; testo: string; percentuale: number };

/**
 * Le percentuali di commissione battute a mano dentro un sorgente. È la stessa
 * funzione che usa il censimento e che usa il controllo di sensibilità qui
 * sotto: se un giorno smettesse di vedere il difetto, se ne accorgerebbe da sé.
 */
function promesseScritteAMano(sorgente: string): PromessaScritta[] {
  const righe = leggibile(senzaCommenti(sorgente)).split('\n');
  const trovate: PromessaScritta[] = [];
  righe.forEach((riga, i) => {
    if (!PARLA_DI_COMMISSIONE.test(riga)) return;
    for (const p of percentualiCitate(riga)) {
      trovate.push({ riga: i + 1, testo: riga.trim(), percentuale: p });
    }
  });
  return trovate;
}

/** Tutti i sorgenti che il negoziante puo' finire per leggere. */
function sorgentiVenditore(): { percorso: string; contenuto: string }[] {
  const trovati: { percorso: string; contenuto: string }[] = [];
  const scendi = (cartella: string) => {
    for (const voce of readdirSync(cartella, { withFileTypes: true })) {
      const pieno = join(cartella, voce.name);
      if (voce.isDirectory()) scendi(pieno);
      else if (/\.tsx?$/.test(voce.name)) {
        trovati.push({ percorso: relative(RADICE, pieno).split(sep).join('/'), contenuto: readFileSync(pieno, 'utf8') });
      }
    }
  };
  scendi(join(RADICE, 'app', 'seller'));
  scendi(join(RADICE, 'components', 'seller'));
  return trovati;
}

/** La frase della pagina «Guadagni» che parla di quanto tratteniamo. */
function fraseCommissioneGuadagni(): string | undefined {
  return spiegazioneCommissione().map(testoIntero).find((f) => PARLA_DI_COMMISSIONE.test(f));
}

/** La risposta del Centro venditori alla domanda sulla commissione. */
function rispostaCommissioneCentroVenditori(): string | undefined {
  return TOPICS.flatMap((t) => t.items).find((r) => /quanto tratteniamo/i.test(r.q))?.a;
}

describe('la pagina Guadagni: il negozio legge quello che gli togliamo', () => {
  it('la spiegazione della commissione c’è ancora, e dice una percentuale', () => {
    const frase = fraseCommissioneGuadagni();
    expect(
      frase,
      'sulla pagina dei suoi soldi il negoziante non trova più scritto quanto gli tratteniamo',
    ).toBeTruthy();
    expect(
      percentualiCitate(frase!).length,
      `la spiegazione «${frase}» non dice nessuna percentuale: il negoziante resta senza il numero`,
    ).toBeGreaterThan(0);
  });

  it('la percentuale promessa è quella che finisce davvero in cassa', () => {
    const frase = fraseCommissioneGuadagni()!;
    expect(
      percentualiCitate(frase),
      `su «Guadagni» promettiamo «${frase}», ma su 100 € di venduto ne tratteniamo ${PERCENTUALE_TRATTENUTA_DAVVERO}%`,
    ).toEqual([PERCENTUALE_TRATTENUTA_DAVVERO]);
  });
});

describe('il Centro venditori: la stessa promessa, lo stesso numero', () => {
  it('la risposta «Quanto tratteniamo?» cita la percentuale che finisce davvero in cassa', () => {
    const risposta = rispostaCommissioneCentroVenditori();
    expect(risposta, 'la domanda sulla commissione è sparita dal Centro venditori').toBeTruthy();
    expect(
      percentualiCitate(risposta!),
      `nel Centro venditori scriviamo «${risposta}», ma ne tratteniamo ${PERCENTUALE_TRATTENUTA_DAVVERO}%`,
    ).toEqual([PERCENTUALE_TRATTENUTA_DAVVERO]);
  });

  it('le due pagine non possono dire due numeri diversi', () => {
    expect(
      percentualiCitate(fraseCommissioneGuadagni()!),
      'la pagina Guadagni e il Centro venditori promettono al negozio due commissioni diverse',
    ).toEqual(percentualiCitate(rispostaCommissioneCentroVenditori()!));
  });
});

describe('nessuna pagina del venditore ribatte a mano la commissione', () => {
  const sorgenti = sorgentiVenditore();

  it('il censimento guarda davvero le pagine dove il difetto viveva', () => {
    const visti = sorgenti.map((s) => s.percorso);
    for (const atteso of [
      'app/seller/earnings/page.tsx',
      'app/seller/earnings/commissione.ts',
      'app/seller/help/page.tsx',
      'app/seller/help/domande.ts',
    ]) {
      expect(visti, `il censimento non ha aperto ${atteso}: sarebbe verde senza aver guardato niente`).toContain(atteso);
    }
    expect(
      sorgenti.filter((s) => s.contenuto.trim() === '').map((s) => s.percorso),
      'il censimento ha aperto file vuoti: non sta leggendo quello che crede',
    ).toEqual([]);
  });

  it('ogni percentuale di commissione scritta a mano è quella vera', () => {
    const sbagliate = sorgenti.flatMap((s) =>
      promesseScritteAMano(s.contenuto)
        .filter((p) => p.percentuale !== PERCENTUALE_TRATTENUTA_DAVVERO)
        .map((p) => `${s.percorso}:${p.riga} promette ${p.percentuale}% → «${p.testo}»`),
    );
    expect(
      sbagliate,
      `al negozio tratteniamo ${PERCENTUALE_TRATTENUTA_DAVVERO}% su ogni vendita, ma qui gliene promettiamo un altro`,
    ).toEqual([]);
  });
});

describe('il controllo sa riconoscere il difetto che c’era davvero', () => {
  // 31/8/2026 (R037) — Senza questi due casi il censimento potrebbe essere
  // diventato cieco (basta un `<strong>` in mezzo o un `&apos;`) e nessuno se ne
  // accorgerebbe: sarebbe verde perché non vede, non perché è a posto.
  it('vede la frase esatta che stava sulla pagina Guadagni fino al 31/8/2026', () => {
    const comeStavaInProduzione =
      "            Su MyCity paghi <strong>solo l&apos;8% del venduto</strong> realmente concluso (non rimborsi, non ordini annullati).";
    expect(promesseScritteAMano(comeStavaInProduzione).map((p) => p.percentuale)).toEqual([8]);
  });

  it('vede la frase esatta che stava nel Centro venditori fino al 30/8/2026', () => {
    const comeStavaInProduzione =
      "        a: 'L\\'8% sul venduto effettivamente concluso. Nessun costo mensile o di iscrizione.' },";
    expect(promesseScritteAMano(comeStavaInProduzione).map((p) => p.percentuale)).toEqual([8]);
  });

  it('non si mette a gridare per una percentuale che non parla di commissione', () => {
    expect(promesseScritteAMano("desc=\"I negozi con +10 articoli vendono il 70% in più.\"")).toEqual([]);
  });
});
