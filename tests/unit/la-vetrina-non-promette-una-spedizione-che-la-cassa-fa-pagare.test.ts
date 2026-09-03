/**
 * 3/9/2026 — «SPEDIZIONE GRATUITA» IN VETRINA, TRE EURO IN CASSA.
 *
 * La scheda prodotto mostrava il distintivo «Spedizione gratuita» sopra i 30 €, la barra scriveva
 * «Hai la spedizione gratis», le quattro promesse del sito dicevano «Spedizione gratuita · sopra
 * €30 per negozio». In cassa, su ogni ordine portato a casa, partivano comunque 3 € di «Consegna
 * MyCity» — uno per negozio, anche sopra la soglia.
 *
 * Per chi compra, «spedizione» e «consegna» sono la stessa cosa. Sulla scheda prodotto — l'ultimo
 * schermo prima di aggiungere al carrello — quei 3 € non comparivano da nessuna parte: il primo
 * posto dove si vedevano era il carrello, cioè dopo la scelta. E il riepilogo della cassa scriveva
 * «Niente costi nascosti» sopra un costo mai annunciato prima.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────
 * Non che da qualche parte ci sia scritta la parola giusta. Prova due cose che si rompono da sole:
 *
 *   ① la frase della vetrina NASCE dalla cifra: si esegue `promessaSpedizione()` con la consegna
 *      accesa e spenta, e si guarda cosa esce. A consegna spenta il claim pulito torna da sé; a
 *      consegna accesa nessuna frase può dire «gratis» senza dire anche quanto si paga;
 *   ② la cifra è QUELLA CHE LA CASSA ADDEBITA DAVVERO: il numero non è riscritto qui, si fa girare
 *      `prezziDelCarrello` — il conto vero del checkout — su un carrello da 35 € consegnato a
 *      casa, e si pretende che la vetrina dica il suo `deliveryFeeCents`.
 *
 * Se domani qualcuno alza la fee di consegna e non tocca nient'altro, ② diventa rosso.
 * Se qualcuno riscrive «Spedizione gratis» a mano in una pagina, ③ diventa rosso.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { promessaSpedizione, rispostaCostoSpedizione } from '@/lib/promesse-pubbliche';
import { prezziDelCarrello } from '@/lib/ordini/prezzi';
import { FREE_SHIPPING_THRESHOLD, PLATFORM_DELIVERY_FEE_CENTS, VALUE_PROPS } from '@/lib/constants';

const RADICE = process.cwd();
const leggi = (f: string) => readFileSync(join(RADICE, f), 'utf8');

/** Le righe di codice senza i commenti: quelli il cliente non li legge. */
function righeVive(sorgente: string): string[] {
  return sorgente.split('\n').filter((r) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(r));
}

/**
 * Dice «gratis/gratuita» a proposito della spedizione, in una frase che legge un cliente.
 * Lo spazio obbligatorio tiene fuori i nomi di campo (`couponSpedizioneGratis`), che nessuno legge.
 */
const PROMETTE_GRATIS = /sped(izione|\.)\s+(è\s+)?grat/i;

/**
 * La stessa riga nomina anche quello che si paga? Allora la promessa non è monca: o scrive la
 * cifra, o la chiede alla funzione che la conosce.
 */
function nominaLaConsegna(riga: string): boolean {
  return (
    riga.includes('promessaSpedizione') ||
    riga.includes('PLATFORM_DELIVERY_FEE_CENTS') ||
    new RegExp((PLATFORM_DELIVERY_FEE_CENTS / 100).toFixed(2).replace('.', '\\.')).test(riga)
  );
}

describe('la frase della vetrina nasce dalla cifra che si paga', () => {
  it('con la consegna a pagamento, nessuna frase dice «gratis» senza dire quanto costa', () => {
    const sopra = promessaSpedizione(35, 30, 300);
    const sotto = promessaSpedizione(12, 30, 300);

    expect(sopra.sopraSoglia).toBe(true);
    expect(sopra.costoConsegna).toBe(3);

    for (const frase of [sopra.titolo, sopra.breve, sotto.titolo, sotto.breve]) {
      if (PROMETTE_GRATIS.test(frase)) {
        expect(frase, `«${frase}» promette la gratuità e tace i 3 € di consegna`).toMatch(/€3\.00/);
      }
    }
    expect(sopra.dettaglioConsegna).toMatch(/€3\.00/);
  });

  it('a consegna gratis il claim pulito torna da sé, senza riscrivere niente', () => {
    const sopra = promessaSpedizione(35, 30, 0);
    expect(sopra.titolo).toBe('Spedizione gratis');
    expect(sopra.breve).not.toMatch(/€/);
    expect(sopra.dettaglioConsegna).toBeNull();
  });

  it('la cifra non è riscritta qui: cambiarla cambia la frase', () => {
    expect(promessaSpedizione(35, 30, 500).titolo).toContain('€5.00');
    expect(promessaSpedizione(35, 30, 500).dettaglioConsegna).toContain('€5.00');
  });

  it('sotto soglia dice quanto manca, e quanto manca viene dalla soglia', () => {
    expect(promessaSpedizione(12, 30, 300).mancano).toBe(18);
    expect(promessaSpedizione(12, 30, 300).titolo).toContain('€18.00');
  });
});

describe('e la cifra è quella che la cassa addebita davvero', () => {
  /** Il conto vero del checkout su un carrello da 35 €, consegnato a casa, senza coupon. */
  const cassa = prezziDelCarrello({
    gruppi: [{ sellerId: 'negozio-1', subtotalCents: 3500 }],
    coordinateNegozio: () => ({ lat: null, lng: null }),
    consegnaLat: null,
    consegnaLng: null,
    pickupInStore: false,
    couponSpedizioneGratis: false,
    couponScontoCents: 0,
  });
  const gruppo = cassa.gruppi[0];

  it('sopra la soglia la spedizione è davvero zero — la promessa in sé è vera', () => {
    expect(3500 / 100).toBeGreaterThanOrEqual(FREE_SHIPPING_THRESHOLD);
    expect(gruppo.shippingCents).toBe(0);
  });

  it('ma la consegna si paga lo stesso, e la vetrina dice quel numero', () => {
    expect(gruppo.deliveryFeeCents, 'se questo va a zero, la gratuità piena è vera').toBeGreaterThan(0);
    const vetrina = promessaSpedizione(35);
    expect(Math.round(vetrina.costoConsegna * 100)).toBe(gruppo.deliveryFeeCents);
    expect(vetrina.titolo).toContain((gruppo.deliveryFeeCents / 100).toFixed(2));
  });

  it('il totale che si paga contiene quella riga: non è un costo teorico', () => {
    expect(cassa.grandTotalCents).toBe(3500 + gruppo.deliveryFeeCents);
  });
});

describe('le vetrine prendono le parole da lì, invece di riscriverle', () => {
  it('la scheda prodotto chiama la funzione e mostra la riga della consegna', () => {
    const src = leggi('app/product/[id]/page.tsx');
    expect(src).toContain('promessaSpedizione');
    expect(src, 'il costo di consegna non compare sulla scheda: si scopre nel carrello').toContain(
      'spedizione.dettaglioConsegna',
    );
    expect(
      righeVive(src).filter((r) => PROMETTE_GRATIS.test(r) && !nominaLaConsegna(r)),
      'la scheda riscrive a mano la promessa invece di chiederla alla funzione',
    ).toEqual([]);
  });

  it('la barra «ti manca poco» chiama la funzione', () => {
    const src = leggi('components/ui/FreeShippingProgress.tsx');
    expect(src).toContain('promessaSpedizione');
    expect(righeVive(src).filter((r) => PROMETTE_GRATIS.test(r) && !nominaLaConsegna(r))).toEqual([]);
  });

  it('le quattro promesse del sito nominano la consegna finché si paga', () => {
    const spedizione = VALUE_PROPS.find((v) => v.title === 'Spedizione gratuita');
    expect(spedizione?.subtitle).toMatch(/per negozio/);
    if (PLATFORM_DELIVERY_FEE_CENTS > 0) {
      expect(spedizione?.subtitle, 'il titolo dice «gratuita» e il sottotitolo tace i 3 €').toContain(
        (PLATFORM_DELIVERY_FEE_CENTS / 100).toFixed(2),
      );
    }
  });

  it('e la risposta della FAQ dice lo stesso numero', () => {
    // Sta nello stesso file della funzione: se la fee cambia, cambia anche questa.
    if (PLATFORM_DELIVERY_FEE_CENTS > 0) {
      expect(rispostaCostoSpedizione().a).toContain((PLATFORM_DELIVERY_FEE_CENTS / 100).toFixed(2));
    }
  });
});

/**
 * LA SPAZZATA — perché il difetto non è «due testi da correggere».
 *
 * La malattia è una frase copiata a mano in N posti mentre la cifra vive in uno solo. Questa prova
 * conta i posti, invece di fidarsi dell'elenco che una radiografia ha compilato.
 *
 * ⚠️ DEBITO DICHIARATO, non nascosto. Quattro superfici dicono ancora la frase a mano e stanno
 * fuori dal territorio di chi ha scritto questa riparazione (altre squadre le stanno toccando nello
 * stesso momento). Sono elencate qui sotto con nome e cognome: la prova ammette QUELLE e nessuna
 * di più, quindi una quinta pagina che ricomincia a promettere la gratuità diventa rossa subito.
 * Quando le quattro passano alla funzione, questa resta verde e la riga si accorcia.
 */
describe('nessuna NUOVA pagina riscrive la promessa a mano', () => {
  /** Ammesse: non sono promesse al cliente (pannello interno, filtro di ricerca, nome di variante). */
  const NON_SONO_PROMESSE = [
    `app${sep}admin${sep}`, // il pannello di MyCity: lì la soglia si amministra, non si promette
    `app${sep}search${sep}`, // etichetta di un filtro: seleziona, non promette
    `components${sep}ui${sep}Badge.tsx`, // il nome di una variante grafica
    `lib${sep}promesse-pubbliche.ts`, // è la funzione: qui la frase DEVE stare
  ];

  /** Debito noto, con l'owner. Ammesse finché ci sono, mai una in più. */
  const SCOPERTE_NOTE = [
    `components${sep}ProductCard.tsx`, // badge «Sped. gratis» — squadra della card di catalogo
    `app${sep}cart${sep}page.tsx`, // sottotitolo del carrello vuoto — squadra del carrello
    `app${sep}shipping${sep}page.tsx`, // pagina Spedizioni — nessuna squadra in questo lotto
    `lib${sep}email${sep}templates.ts`, // email di benvenuto — squadra delle email
  ];

  function tuttiIFile(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
      if (nome === 'node_modules' || nome.startsWith('.')) continue;
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) tuttiIFile(p, out);
      else if (nome.endsWith('.ts') || nome.endsWith('.tsx')) out.push(p);
    }
    return out;
  }

  const file = ['app', 'components', 'lib'].flatMap((c) => tuttiIFile(join(RADICE, c)));

  it('trova davvero dei file (se no non sta misurando niente)', () => {
    expect(file.length).toBeGreaterThan(200);
  });

  it('fuori dalle quattro scoperte note, nessuno promette più la gratuità a mano', () => {
    const colpevoli: string[] = [];
    for (const f of file) {
      const relativo = f.slice(RADICE.length + 1);
      if (NON_SONO_PROMESSE.some((a) => relativo.startsWith(a) || relativo === a)) continue;
      if (SCOPERTE_NOTE.includes(relativo)) continue;
      righeVive(readFileSync(f, 'utf8')).forEach((riga) => {
        if (PROMETTE_GRATIS.test(riga) && !nominaLaConsegna(riga)) colpevoli.push(relativo);
      });
    }
    expect(
      [...new Set(colpevoli)],
      'la spedizione è gratis ma la consegna no: la frase va chiesta a promessaSpedizione()',
    ).toEqual([]);
  });

});
