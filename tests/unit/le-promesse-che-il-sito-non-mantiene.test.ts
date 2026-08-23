import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FRASE_RESO,
  METODI_AL_CHECKOUT,
  NEGOZIO_CHIUSO_COSA_SUCCEDE,
  RIQUADRO_LO_SAPEVI,
  frasePagamento,
  promesseRitiroInNegozio,
  riquadroRitiroInNegozio,
  rispostaCostoSpedizione,
  rispostaTempiDiConsegna,
} from '@/lib/promesse-pubbliche';
import {
  MARKETPLACE_FEE_BPS,
  PICKUP_DISCOUNT_PERCENT,
  PLATFORM_DELIVERY_FEE_CENTS,
  RITIRO_IN_NEGOZIO_ATTIVO,
  VALUE_PROPS,
} from '@/lib/constants';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';

/**
 * IL SITO PROMETTEVA TRE COSE CHE NON FA.
 *
 *   ① «Ritiro in negozio, e ottieni il 10% di sconto: selezionalo al checkout» (FAQ, pagina
 *      Spedizioni ×2). Al checkout quel blocco sta dentro `RITIRO_IN_NEGOZIO_ATTIVO`, che vale
 *      `false`, e le due rotte che creano l'ordine forzano `pickupInStore = false`. L'opzione non
 *      esiste — e la FAQ dava perfino l'istruzione per selezionarla. Lo sconto poi vale zero
 *      (`PICKUP_DISCOUNT_PERCENT = 0`): il 10% non era vero nemmeno se il ritiro fosse acceso.
 *   ② «Se il negozio è chiuso, l'ordine parte alla riapertura e te lo diciamo prima che tu paghi».
 *      Le due rotte fanno l'opposto: rifiutano con un conflitto. Nessun ordine va in coda.
 *   ③ «30-60 minuti» scritto a mano, mentre `EXPRESS_ETA_LABEL` esiste dal giorno in cui qualcuno
 *      ha deciso quel numero.
 *
 * ── Cosa prova questo file ───────────────────────────────────────────────────────────────────
 * Che le promesse NASCANO dagli interruttori: si esegue la funzione con l'interruttore nei due
 * versi e si guarda cosa esce. Non è «il testo contiene la parola giusta»: è che spegnere la
 * funzione spegne la promessa, da sé, senza che nessuno si ricordi di riscrivere una pagina.
 */

describe('il ritiro in negozio: la promessa segue l’interruttore', () => {
  it('spento: nessuna promessa, nessun riquadro', () => {
    expect(promesseRitiroInNegozio(false)).toEqual([]);
    expect(riquadroRitiroInNegozio(false)).toBeNull();
  });

  it('acceso: la promessa ricompare da sé', () => {
    const p = promesseRitiroInNegozio(true, 10);
    expect(p).toHaveLength(1);
    expect(p[0].a).toContain('10%');
    expect(riquadroRitiroInNegozio(true, 10)?.sottotitolo).toContain('10%');
  });

  it('acceso ma senza sconto: non si nomina una percentuale che vale zero', () => {
    const p = promesseRitiroInNegozio(true, 0);
    expect(p[0].a).not.toMatch(/\d+%/);
    expect(riquadroRitiroInNegozio(true, 0)?.sottotitolo).not.toMatch(/\d+%/);
  });

  it("com'è configurato ADESSO il sito non promette il ritiro", () => {
    // Questo è il caso vero, oggi. Se un giorno l'interruttore si accende, questa riga cade e va
    // riletta: è il momento in cui la promessa torna legittima.
    expect(RITIRO_IN_NEGOZIO_ATTIVO).toBe(false);
    expect(promesseRitiroInNegozio()).toEqual([]);
    expect(riquadroRitiroInNegozio()).toBeNull();
    expect(PICKUP_DISCOUNT_PERCENT).toBe(0);
  });
});

describe('il negozio chiuso: si dice quello che fanno le rotte', () => {
  it('la promessa non parla piu’ di code né di avvisi prima del pagamento', () => {
    expect(NEGOZIO_CHIUSO_COSA_SUCCEDE).not.toMatch(/parte alla riapertura/i);
    expect(NEGOZIO_CHIUSO_COSA_SUCCEDE).toMatch(/non puoi ordinare|non parte/i);
  });

  it('e dice la stessa cosa che dicono le due rotte quando rifiutano', () => {
    const radice = process.cwd();
    for (const rotta of ['app/api/orders/cod/route.ts', 'app/api/stripe/checkout/route.ts']) {
      const src = readFileSync(join(radice, rotta), 'utf8');
      expect(src, `${rotta} non rifiuta piu' sul negozio chiuso: la promessa va riletta`).toMatch(
        /isStoreClosedForOrder/,
      );
      expect(src, `${rotta} deve rispondere con un conflitto, non mettere in coda`).toMatch(
        /conflict\(/,
      );
    }
  });
});

describe('i tempi e la soglia: un numero, una casa', () => {
  it('la risposta sui tempi usa il numero deciso in lib/delivery', () => {
    expect(rispostaTempiDiConsegna().a).toContain(EXPRESS_ETA_LABEL);
  });

  it('e ci mette dentro cosa succede col negozio chiuso, invece di prometterne un’altra', () => {
    expect(rispostaTempiDiConsegna().a).toContain(NEGOZIO_CHIUSO_COSA_SUCCEDE);
  });

  it('la risposta sulla spedizione dice che la soglia vale per negozio, non sul totale', () => {
    // È l'altra metà del difetto del carrello: «Gratis» calcolato sul totale globale mentre il
    // numero si calcola per negozio. Chi legge la FAQ deve sapere quale delle due è la regola.
    expect(rispostaCostoSpedizione().a).toMatch(/ciascun negozio|dallo stesso venditore/);
    expect(rispostaCostoSpedizione().a).toMatch(/non sul totale/i);
  });
});

describe('le pagine pubbliche non riscrivono piu’ le promesse a mano', () => {
  const radice = process.cwd();
  const pagine = ['app/faq/page.tsx', 'app/shipping/page.tsx'];

  for (const pagina of pagine) {
    it(`${pagina} chiama le promesse invece di scriverle`, () => {
      const src = readFileSync(join(radice, pagina), 'utf8');
      expect(src).toContain('@/lib/promesse-pubbliche');
    });

    it(`${pagina} non contiene piu’ le tre frasi false`, () => {
      const src = readFileSync(join(radice, pagina), 'utf8');
      const corpo = src
        .split('\n')
        .filter((r) => !r.trimStart().startsWith('//'))
        .join('\n');
      expect(corpo, 'la promessa della coda alla riapertura').not.toMatch(/ordine parte alla riapertura/i);
      expect(corpo, 'lo sconto del 10% sul ritiro').not.toMatch(/10% di sconto/);
      expect(corpo, 'i minuti scritti a mano').not.toMatch(/30-60 min/);
    });
  }
});

describe('il pagamento: la frase nasce dai metodi che il checkout offre davvero', () => {
  it('col carrello di oggi: contanti alla consegna, oppure carta ADESSO', () => {
    const f = frasePagamento();
    expect(f, "«carta alla consegna» non esiste: al checkout la carta si paga subito, su Stripe").not.toMatch(
      /carta o contanti alla consegna/i,
    );
    expect(f).toMatch(/contanti alla consegna/i);
    expect(f).toMatch(/carta adesso/i);
  });

  it('se domani sparisse il contante, la frase cambia da sé', () => {
    expect(frasePagamento(['carta-adesso'])).toBe('Paghi con carta adesso');
  });

  it('se domani sparisse la carta, idem', () => {
    expect(frasePagamento(['contanti-alla-consegna'])).toBe('Paghi in contanti alla consegna');
  });

  it('senza metodi non si inventa niente', () => {
    expect(frasePagamento([])).not.toMatch(/paghi/i);
  });

  it('e i metodi elencati sono quelli che il checkout disegna', () => {
    const src = readFileSync(join(process.cwd(), 'components/checkout/PaymentMethodSelector.tsx'), 'utf8');
    expect(src, 'la carta anticipata su Stripe').toMatch(/Carta di credito \/ debito/);
    expect(src, 'i contanti al rider').toMatch(/Contanti alla consegna/);
    expect(METODI_AL_CHECKOUT).toHaveLength(2);
  });
});

describe('il reso: la scheda prodotto smette di prometterlo gratuito', () => {
  it('la frase non dice piu’ «gratuito»', () => {
    expect(FRASE_RESO).not.toMatch(/gratuit/i);
    expect(FRASE_RESO).toMatch(/14 giorni/);
  });

  it('e la pagina resi continua a dire che il ripensamento lo paga il cliente', () => {
    // Se un giorno la politica cambia, questa riga cade: è il momento in cui «gratuito» tornerebbe
    // legittimo, e va deciso da chi scrive la politica, non dedotto da qui.
    const src = readFileSync(join(process.cwd(), 'app/returns/page.tsx'), 'utf8');
    expect(src).toMatch(/a tuo carico/i);
  });

  it('la scheda prodotto usa la frase, non una sua copia', () => {
    const src = readFileSync(join(process.cwd(), 'app/product/[id]/page.tsx'), 'utf8');
    expect(src).toContain('FRASE_RESO');
    const corpo = src.split('\n').filter((r) => !r.trimStart().startsWith('//') && !r.trimStart().startsWith('{/*') && !r.trimStart().startsWith('*')).join('\n');
    expect(corpo).not.toMatch(/Reso gratuito/);
  });
});

describe('il riquadro «Lo sapevi?»: la frase regge i numeri che le stanno sopra', () => {
  it('non dice piu’ che non ci sono intermediari né commissioni', () => {
    expect(RIQUADRO_LO_SAPEVI).not.toMatch(/niente intermediari/i);
    expect(RIQUADRO_LO_SAPEVI).not.toMatch(/commissioni nascoste/i);
  });

  it('e la commissione esiste davvero, quindi la frase vecchia era falsa', () => {
    // Non è un dettaglio di parole: MyCity trattiene una percentuale, e la parte venditori la
    // scrive per esteso. Se un giorno andasse a zero, questa riga cade e la frase si può rivedere.
    expect(MARKETPLACE_FEE_BPS).toBeGreaterThan(0);
    expect(PLATFORM_DELIVERY_FEE_CENTS).toBeGreaterThan(0);
  });

  it('il carrello usa la frase, non una sua copia', () => {
    const src = readFileSync(join(process.cwd(), 'app/cart/page.tsx'), 'utf8');
    expect(src).toContain('RIQUADRO_LO_SAPEVI');
    expect(src).not.toMatch(/Niente intermediari/);
  });
});

describe('le quattro promesse della home dicono la regola vera', () => {
  it('la spedizione gratuita dichiara che la soglia è per negozio', () => {
    const spedizione = VALUE_PROPS.find((v) => v.title === 'Spedizione gratuita');
    expect(spedizione?.subtitle).toMatch(/per negozio/);
  });

  it('e i minuti vengono da dove sono decisi, non riscritti a mano', () => {
    const consegna = VALUE_PROPS.find((v) => v.title === 'Consegna rapida');
    expect(consegna?.subtitle).toContain(EXPRESS_ETA_LABEL);
  });
});

/**
 * ── LA SPAZZATA, e perché è arrivata dopo ────────────────────────────────────────────────────
 *
 * Curati i due punti che le schede nominavano (scheda prodotto e carrello), il secondo giro ha
 * chiesto «e altrove?». Le stesse due frasi false erano in altri QUATTRO posti che nessuna scheda
 * aveva trovato: il sottotitolo della home, la pagina «come funziona», la colonna delle schermate
 * di accesso e il giro guidato del primo acquisto. Cioè: le schede coprivano un terzo del difetto.
 *
 * È la firma della malattia — una frase copiata a mano in N posti — e la prova sotto è il freno che
 * conta i posti, invece di fidarsi dell'elenco che qualcuno ha compilato.
 */
describe('nessuna pagina riscrive più a mano le due frasi false', () => {
  const RADICE = process.cwd();
  const GUARDATE = ['app', 'components', 'lib'];
  const ESTENSIONI = ['.ts', '.tsx'];

  function tuttiIFile(dir: string, out: string[] = []): string[] {
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    for (const nome of readdirSync(dir)) {
      if (nome === 'node_modules' || nome.startsWith('.')) continue;
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) tuttiIFile(p, out);
      else if (ESTENSIONI.some((e) => nome.endsWith(e))) out.push(p);
    }
    return out;
  }

  /** Le righe di codice, senza i commenti: quelli il cliente non li legge, e la storia va raccontata. */
  function righeVive(percorso: string): string[] {
    return readFileSync(percorso, 'utf8')
      .split('\n')
      .filter((r) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(r));
  }

  const file = GUARDATE.flatMap((c) => tuttiIFile(join(RADICE, c)));

  it('trova davvero dei file (se no non sta misurando niente)', () => {
    expect(file.length).toBeGreaterThan(200);
  });

  it('«carta … alla consegna» non compare più: al checkout la carta si paga subito', () => {
    const colpevoli: string[] = [];
    for (const f of file) {
      righeVive(f).forEach((riga, i) => {
        if (/carta o contanti/i.test(riga)) colpevoli.push(`${f.slice(RADICE.length + 1)}:${i + 1}`);
      });
    }
    expect(colpevoli, 'la frase promette una carta alla consegna che non esiste').toEqual([]);
  });

  it('«reso gratuito» non compare più come promessa generale', () => {
    const colpevoli: string[] = [];
    for (const f of file) {
      if (f.endsWith(`app${require('node:path').sep}returns${require('node:path').sep}page.tsx`)) continue; // lì è vero: solo per l'errore del venditore
      righeVive(f).forEach((riga, i) => {
        if (/reso gratuito/i.test(riga)) colpevoli.push(`${f.slice(RADICE.length + 1)}:${i + 1}`);
      });
    }
    expect(
      colpevoli,
      'la pagina resi dice che il cambio idea lo paga il cliente, e i freschi sono esclusi',
    ).toEqual([]);
  });
});
