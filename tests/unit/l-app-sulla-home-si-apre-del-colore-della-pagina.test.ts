/**
 * 6/9/2026 — L'APP INSTALLATA SI APRIVA BIANCA E POI DIVENTAVA PANNA.
 *
 * Chi mette MyCity nella schermata Home del telefono, quando tocca l'icona non
 * vede subito il sito: vede prima lo «schermo di avvio», una schermata che il
 * telefono disegna da solo leggendo public/manifest.json — icona al centro, e
 * dietro il colore dichiarato in `background_color`.
 *
 * Quel colore diceva bianco (#ffffff). La pagina, appena carica, è color panna
 * (cream-100, #FBF7F0: lo dichiara app/globals.css sia su <html> sia sul
 * corpo). Fra i due c'era un lampo bianco→panna a ogni apertura.
 *
 * LA RADICE. Il manifesto è stato scritto prima che si scegliesse il fondo
 * panna, e non è mai stato riallineato ai colori del sito. Non è un errore di
 * battitura: è una copia del colore che vive in un file che nessuno rilegge
 * quando la palette cambia.
 *
 * Questa prova non si fida di un colore scritto a mano: prende il colore vero
 * del fondo pagina da app/globals.css — seguendo la catena --surface-page →
 * --cream-100 — e pretende che il manifesto dica lo stesso. Diventa rossa
 * anche se un domani si cambia la palette e ci si dimentica del manifesto.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const GLOBALS = readFileSync('app/globals.css', 'utf8');
const MANIFESTO = JSON.parse(readFileSync('public/manifest.json', 'utf8')) as Record<string, string>;

/** Il valore di una variabile dichiarata nel blocco :root di app/globals.css. */
function token(nome: string): string {
  const m = GLOBALS.match(new RegExp(`${nome}\\s*:\\s*([^;]+);`));
  expect(m, `in app/globals.css non c'è più ${nome}: questa prova non misura niente`).toBeTruthy();
  return m![1].trim();
}

/** Risolve una catena di `var(...)` fino al colore vero. */
function coloreVero(nome: string): string {
  let valore = token(nome);
  for (let giri = 0; giri < 5; giri++) {
    const rinvio = valore.match(/^var\(\s*(--[\w-]+)\s*\)$/);
    if (!rinvio) break;
    valore = token(rinvio[1]);
  }
  expect(valore, `${nome} non arriva a un colore: ${valore}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
  return valore.toUpperCase();
}

describe('lo schermo di avvio dell\'app e la pagina sono dello stesso colore', () => {
  it('il fondo dichiarato nel manifesto è quello vero della pagina', () => {
    const pagina = coloreVero('--surface-page');

    expect(
      (MANIFESTO.background_color ?? '').toUpperCase(),
      `lo schermo di avvio è ${MANIFESTO.background_color} e la pagina è ${pagina}: chi apre l'app ` +
        'dall\'icona vede un lampo di un colore che poi diventa un altro',
    ).toBe(pagina);
  });

  it('e non è il bianco, che era il colore sbagliato di partenza', () => {
    expect(
      (MANIFESTO.background_color ?? '').toLowerCase(),
      'il manifesto è tornato al bianco: il lampo all\'avvio ricompare',
    ).not.toBe('#ffffff');
  });

  it('il colore del bordo superiore resta quello del marchio, come già era', () => {
    // theme_color era già coerente: la prova la tiene ferma, così sistemare il
    // fondo non porta via l'unica cosa che andava bene.
    expect(
      (MANIFESTO.theme_color ?? '').toUpperCase(),
      'il colore del marchio nel manifesto non è più la terracotta primaria',
    ).toBe(coloreVero('--primary-600'));
  });
});
