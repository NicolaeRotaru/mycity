import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { buildShippingLabel, type LabelData } from '@/lib/shipping-etichetta/label';

/**
 * L'etichetta 102x152 mm che il negozio stampa e attacca al pacco.
 *
 * I font standard di PDFKit (Helvetica, Courier) sanno scrivere solo i caratteri
 * WinAnsi. Un'emoji finisce nel PDF come una coppia di mezzi caratteri e la
 * stampante mostra segni spuri: prima della riparazione, sul riquadro rosso del
 * contrassegno usciva «O=U° CONTRASSEGNO» proprio sopra la cifra che il fattorino
 * deve riscuotere. Questa prova torna rossa se qualcuno rimette un'emoji
 * sull'etichetta senza incorporare prima un font vero (doc.registerFont).
 */

const ORDINE: LabelData = {
  orderId: 'a1b2c3d4-0000-0000-0000-000000000000',
  recipientName: 'Mario Rossi',
  street: 'Via Roma 1',
  zip: '29121',
  city: 'Piacenza',
  phone: '+39 333 1234567',
  sellerName: 'Pane Quotidiano',
  totalCents: 2350,
  isCod: true,
};

/** Sgonfia i flussi compressi del PDF e restituisce quello che contengono. */
function flussiDelPdf(pdf: Buffer): string {
  let flusso = '';
  let da = 0;
  for (;;) {
    const inizio = pdf.indexOf('stream', da);
    if (inizio < 0) break;
    let s = inizio + 'stream'.length;
    if (pdf[s] === 0x0d) s++;
    if (pdf[s] === 0x0a) s++;
    const fine = pdf.indexOf('endstream', s);
    if (fine < 0) break;
    try {
      flusso += zlib.inflateSync(pdf.subarray(s, fine)).toString('latin1');
    } catch {
      // flusso non compresso o non di testo: si salta
    }
    da = fine + 1;
  }
  return flusso;
}

/**
 * Le parole stampate. PDFKit non scrive il testo in chiaro: lo mette come gruppi
 * esadecimali fra parentesi angolari, un byte per lettera. Qui si rimettono insieme.
 */
function paroleStampate(pdf: Buffer): string {
  let testo = '';
  for (const gruppo of flussiDelPdf(pdf).matchAll(/<([0-9a-fA-F]+)>/g)) {
    testo += Buffer.from(gruppo[1], 'hex').toString('latin1');
  }
  return testo;
}

describe('etichetta di spedizione', () => {
  it('sul riquadro del contrassegno la parola si legge, senza segni spuri', async () => {
    const stampato = paroleStampate(await buildShippingLabel(ORDINE));

    expect(stampato).toContain('CONTRASSEGNO');
    expect(stampato).toContain('Riscuoti:');
    // I due mezzi caratteri del sacchetto di soldi (U+1F4B0 = D83D DCB0).
    expect(stampato).not.toContain('Ø=Ü°');
  });

  it('nessuna emoji finisce sull etichetta, di nessun tipo', async () => {
    const stampato = paroleStampate(await buildShippingLabel(ORDINE));

    // Qualunque emoji diventa una coppia di mezzi caratteri: primo byte D8-DB,
    // terzo byte DC-DF. Se questa forma compare, sulla stampa esce spazzatura.
    expect(/[Ø-Û][\s\S][Ü-ß]/.test(stampato)).toBe(false);
  });

  it('l etichetta senza contrassegno non stampa il riquadro da riscuotere', async () => {
    const stampato = paroleStampate(await buildShippingLabel({ ...ORDINE, isCod: false }));

    expect(stampato).toContain('Mario Rossi');
    expect(stampato).not.toContain('CONTRASSEGNO');
  });
});
