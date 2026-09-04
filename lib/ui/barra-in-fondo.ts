/**
 * DA DOVE PARTE UNA BARRA INCOLLATA IN FONDO ALLO SCHERMO.
 *
 * 27/8/2026 (R096) — LA SAFE-AREA DELL'IPHONE ERA CONTATA DUE VOLTE.
 *
 * Le due barre che chiudono un acquisto — «Conferma ordine» in cassa e
 * «Aggiungi al carrello» sulla scheda prodotto — mettevano
 * `env(safe-area-inset-bottom)` in DUE posti: dentro `bottom`, per scavalcare
 * la barra gestuale, e di nuovo nel padding (la classe `pb-safe`, o un
 * `pb-[calc(0.75rem+env(...))]`). Su un iPhone con barra gestuale sono una
 * trentina di pixel contati due volte: la barra galleggia staccata dal fondo,
 * con una fascia vuota sotto il pulsante.
 *
 * È un difetto solo visivo, ma sta sui due pulsanti che chiudono l'acquisto:
 * una barra storta proprio lì sembra un sito rotto nel momento in cui serve
 * fiducia, e ruba pixel sugli schermi corti.
 *
 * La misura va in UN posto solo, e il posto giusto è `bottom`: è quello che
 * deve scavalcare la barra gestuale e, quando c'è, il banner dei cookie. Il
 * padding torna a essere padding.
 *
 * 🟢 Pura: costruisce una stringa. Una prova la ESEGUE.
 */

/** La misura della barra gestuale, quella che non va contata due volte. */
export const SAFE_AREA_IN_FONDO = 'env(safe-area-inset-bottom, 0px)';

/**
 * Il `bottom` di una barra incollata in fondo: la safe-area più tutto quello
 * che le sta sotto (barra a schede, banner dei cookie).
 */
export function fondoDellaBarra(sopra: string[] = []): string {
  const pezzi = [SAFE_AREA_IN_FONDO, ...sopra.filter((p) => p.trim().length > 0)];
  return `calc(${pezzi.join(' + ')})`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LE CORSIE IN FONDO ALLO SCHERMO — il registro che mancava.
 *
 * 3/9/2026 — IL PULSANTE TONDO DELL'ASSISTENZA COPRIVA «AGGIUNGI AL CARRELLO».
 *
 * In fondo allo schermo si accatastano quattro cose, scritte in quattro file
 * diversi: la barra a schede, il banner dei cookie, la barra «Aggiungi al
 * carrello» e il banner «Metti MyCity in schermata Home». Ognuno sceglieva da
 * solo quanto stare alzato, con un numero scritto a mano — il pulsante
 * dell'assistenza diceva 96 pixel, pensati per scavalcare la sola barra a
 * schede. Sulla scheda prodotto, però, sopra la barra a schede ce n'è
 * un'altra: il pulsante tondo finiva sopra il lato destro di «Aggiungi al
 * carrello» — dove arriva il pollice destro — e il tocco apriva l'assistenza
 * invece di mettere il prodotto nel carrello.
 *
 * Non era un errore di quel numero: era che non esisteva NESSUN posto dove
 * fosse scritto chi sta sopra chi. Ognuno indovinava.
 *
 * Qui c'è quel posto. L'ordine è uno solo, dal pavimento in su. Chi occupa una
 * corsia dichiara quanto è alto nella variabile della sua corsia (con
 * `seguiAltezza`, che la tiene aggiornata mentre l'elemento cresce). Chi sta
 * più in alto somma le corsie sotto di sé e non deve sapere quanto sono alte.
 *
 * Aggiungere un elemento fisso in fondo vuol dire aggiungere una riga QUI —
 * non indovinare un altro numero.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Corsia = {
  /** Come si chiama, per chi legge il messaggio di una prova diventata rossa. */
  nome: string;
  /** La variabile CSS dove chi la occupa dichiara quanto è alto. */
  variabile: string;
  /** Quanto vale quando quell'elemento non c'è: zero dichiarato, non indovinato. */
  quandoNonCe: string;
};

/** Le corsie, dal pavimento in su. L'ordine di questo elenco È la gerarchia. */
export const CORSIE_IN_FONDO: readonly Corsia[] = [
  { nome: 'la barra a schede', variabile: '--tabbar-height', quandoNonCe: '0px' },
  { nome: 'il banner dei cookie', variabile: '--altezza-banner-cookie', quandoNonCe: '0px' },
  { nome: 'la barra «Aggiungi al carrello»', variabile: '--altezza-barra-acquisto', quandoNonCe: '0px' },
  { nome: 'il banner «Metti MyCity in schermata Home»', variabile: '--altezza-banner-installa', quandoNonCe: '0px' },
];

/** Come si scrive una corsia dentro un `calc`. */
export function misuraDi(c: Corsia): string {
  return `var(${c.variabile}, ${c.quandoNonCe})`;
}

/**
 * Le corsie SOTTO la propria: quelle che chi ci si appoggia sopra deve
 * scavalcare. Un nome che non esiste lancia invece di tornare una lista vuota:
 * una corsia scritta male darebbe un `bottom` troppo basso, cioè il difetto di
 * partenza, e in silenzio.
 */
export function corsieSotto(variabile: string): string[] {
  const i = CORSIE_IN_FONDO.findIndex((c) => c.variabile === variabile);
  if (i < 0) throw new Error(`corsia sconosciuta in fondo allo schermo: ${variabile}`);
  return CORSIE_IN_FONDO.slice(0, i).map(misuraDi);
}

/** Tutte le corsie: per chi galleggia SOPRA ogni cosa, come i pulsanti tondi. */
export function tutteLeCorsie(): string[] {
  return CORSIE_IN_FONDO.map(misuraDi);
}

/** Il pavimento sotto cui chi galleggia non scende. Il perché sta in app/globals.css. */
export const FONDO_MINIMO = 'var(--fondo-minimo, 1.5rem)';

/* ═══════════════════════════════════════════════════════════════════════════
 * FIN DOVE SERVE IL PAVIMENTO — la misura che era scritta due volte.
 *
 * 3/9/2026, secondo giro — IL PULSANTE TONDO TORNAVA SOPRA «CONFERMA ORDINE»
 * FRA 768 E 1023 PIXEL.
 *
 * Il pavimento vale 96 pixel sul telefono e in app/globals.css si abbassava a
 * 24 da 768 in su, con la motivazione scritta accanto: «sul computer sotto non
 * c'è niente da scavalcare». Non era vero. La barra «Conferma ordine» della
 * cassa è `lg:hidden`: resta a video fino a 1023. In quella fascia — cioè ogni
 * iPad in verticale (768, 820, 834) e ogni finestra affiancata su un portatile
 * — tutte le corsie valgono zero, il pavimento valeva 24, e il pulsante tondo
 * dell'assistenza (alto 56, a destra) tornava sopra il pulsante che paga.
 *
 * La malattia non era il numero 768: era che il pavimento e la barra che deve
 * proteggere ragionavano su due soglie diverse, scritte in due file lontani,
 * e nessuno le confrontava. Qui c'è UNA misura sola: chi non dichiara ancora
 * la propria corsia dice fin dove si vede, e il pavimento arriva fin lì.
 *
 * Perché la barra del fattorino non è in questo elenco: è una colonna centrata
 * larga al massimo 480 pixel (`components/rider/RiderShell.tsx`,
 * `app/rider/orders/[id]/page.tsx`). Il suo bordo destro sta a `larghezza/2 +
 * 240`, il pulsante tondo comincia a `larghezza − 72`: si incontrano solo sotto
 * i 624 pixel, dove il pavimento del telefono è già acceso. Sopra, quella barra
 * non passa mai sotto il pulsante.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Le soglie di Tailwind, in pixel: `lg:hidden` vuol dire «sparisce da 1024». */
export const MISURE_TAILWIND = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 } as const;

export type MisuraTailwind = keyof typeof MISURE_TAILWIND;

export type BarraSenzaCorsia = {
  /** Come si chiama, per chi legge il messaggio di una prova diventata rossa. */
  nome: string;
  /** Dove sta scritta, per chi deve andarci. */
  dove: string;
  /** La misura da cui sparisce: `lg:hidden` → 'lg'. La stessa che sta nel file. */
  spariceDa: MisuraTailwind;
};

/** Le barre in fondo che NON dichiarano ancora la propria altezza. */
export const BARRE_SENZA_CORSIA: readonly BarraSenzaCorsia[] = [
  {
    nome: 'la barra «Conferma ordine» in cassa',
    dove: 'app/checkout/page.tsx',
    spariceDa: 'lg',
  },
];

/**
 * La larghezza da cui il pavimento non serve più: quella in cui è sparita
 * anche l'ultima barra che la propria corsia non la dichiara. È il numero che
 * app/globals.css deve usare nella sua `@media`, e una prova controlla che i
 * due siano lo stesso.
 */
export function larghezzaSenzaBarreNonDichiarate(): number {
  return Math.max(...BARRE_SENZA_CORSIA.map((b) => MISURE_TAILWIND[b.spariceDa]));
}

/**
 * Il `bottom` di chi galleggia sopra tutto: le corsie dichiarate, più il
 * respiro — ma mai sotto il pavimento.
 *
 * ⚠️ IL PAVIMENTO NON È UN VEZZO. Due barre in fondo non dichiarano ancora la
 * loro corsia: «Conferma ordine» in cassa e quella del fattorino. Su quelle
 * pagine la barra a schede è nascosta e vale zero, quindi la somma delle corsie
 * darebbe 24 pixel e il pulsante tondo finirebbe sopra «Conferma ordine» — lo
 * stesso difetto, spostato sulla pagina che conta di più. Finché quelle due non
 * dichiarano la propria altezza, il pavimento tiene la misura che il pulsante
 * aveva già.
 */
export function fondoDiChiGalleggia(sopra: string[], respiro: string): string {
  return `max(${FONDO_MINIMO}, ${fondoDellaBarra([...sopra, respiro])})`;
}
