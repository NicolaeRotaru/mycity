/**
 * 3/9/2026 — NEL CARRELLO, DAL TELEFONO, «PROCEDI AL CHECKOUT» ERA L'ULTIMA COSA DELLA PAGINA.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────────
 * La pagina del carrello è a due colonne solo da 1024 pixel in su. Sul telefono le colonne si
 * impilano, e l'ordine in cui la gente le incontra era: tutti gli articoli, poi «Completa con»
 * (l'upsell), poi «← Continua lo shopping», e soltanto in fondo il riepilogo con il pulsante
 * d'ordine. Due inviti a NON concludere prima di trovare il modo di concludere, e per trovarlo si
 * doveva scorrere tutto il carrello.
 *
 * Il confronto che rende la cosa evidente: le altre due tappe dello stesso percorso una barra
 * sempre visibile ce l'hanno da mesi — la scheda prodotto («Aggiungi al carrello») e la cassa
 * («Conferma ordine»). Il carrello era l'unico dei tre passaggi senza. Il pulsante che porta i
 * soldi era quello che si vedeva meno.
 *
 * ── Cosa prova questo file, e cosa non prova ────────────────────────────────────────────────────
 * La pagina non si può montare in una prova (in questa repo i componenti React non si montano
 * qui), quindi la prova legge il sorgente vero e tiene gli invarianti che descrivono il
 * comportamento: che la barra ci sia, che porti al pagamento, che mostri il totale, che parta da
 * sopra le cose che le stanno sotto, e che dichiari quanto è alta.
 *
 * La parte del «da dove parte» non è una parola cercata: ESEGUE il registro vero delle corsie in
 * fondo allo schermo (`lib/ui/barra-in-fondo.ts`) con il nome di corsia scritto nel carrello. Se
 * domani qualcuno riordina quel registro e la barra del carrello finisce sotto la barra a schede,
 * questa prova diventa rossa senza che nessuno la debba riscrivere.
 *
 * ⚠️ Cosa NON prova: che su un telefono vero la barra si veda e il pollice ci arrivi. Qui non c'è
 * un browser che impagina: si controllano le regole con cui la barra è costruita, non i pixel.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { corsieSotto, fondoDellaBarra, CORSIE_IN_FONDO } from '@/lib/ui/barra-in-fondo';

const CARRELLO = readFileSync(join(process.cwd(), 'app/cart/page.tsx'), 'utf8');

/** Toglie i commenti: quello che ci scriviamo dentro non è codice che gira. */
const senzaCommenti = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SRC = senzaCommenti(CARRELLO);

/**
 * Il link che porta alla cassa. Si cerca l'attributo intero e non la parola «/checkout»: quella
 * compare già nella riga che importa lo step indicator, in cima al file, e una prova che si
 * accontentasse di lei passerebbe sempre. (Misurato: rimettendo il link «Continua lo shopping»
 * davanti al pulsante d'ordine, la prova restava verde.)
 */
const LINK_ALLA_CASSA = 'href="/checkout"';

/** L'apertura dell'elemento incollato in fondo: `fixed` e visibile solo sotto i 1024 pixel. */
const APERTURA_BARRA = (() => {
  for (const m of SRC.matchAll(/<div\b/g)) {
    const fine = SRC.indexOf('>', m.index!);
    const apertura = SRC.slice(m.index!, fine);
    if (/\bfixed\b/.test(apertura) && /\blg:hidden\b/.test(apertura)) return { da: m.index!, testo: apertura };
  }
  return null;
})();

/** La barra intera: dall'apertura fino alla fine del pulsante che porta al pagamento. */
const BARRA = (() => {
  if (!APERTURA_BARRA) return '';
  const checkout = SRC.indexOf(LINK_ALLA_CASSA, APERTURA_BARRA.da);
  if (checkout < 0) return SRC.slice(APERTURA_BARRA.da, APERTURA_BARRA.da + 1200);
  return SRC.slice(APERTURA_BARRA.da, SRC.indexOf('</div>', checkout) + 6);
})();

/** Il nome della corsia che la barra del carrello occupa in fondo allo schermo. */
const CORSIA = SRC.match(/const CORSIA_DELLA_BARRA = '([^']+)'/)?.[1];

describe('il carrello, dal telefono', () => {
  it('ha una barra incollata in fondo, e solo dove serve', () => {
    // Prima della cura, in tutto il file non c'era una sola occorrenza di `fixed`: il carrello era
    // l'unica delle tre pagine del percorso d'acquisto senza barra sempre visibile.
    expect(APERTURA_BARRA, 'nel carrello non c\'è nessuna barra incollata in fondo').not.toBeNull();
    // `lg:hidden` e non `md:hidden`: il riepilogo si appiccica a destra solo da 1024 pixel, quindi
    // fra 768 e 1023 senza barra non resterebbe nessun pulsante d'ordine a portata di mano.
    expect(APERTURA_BARRA!.testo).toContain('lg:hidden');
  });

  it('quella barra porta al pagamento e dice quanto si paga', () => {
    expect(BARRA, 'la barra non porta alla cassa: è un ornamento').toContain(LINK_ALLA_CASSA);
    expect(BARRA, 'una barra che non mostra il totale chiede di fidarsi al buio').toContain('finalTotal');
  });

  it('parte da sopra la barra a schede e da sopra il banner dei cookie', () => {
    expect(CORSIA, 'il carrello non dichiara più quale corsia occupa in fondo allo schermo').toBeTruthy();
    expect(BARRA, 'il `bottom` è scritto a mano: il primo numero che sbaglia lo nasconde').toContain('fondoDellaBarra(corsieSotto(');

    // Qui non si cercano parole: si esegue il registro vero e si guarda cosa dice.
    const partenza = fondoDellaBarra(corsieSotto(CORSIA!));
    expect(partenza, 'sotto la barra a schede il pulsante d\'ordine non si preme').toContain('--tabbar-height');
    expect(partenza, 'col banner dei cookie sopra, il pulsante d\'ordine resta coperto').toContain('--altezza-banner-cookie');
    expect(partenza, 'la barra gestuale dell\'iPhone va scavalcata').toContain('safe-area-inset-bottom');
  });

  it('e la barra gestuale dell iPhone non viene contata due volte', () => {
    // Il difetto già visto sulle altre due barre: la safe-area messa sia in `bottom` sia nel
    // padding fa galleggiare la barra staccata dal fondo, con una fascia vuota sotto il pulsante.
    expect(BARRA).not.toMatch(/\bpb-safe\b/);
    expect(BARRA.replace(/style=\{\{[^}]*\}\}/, '')).not.toContain('safe-area-inset-bottom');
  });

  it('dichiara quanto è alta, se no il pulsante tondo dell assistenza le finisce sopra', () => {
    // Il pulsante dell'assistenza galleggia sopra TUTTE le corsie: se questa barra non dichiara la
    // sua, lui si alza di zero e atterra sul pulsante d'ordine. È il difetto già curato sulla
    // scheda prodotto, che qui si ripresenterebbe identico.
    expect(SRC).toContain('seguiAltezza(barraRef.current');
    expect(SRC).toContain('CORSIA_DELLA_BARRA');
    expect(
      CORSIE_IN_FONDO.some((c) => c.variabile === CORSIA),
      'la corsia del carrello non è nel registro: nessuno sa che esiste',
    ).toBe(true);
  });

  it('e lascia spazio sotto il contenuto, se no copre l ultima riga', () => {
    const contenitore = SRC.match(/<div className="container[^"]*py-8[^"]*"/g) ?? [];
    expect(
      contenitore.some((c) => /\bpb-\d+\b/.test(c)),
      'senza spazio riservato in fondo, la barra copre l\'ultima riga del carrello',
    ).toBe(true);
  });
});

describe('l ordine in cui si incontrano le cose, su una colonna sola', () => {
  it('«Continua lo shopping» non sta più davanti al pulsante d ordine', () => {
    const continua = SRC.indexOf('Continua lo shopping');
    const ordina = SRC.indexOf(LINK_ALLA_CASSA);
    expect(continua, 'il link «Continua lo shopping» non c\'è più: la prova va riscritta').toBeGreaterThan(-1);
    expect(ordina).toBeGreaterThan(-1);
    expect(
      continua,
      'l\'ultima cosa letta prima di decidere era «torna a girare per negozi»',
    ).toBeGreaterThan(ordina);
  });
});
