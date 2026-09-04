import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 3/9/2026 — NEL PANNELLO DEL NEGOZIANTE IL COPILOT STAVA SOPRA «SALVA MODIFICHE».
 *
 * Quando il negoziante attiva «modifica in blocco» nella lista prodotti — cambia
 * prezzo e giacenza di piu' prodotti insieme — in fondo allo schermo compare la
 * barra con «Annulla» e «Salva modifiche», a destra. Il pulsante tondo del
 * Copilot vive in un altro file (il guscio del venditore), incollato a 24 pixel
 * dal fondo e 24 dal bordo destro, e sta su un livello piu' alto della barra.
 * Sul telefono copriva un quarto del pulsante, sul computer piu' della meta':
 * il tocco apriva il Copilot, che e' un collegamento a un'altra pagina, e le
 * modifiche non salvate sparivano.
 *
 * ── Perche' questa prova legge i sorgenti ──────────────────────────────────
 * La pagina non si disegna senza database, quindi qui non si apre un browser.
 * Ma non si cerca nemmeno una classe: si RICOSTRUISCONO le due scatole dai due
 * file — quanto e' alzato il pulsante, quanto e' largo, dove finisce il
 * contenuto della barra — e si guarda se si sovrappongono, come farebbe un
 * righello. Se domani il Copilot si allarga, cambia parola o si sposta, i
 * numeri cambiano e questa prova diventa rossa da sola.
 *
 * ⚪ Quello che da qui NON ho potuto misurare: la larghezza vera della parola
 * «Copilot» disegnata dal browser. Uso un tetto generoso per lettera: sbagliare
 * per eccesso allarga la fascia da lasciare libera, cioe' rende la prova piu'
 * severa, mai piu' permissiva.
 */

const GUSCIO = join(process.cwd(), 'components/seller/SellerShell.tsx');
const PAGINA = join(process.cwd(), 'app/seller/products/page.tsx');
const BOTTONE = join(process.cwd(), 'components/ui/Button.tsx');
const TAILWIND = join(process.cwd(), 'tailwind.config.ts');

/** La scala di Tailwind: 1 = 0.25rem = 4 pixel (il progetto non la ridefinisce). */
const PASSO = 4;

/** Tetto generoso per lettera, in frazione di corpo: «Copilot» in grassetto a 14px. */
const LARGHEZZA_MASSIMA_PER_LETTERA = 0.75;

/** Il respiro minimo fra il pulsante che galleggia e quello che sta sotto. */
const RESPIRO = 8;

/** Legge una misura di spaziatura da una lista di classi: `pr-24` → 96. */
function misura(classi: string, prefisso: string): number | null {
  const m = classi.match(new RegExp(`(?:^|\\s)${prefisso}-(\\d+(?:\\.\\d+)?)(?:\\s|$)`));
  return m ? Number(m[1]) * PASSO : null;
}

/** Il blocco di sorgente di un elemento, dal suo segno di riconoscimento al tag di chiusura. */
function blocco(src: string, riconoscimento: string, chiusura: string): string {
  const i = src.indexOf(riconoscimento);
  expect(i, `non trovo piu' «${riconoscimento}»: la prova va riscritta`).toBeGreaterThan(-1);
  const inizio = src.lastIndexOf('<', i);
  const fine = src.indexOf(chiusura, i);
  return src.slice(inizio, fine + chiusura.length);
}

/** Le classi del primo className del blocco. */
function classiDi(pezzo: string): string {
  const m = pezzo.match(/className="([^"]+)"/);
  expect(m, 'il blocco non ha piu' + ' un className: la prova va riscritta').not.toBeNull();
  return m![1];
}

/** Il valore numerico di un livello dichiarato in tailwind.config.ts (`'overlay': '40'`). */
function livello(nome: string): number {
  const conf = readFileSync(TAILWIND, 'utf8');
  const m = conf.match(new RegExp(`'${nome}':\\s*'(\\d+)'`));
  expect(m, `il livello ${nome} non e' piu' dichiarato in tailwind.config.ts`).not.toBeNull();
  return Number(m![1]);
}

// ── Il pulsante che galleggia, misurato dal guscio ──────────────────────────
const guscio = readFileSync(GUSCIO, 'utf8');
const fab = blocco(guscio, 'aria-label="Chiedi al Copilot"', '</Link>');
const classiFab = classiDi(fab);
const etichettaFab = fab.match(/<span className="([^"]*)">([^<]+)<\/span>/);
const iconaFab = fab.match(/size=\{(\d+)\}/);

/** Quanto e' larga la scatola del Copilot, con o senza la parola accanto all'icona. */
function larghezzaCopilot(conParola: boolean): number {
  const orizzontale = (misura(classiFab, 'px') ?? 0) * 2;
  const icona = iconaFab ? Number(iconaFab[1]) : 0;
  if (!conParola) return orizzontale + icona;
  const corpo = Number(classiFab.match(/text-\[(\d+)px\]/)?.[1] ?? 16);
  const parola = (etichettaFab?.[2] ?? '').length * corpo * LARGHEZZA_MASSIMA_PER_LETTERA;
  return orizzontale + icona + (misura(classiFab, 'gap') ?? 0) + parola;
}

// ── La barra della modifica in blocco, misurata dalla pagina ────────────────
const pagina = readFileSync(PAGINA, 'utf8');
const barra = blocco(pagina, 'fixed inset-x-0 bottom-0 z-sticky', '>');
const classiBarra = classiDi(barra);

/** Dove finisce il contenuto della barra, contando dal bordo destro dello schermo. */
function fasciaLiberaADestra(schermoLargo: boolean): number {
  const stretta = misura(classiBarra, 'pr') ?? misura(classiBarra, 'px') ?? 0;
  const larga = misura(classiBarra, 'sm:pr') ?? stretta;
  return schermoLargo ? larga : stretta;
}

describe('la barra «modifica in blocco» e il pulsante del Copilot', () => {
  it('si contendono davvero lo stesso angolo: il Copilot sta sopra la barra', () => {
    // Se non si sovrapponessero, non ci sarebbe niente da riservare: qui si
    // controlla che il conflitto esista ancora, altrimenti la prova mente.
    expect(classiFab).toContain('fixed');
    expect(classiFab).toContain('z-overlay');
    expect(classiBarra).toContain('z-sticky');
    expect(
      livello('overlay') > livello('sticky'),
      'il Copilot non sta piu\' sopra la barra: il tocco non finisce piu\' a lui',
    ).toBe(true);

    // In verticale: il pulsante parte a 24px dal pavimento, la barra e' alta
    // quanto il suo respiro piu' il pulsante «Salva modifiche».
    const alzata = misura(classiFab, 'bottom') ?? 0;
    const altezzaPulsanteSm = Number(
      readFileSync(BOTTONE, 'utf8').match(/sm:\s*'[^']*min-h-\[(\d+)px\]/)?.[1] ?? 0,
    );
    const altezzaBarra = (misura(classiBarra, 'py') ?? 0) * 2 + altezzaPulsanteSm;
    expect(altezzaPulsanteSm, 'non leggo piu\' l\'altezza del pulsante piccolo').toBeGreaterThan(0);
    expect(
      alzata < altezzaBarra,
      'il Copilot ora galleggia sopra la barra: la fascia riservata non serve piu\'',
    ).toBe(true);
  });

  it('sul telefono «Salva modifiche» resta fuori dalla scatola del Copilot', () => {
    const scostamento = misura(classiFab, 'right') ?? 0;
    const occupato = scostamento + larghezzaCopilot(false) + RESPIRO;
    const libero = fasciaLiberaADestra(false);

    expect(etichettaFab?.[1], 'la parola del Copilot non e\' piu\' nascosta sul telefono').toContain('hidden');
    expect(
      libero,
      `sul telefono la barra lascia libera una fascia di ${libero}px a destra, ma il Copilot ne occupa ${occupato}px: il tocco su «Salva modifiche» apre il Copilot e le modifiche in blocco si perdono`,
    ).toBeGreaterThanOrEqual(occupato);
  });

  it('sul computer, dove il pulsante porta anche la parola, la fascia libera cresce con lui', () => {
    const scostamento = misura(classiFab, 'right') ?? 0;
    const occupato = scostamento + larghezzaCopilot(true) + RESPIRO;
    const libero = fasciaLiberaADestra(true);

    expect(etichettaFab?.[1], 'sul computer la parola non compare piu\'').toContain('sm:inline');
    expect(
      libero,
      `sul computer la barra lascia libera una fascia di ${libero}px a destra, ma il Copilot con la sua parola ne occupa ${occupato}px`,
    ).toBeGreaterThanOrEqual(occupato);
  });
});
