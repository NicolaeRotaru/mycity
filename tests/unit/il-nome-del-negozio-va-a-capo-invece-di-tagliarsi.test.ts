/**
 * 3/9/2026 — SULLA COPERTINA IL NOME DEL NEGOZIO SI TAGLIAVA A META'.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────
 * Il nome del negozio è il titolo della sua pagina: è l'`<h1>` della copertina.
 * Lo `span` che lo conteneva aveva la classe `truncate` — una riga sola, e tutto
 * quello che eccede sparisce dietro tre puntini. Mai a capo.
 *
 * Il conto dello spazio su un telefono da 375 punti: tolti i 40 di margine della
 * barra, i 72 del riquadro del logo e i 16 di distanza, al titolo ne restano
 * circa 247 — da dividere per giunta col bollino «negozio verificato», che sta
 * dentro lo stesso `<h1>`. A 28 punti in Fraunces grassetto ci stanno all'incirca
 * quindici lettere. «Salumeria del Borgo» ne ha diciannove: veniva mozzato.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────
 * Due cose, sul sorgente vero. Che il nome del negozio non porti addosso nessuna
 * classe che tagli il testo — né lui né il titolo che lo contiene. E che su
 * telefono il titolo parta da una misura in cui un nome normale ci sta.
 *
 * La misura in punti è una stima: da qui non posso aprire un browser e contare i
 * pixel. Il taglio invece era certo, perché `truncate` taglia sempre appena il
 * testo eccede — ed è quello che questa prova impedisce di rimettere.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SEZIONI = join(process.cwd(), 'components/store-sections');
const HERO = readFileSync(join(SEZIONI, 'HeroSection.tsx'), 'utf8');

/** Le classi che impediscono a una scritta di andare a capo. */
const TAGLIANO = /\b(truncate|text-ellipsis|whitespace-nowrap|line-clamp-1)\b/;

/** Toglie i commenti: quello che ci scriviamo dentro non è codice che gira. */
const senzaCommenti = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const HERO_PULITO = senzaCommenti(HERO);

/** L'apertura dell'`<h1>` della copertina, con tutte le sue classi. */
const APERTURA_H1 = HERO_PULITO.match(/<h1\s+className="([^"]+)"/);

/** Il titolo intero, dall'apertura alla chiusura. */
const BLOCCO_H1 = (() => {
  const da = HERO_PULITO.indexOf('<h1');
  const a = HERO_PULITO.indexOf('</h1>', da);
  return da > -1 && a > da ? HERO_PULITO.slice(da, a) : '';
})();

/**
 * La riga che scrive davvero il nome del negozio, cercata DENTRO il titolo: piu'
 * su c'e' il riquadro del logo, che il nome se lo passa come etichetta e non
 * come scritta a schermo.
 */
const RIGA_DEL_NOME = BLOCCO_H1.split('\n').find((r) => r.includes('{store.store_name}'));

describe('il pezzo che stiamo guardando esiste ancora', () => {
  it('la copertina ha un titolo di pagina', () => {
    expect(APERTURA_H1, "non trovo più l'<h1> della copertina: la prova va riscritta").not.toBeNull();
  });

  it('e dentro ci scrive il nome del negozio', () => {
    expect(RIGA_DEL_NOME, 'non trovo più la riga che scrive il nome: la prova va riscritta').toBeTruthy();
    expect(RIGA_DEL_NOME!).toMatch(/className="[^"]*"/);
  });
});

describe('il nome del negozio va a capo', () => {
  it('la riga che lo scrive non porta nessuna classe che tagli', () => {
    const classi = RIGA_DEL_NOME!.match(/className="([^"]*)"/)![1];
    expect(
      classi,
      `il nome del negozio è scritto con «${classi}»: con una di queste classi resta su una riga sola ` +
        `e il resto sparisce dietro tre puntini. Il titolo della pagina si legge intero.`,
    ).not.toMatch(TAGLIANO);
  });

  it('e nemmeno il titolo che lo contiene', () => {
    expect(APERTURA_H1![1]).not.toMatch(TAGLIANO);
  });

  it('un nome tutto attaccato non esce dal bordo', () => {
    // Senza `truncate` un nome senza spazi non saprebbe dove spezzarsi e
    // andrebbe oltre la copertina: si è tolto il taglio, non il contenimento.
    expect(RIGA_DEL_NOME!.match(/className="([^"]*)"/)![1]).toMatch(/\bbreak-words\b/);
  });

  it('nessun altro titolo della vetrina taglia le scritte', () => {
    // La malattia è di classe, non di punto: un `<h1>` o un `<h2>` che tronca è
    // sempre un titolo che il cliente non legge intero.
    const colpevoli: string[] = [];
    for (const file of readdirSync(SEZIONI).filter((f) => f.endsWith('.tsx'))) {
      const src = senzaCommenti(readFileSync(join(SEZIONI, file), 'utf8'));
      for (const m of src.matchAll(/<h[12]\s+className="([^"]+)"/g)) {
        if (TAGLIANO.test(m[1])) colpevoli.push(`${file}: <h…> con «${m[1]}»`);
      }
    }
    expect(colpevoli, 'un titolo della vetrina taglia il testo invece di mandarlo a capo').toEqual([]);
  });
});

describe('e parte da una misura in cui un nome normale ci sta', () => {
  const classi = APERTURA_H1![1];

  it('su telefono il titolo non supera i 24 punti', () => {
    const base = classi.match(/(?:^|\s)text-\[(\d+)px\]/);
    expect(base, "l'<h1> non dichiara più una misura di partenza: la prova va riscritta").not.toBeNull();
    const punti = Number(base![1]);
    expect(
      punti,
      `il titolo parte da ${punti} punti: nei circa 247 che restano su un telefono da 375 ci stanno ` +
        `troppo poche lettere, e un nome normale finisce su tre righe o peggio.`,
    ).toBeLessThanOrEqual(24);
  });

  it('su schermo largo resta grande come prima', () => {
    // La cura era mandare a capo, non rimpicciolire ovunque: il nome del
    // negozio è la cosa più grossa della pagina e deve restarlo.
    const grande = classi.match(/\bsm:text-\[(\d+)px\]/);
    expect(grande, 'il titolo non ha più una misura per lo schermo largo').not.toBeNull();
    expect(Number(grande![1])).toBeGreaterThanOrEqual(30);
  });
});
