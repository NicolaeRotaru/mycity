import { describe, it, expect, vi, afterAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { TOPICS } from '@/app/seller/help/domande';
import {
  COMMISSIONE_DEL_PERCENTO,
  spiegazioneCommissione,
  testoIntero,
} from '@/app/seller/earnings/commissione';
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
 *
 * 31/8/2026, secondo giro — IL CENSIMENTO DA SOLO NON BASTA, E LO DICIAMO QUI.
 *
 * Un censimento che cerca parole si aggira riscrivendo la frase: basta dire
 * «solo l'8% di quello che vendi davvero» e nessuna delle parole cercate
 * compare piu'. Non e' un difetto che si chiude aggiungendo parole alla lista:
 * la lista sara' sempre piu' corta dell'italiano. La difesa vera e' un'altra ed
 * e' qui sotto, nel gruppo «la percentuale non si puo' piu' scrivere a mano»: le
 * quattro promesse al negozio non contengono piu' il numero, lo prendono da
 * `MARKETPLACE_FEE_BPS` — cioe' dalla stessa riga che poi divide i soldi veri.
 * Chi vuole cambiare la commissione ha un posto solo dove metterci le mani, e le
 * quattro pagine lo seguono da sole. Il censimento resta come rete: prende chi
 * il numero se lo ribatte lo stesso, non chi riscrive la frase da capo.
 */

const RADICE = process.cwd();

/** Su 100 € di venduto: quanto ne trattiene davvero la cassa, in percentuale. */
const VENDUTO_DI_PROVA_CENTS = 10_000;
const PERCENTUALE_TRATTENUTA_DAVVERO =
  (computeApplicationFeeCents(VENDUTO_DI_PROVA_CENTS) / VENDUTO_DI_PROVA_CENTS) * 100;

/**
 * Le trasformazioni qui sotto rimpiazzano con SPAZI invece che togliere, cosi'
 * ogni «a capo» resta dov'era: il numero di riga che finisce nel messaggio di
 * errore e' quello vero del file, e chi legge il rosso apre il punto giusto
 * invece di cercarlo a occhio.
 */
const soloSpazi = (pezzo: string): string => pezzo.replace(/[^\n]/g, ' ');

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
    .replace(/<[^>]*>/g, soloSpazi);
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
    .replace(/\/\*[\s\S]*?\*\//g, soloSpazi)
    .split('\n')
    .map((riga) => (riga.trimStart().startsWith('//') ? soloSpazi(riga) : riga))
    .join('\n');
}

/** Le parole con cui, sul sito, si parla di quanto tratteniamo al negozio. */
const PARLA_DI_COMMISSIONE = /commission|trattenia|tratteni|sul venduto|del venduto|sulle vendite|che vendi/i;

/**
 * Quanto testo guardare intorno a una percentuale per capire se parla di
 * commissione. Si conta in caratteri e NON in righe: in JSX la stessa frase
 * viene spezzata a meta' da un `</strong>` e da un «a capo», e il censimento
 * vecchio — che leggeva una riga per volta — su quella spezzatura diventava
 * cieco senza accorgersene.
 */
const CARATTERI_PRIMA = 90;
const CARATTERI_DOPO = 60;

type PromessaScritta = { riga: number; testo: string; percentuale: number };

/**
 * Le percentuali di commissione battute a mano dentro un sorgente. È la stessa
 * funzione che usa il censimento e che usa il controllo di sensibilità qui
 * sotto: se un giorno smettesse di vedere il difetto, se ne accorgerebbe da sé.
 */
function promesseScritteAMano(sorgente: string): PromessaScritta[] {
  const testo = leggibile(senzaCommenti(sorgente));
  const trovate: PromessaScritta[] = [];
  for (const trovato of testo.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)) {
    const dove = trovato.index ?? 0;
    const finestra = testo.slice(Math.max(0, dove - CARATTERI_PRIMA), dove + CARATTERI_DOPO);
    if (!PARLA_DI_COMMISSIONE.test(finestra)) continue;
    trovate.push({
      riga: testo.slice(0, dove).split('\n').length,
      testo: finestra.replace(/\s+/g, ' ').trim(),
      percentuale: Number(trovato[1].replace(',', '.')),
    });
  }
  return trovate;
}

/**
 * Tutti i sorgenti del sito, non solo l'area venditore: due delle quattro
 * promesse stavano su /sell — la pagina dove il negozio FIRMA — che di
 * `app/seller` non fa parte. Un censimento che guarda solo dove il difetto e'
 * gia' stato trovato non trova mai il prossimo.
 */
function sorgentiDelSito(): { percorso: string; contenuto: string }[] {
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
  scendi(join(RADICE, 'app'));
  scendi(join(RADICE, 'components'));
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

/**
 * 31/8/2026 (R037) — LA DIFESA VERA.
 *
 * Le quattro frasi qui elencate sono quelle che il negozio legge PRIMA di
 * firmare (/sell) e mentre lavora (area venditore). Fino a oggi ognuna si
 * portava dentro il suo «10%» battuto a mano: quattro copie che il giorno del
 * cambio restano indietro una per una — ed e' esattamente cosi' che e' nato
 * questo difetto. Da oggi il numero non sta piu' in nessuna delle quattro: lo
 * prendono da `COMMISSIONE_DEL_PERCENTO`, che nasce da `MARKETPLACE_FEE_BPS`.
 */
const NOME_DEL_VALORE_AGGANCIATO = 'COMMISSIONE_DEL_PERCENTO';
const CASA_DEL_VALORE_AGGANCIATO = '@/app/seller/earnings/commissione';

/** Dove il negozio legge la commissione, e quante volte gliela diciamo. */
const PAGINE_CON_LA_PROMESSA: Record<string, number> = {
  'components/SellerApplicationForm.tsx': 2,
  'app/seller/layout.tsx': 1,
  'components/seller/SubscriptionBanner.tsx': 1,
};

/** Quante volte il file USA il valore agganciato (la riga di import non conta). */
function usiDelValoreAgganciato(sorgente: string): number {
  const senzaImport = sorgente.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?/g, '');
  return [...senzaImport.matchAll(new RegExp(NOME_DEL_VALORE_AGGANCIATO, 'g'))].length;
}

describe('la percentuale non si può più scrivere a mano', () => {
  const sorgenti = sorgentiDelSito();
  const perPercorso = new Map(sorgenti.map((s) => [s.percorso, s.contenuto]));

  it('il valore agganciato dice la percentuale che finisce davvero in cassa', () => {
    expect(
      percentualiCitate(COMMISSIONE_DEL_PERCENTO),
      `alle pagine passiamo «${COMMISSIONE_DEL_PERCENTO}», ma su 100 € di venduto ne tratteniamo ${PERCENTUALE_TRATTENUTA_DAVVERO}%`,
    ).toEqual([PERCENTUALE_TRATTENUTA_DAVVERO]);
  });

  it.each(Object.entries(PAGINE_CON_LA_PROMESSA))(
    '%s prende la commissione dalla costante, non dalle dita di chi scrive',
    (percorso, quantePromesse) => {
      const contenuto = perPercorso.get(percorso);
      expect(contenuto, `${percorso} non c’è più: la promessa al negozio è sparita senza che nessuno lo dicesse`).toBeTruthy();
      expect(
        contenuto!.includes(CASA_DEL_VALORE_AGGANCIATO),
        `${percorso} non prende più la commissione da ${CASA_DEL_VALORE_AGGANCIATO}: il giorno che cambiamo la percentuale questa pagina resta indietro e promette al negozio un numero che in cassa non esiste`,
      ).toBe(true);
      expect(
        usiDelValoreAgganciato(contenuto!),
        `${percorso} dice al negozio la commissione ${quantePromesse} volta/e, ma usa il valore agganciato meno volte: qualche promessa è tornata a essere scritta a mano`,
      ).toBeGreaterThanOrEqual(quantePromesse);
    },
  );

  it('nessuna pagina del sito ribatte a mano la percentuale della commissione', () => {
    const aMano = sorgenti.flatMap((s) =>
      promesseScritteAMano(s.contenuto).map((p) => `${s.percorso}:${p.riga} → «${p.testo}»`),
    );
    expect(
      aMano,
      `qui la commissione è scritta a mano invece di venire da ${NOME_DEL_VALORE_AGGANCIATO}: oggi il numero è giusto, ma il giorno che cambiamo la percentuale queste righe restano indietro e promettono al negozio una cosa che in cassa non succede`,
    ).toEqual([]);
  });
});

describe('nessuna pagina del venditore ribatte a mano la commissione', () => {
  const sorgenti = sorgentiDelSito();

  it('il censimento guarda davvero le pagine dove il difetto viveva', () => {
    const visti = sorgenti.map((s) => s.percorso);
    for (const atteso of [
      'app/seller/earnings/page.tsx',
      'app/seller/earnings/commissione.ts',
      'app/seller/help/page.tsx',
      'app/seller/help/domande.ts',
      'app/seller/layout.tsx',
      'components/SellerApplicationForm.tsx',
      'components/seller/SubscriptionBanner.tsx',
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
  // 31/8/2026 (R037) — Senza questi casi il censimento potrebbe essere
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

  // 31/8/2026 (R037) — I tre modi in cui il collaudo ha battuto il censimento
  // vecchio. Il primo e il terzo qui sotto adesso li vede; il secondo lo vede
  // solo perché abbiamo aggiunto quelle parole alla lista, e domani basterà
  // scriverne altre per aggirarlo di nuovo: è il motivo per cui il censimento
  // non è la difesa, ma la rete sotto la difesa.
  it('vede la frase anche quando va a capo dopo il grassetto, come si scrive in JSX', () => {
    const comeSiScriveDavvero = [
      '        <p className="text-primary-100 text-sm leading-relaxed">',
      '          Vetrina dedicata, prodotti illimitati.',
      '          <strong className="text-white"> Abbonamento €50/mese</strong>',
      '          e commissione del',
      '          8% sulle vendite, attivi solo dopo approvazione.',
      '        </p>',
    ].join('\n');
    expect(
      promesseScritteAMano(comeSiScriveDavvero).map((p) => p.percentuale),
      'la promessa spezzata su tre righe passa inosservata: in JSX è così che si scrive sempre',
    ).toEqual([8]);
  });

  it('vede la promessa anche detta con parole normali, senza la parola «commissione»', () => {
    const riscrittaAMano = "          Su MyCity paghi solo l&apos;8% di quello che vendi davvero.";
    expect(
      promesseScritteAMano(riscrittaAMano).map((p) => p.percentuale),
      'basta cambiare le parole della frase e la percentuale sbagliata torna invisibile',
    ).toEqual([8]);
  });

  it('guarda anche fuori dall’area venditore, dove stavano due promesse su quattro', () => {
    const visti = sorgentiDelSito().map((s) => s.percorso);
    expect(
      visti.some((p) => p.startsWith('app/sell/')),
      'il censimento non apre /sell, la pagina dove il negozio legge le condizioni prima di candidarsi',
    ).toBe(true);
    expect(
      visti.some((p) => p === 'components/SellerApplicationForm.tsx'),
      'il censimento non apre il modulo di candidatura: due promesse su quattro vivevano lì',
    ).toBe(true);
  });
});

/**
 * 31/8/2026 (R037) — LA PROVA CHE L'AGGANCIO È VERO.
 *
 * Qui si cambia la commissione dove si cambia davvero — `MARKETPLACE_FEE_BPS`,
 * la riga che poi divide i soldi di ogni ordine — e si guarda se la frase che
 * passiamo alle quattro pagine cambia da sola. Se qualcuno un giorno rimettesse
 * il numero a mano dentro `commissione.ts`, questo gruppo diventa rosso: la
 * frase resterebbe ferma a «del 10%» mentre in cassa ne trattengono 8.
 */
describe('cambiando la commissione in un posto solo, le pagine la seguono', () => {
  afterAll(() => {
    vi.doUnmock('@/lib/constants');
    vi.resetModules();
  });

  async function fraseConCommissioneA(puntiBase: number): Promise<string> {
    vi.resetModules();
    vi.doMock('@/lib/constants', async (originale) => ({
      ...(await originale<typeof import('@/lib/constants')>()),
      MARKETPLACE_FEE_BPS: puntiBase,
    }));
    const modulo = await import('@/app/seller/earnings/commissione');
    return modulo.COMMISSIONE_DEL_PERCENTO;
  }

  it('portandola all’8% le pagine dicono 8, non più 10', async () => {
    expect(
      percentualiCitate(await fraseConCommissioneA(800)),
      'abbiamo abbassato la commissione all’8% e le pagine continuano a promettere il numero vecchio',
    ).toEqual([8]);
  });

  it('portandola al 15% le pagine dicono 15', async () => {
    expect(
      percentualiCitate(await fraseConCommissioneA(1500)),
      'abbiamo alzato la commissione al 15% e le pagine continuano a promettere il numero vecchio',
    ).toEqual([15]);
  });

  it('l’articolo segue come si legge il numero: «dell’8%», non «del 8%»', async () => {
    expect(
      await fraseConCommissioneA(800),
      'al negozio scriviamo «commissione del 8% sulle vendite»: proprio sui soldi, una frase scritta male si legge come una promessa poco seria',
    ).toBe("dell'8%");
    expect(await fraseConCommissioneA(1000)).toBe('del 10%');
  });
});
