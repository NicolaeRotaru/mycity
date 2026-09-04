/**
 * 3/9/2026 — TRE ROSSI DIVERSI PER LA STESSA COSA.
 *
 * «Pericolo» sul sito era detto in tre colori. Il pulsante di casa
 * (`components/ui/Button.tsx`, variante `danger`) usava #DC2626, che è esattamente il valore scritto
 * nei token del design (`--danger`). La pagina dell'ordine usava un rosa Tailwind diverso (#E11D48)
 * per «Annulla ordine» e per «Apri reclamo». E la finestra di conferma distruttiva mescolava i due
 * mondi: un rosa sfumato dentro la mostarda del marchio.
 *
 * Tre rossi per lo stesso ruolo non sono una sfumatura estetica: chi compra impara i colori del
 * sito, e se «attenzione, questo cancella» ogni volta è di un colore diverso non lo impara più.
 *
 * La scelta fatta qui, dichiarata una volta sola: **pericolo = il token `--danger`**, cioè la rampa
 * `red-*` di Tailwind, che è quella che il pulsante di casa già usava. Niente rosa, e niente vino di
 * marchio (`secondary-*`), che sul sito vuol dire già altro: sconti, preferiti, errori di campo.
 *
 * ⚠️ Questa prova copre il territorio riparato in questo lotto (la pagina dell'ordine e la finestra
 * di conferma). Nel resto del sito il rosa è ancora in giro: è scritto nella consegna, con l'elenco,
 * come lavoro che resta aperto per le altre squadre.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * I passi della rampa rossa di Tailwind che ci servono, col loro valore vero.
 * Serve a legare il NOME della classe al VALORE del token: senza questo ponte,
 * «red-600» e «#DC2626» resterebbero due cose che nessuno confronta mai.
 */
const ROSSI_TAILWIND: Record<string, string> = { 'red-600': '#DC2626' };

function tokenDelPericolo(): string {
  const css = readFileSync('app/globals.css', 'utf8');
  const m = css.match(/--danger:\s*(#[0-9A-Fa-f]{6})/);
  if (!m) throw new Error('il token --danger non si legge più: questa prova non misura niente');
  return m[1].toUpperCase();
}

/** Il colore che il pulsante di casa usa per la variante «danger». */
function rossoDelPulsanteDiCasa(): string {
  const src = readFileSync('components/ui/Button.tsx', 'utf8');
  const blocco = src.slice(src.indexOf('const VARIANTS'), src.indexOf('const SIZES'));
  const m = blocco.match(/danger:\s*'bg-([a-z]+-\d{3})/);
  if (!m) throw new Error('la variante danger del pulsante non si legge più: questa prova non misura niente');
  return m[1];
}

describe('il rosso del pericolo', () => {
  it('il pulsante di casa usa esattamente il colore scritto nei token', () => {
    const classe = rossoDelPulsanteDiCasa();
    expect(
      ROSSI_TAILWIND[classe],
      `il pulsante «danger» usa «${classe}», che non è il rosso del token --danger`,
    ).toBe(tokenDelPericolo());
  });

  it('è la rampa red, non il rosa e non il vino del marchio', () => {
    const famiglia = rossoDelPulsanteDiCasa().split('-')[0];
    expect(famiglia).toBe('red');
  });
});

describe('la pagina dell\'ordine', () => {
  const src = readFileSync('app/orders/[id]/page.tsx', 'utf8');

  it('non usa più il terzo rosso', () => {
    const rimasti = [...src.matchAll(/\brose-\d{2,3}\b/g)].map((m) => m[0]);
    expect(rimasti, 'il rosa Tailwind è un rosso in più per lo stesso ruolo').toEqual([]);
  });

  it('il pulsante che annulla l\'ordine passa dal pulsante di casa', () => {
    expect(
      src,
      'un pulsante distruttivo scritto a mano è il modo in cui nasce il quarto rosso',
    ).toContain('variant="danger"');
  });

  it('e mentre annulla si vede che sta lavorando', () => {
    expect(src).toContain('loading={cancel.isPending}');
  });
});

describe('la finestra di conferma distruttiva', () => {
  const src = readFileSync('components/ConfirmDialog.tsx', 'utf8');
  const famiglia = rossoDelPulsanteDiCasa().split('-')[0];

  it('non usa più il rosa', () => {
    expect([...src.matchAll(/\brose-\d{2,3}\b/g)].map((m) => m[0])).toEqual([]);
  });

  it('usa la stessa famiglia del pulsante di casa', () => {
    const usate = [...src.matchAll(/(?:bg|text|ring|border|from|via|to|shadow)-([a-z]+)-\d{2,3}/g)].map((m) => m[1]);
    expect(usate, 'il dialogo non ha più colori: la prova non misura niente').not.toEqual([]);
    expect(usate).toContain(famiglia);
  });

  it('il rosso del pericolo non sfuma dentro la mostarda del marchio', () => {
    const gradienti = [...src.matchAll(/from-red-\d{2,3}[^']*/g)].map((m) => m[0]);
    expect(gradienti.length, 'nessun gradiente di pericolo: la prova non misura niente').toBeGreaterThan(0);
    for (const g of gradienti) {
      expect(g, `«${g}» mescola il rosso del pericolo con un colore di marchio`).not.toMatch(/accent-|secondary-|primary-/);
    }
  });
});
