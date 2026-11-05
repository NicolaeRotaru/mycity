/**
 * 5/11/2026 — L'ETICHETTA SCRIVE SOLO QUELLO CHE I SUOI FONT SANNO SCRIVERE.
 *
 * L'etichetta usa i font standard di PDFKit (Helvetica, Courier), che conoscono solo WinAnsi
 * (cp1252). Un carattere fuori, per esempio la «ț» di «Ionuț» o un'emoji nelle note, finiva nel PDF
 * come cifre esadecimali sfasate: il resto della riga si leggeva come segni a caso, e al citofono il
 * nome non si riconosceva. Qui il testo libero del cliente si riduce a WinAnsi prima della stampa: le
 * lettere accentate italiane restano (sono in cp1252), le altre perdono il segno diacritico («ț» → «t»,
 * «ș» → «s»), quello che non ha una lettera base (emoji, simboli) si toglie.
 */
const EXTRA_CP1252 = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

function inWinAnsi(c: string): boolean {
  const cp = c.codePointAt(0) ?? 0;
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return true;
  if (cp >= 0x20 && cp <= 0x7e) return true;
  if (cp >= 0xa0 && cp <= 0xff) return true;
  return EXTRA_CP1252.includes(c);
}

export function testoPerEtichetta(testo: string | null | undefined): string {
  if (!testo) return '';
  let fuori = '';
  for (const c of Array.from(testo)) {
    if (inWinAnsi(c)) {
      fuori += c;
      continue;
    }
    const base = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    fuori += Array.from(base).filter(inWinAnsi).join('');
  }
  return fuori.replace(/ {2,}/g, ' ').trim();
}
