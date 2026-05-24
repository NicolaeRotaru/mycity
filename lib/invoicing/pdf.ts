/**
 * Generazione PDF fattura buyer-friendly. Usata per ALLEGARE il PDF
 * scaricabile dal dettaglio ordine. Il documento ufficiale (XML SDI)
 * resta gestito dal provider SDI.
 */
import type { InvoiceDoc } from './types';

// pdfkit non ha types ufficiali completi: import dinamico per evitare
// di gonfiare il bundle quando l'API non viene chiamata.
export async function renderInvoicePdf(doc: InvoiceDoc): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    // Header
    pdf.fontSize(20).fillColor('#4f46e5').text('Fattura', { align: 'right' });
    pdf.moveDown(0.3);
    pdf.fontSize(10).fillColor('#0f172a').text(`Numero: ${doc.number}`, { align: 'right' });
    pdf.text(`Data: ${doc.date}`, { align: 'right' });
    pdf.text(`Ordine: ${doc.orderId.slice(0, 8)}`, { align: 'right' });

    // Seller
    pdf.moveDown(2);
    pdf.fontSize(11).fillColor('#64748b').text('Venditore');
    pdf.fontSize(12).fillColor('#0f172a').text(doc.seller.name);
    if (doc.seller.vatNumber) pdf.text(`P.IVA ${doc.seller.vatNumber}`);
    pdf.text(`${doc.seller.address}, ${doc.seller.zip} ${doc.seller.city}`);
    if (doc.seller.pec) pdf.text(`PEC: ${doc.seller.pec}`);

    // Buyer
    pdf.moveDown(1);
    pdf.fontSize(11).fillColor('#64748b').text('Cliente');
    pdf.fontSize(12).fillColor('#0f172a').text(doc.buyer.name);
    if (doc.buyer.vatNumber) pdf.text(`P.IVA ${doc.buyer.vatNumber}`);
    else if (doc.buyer.fiscalCode) pdf.text(`CF: ${doc.buyer.fiscalCode}`);
    pdf.text(`${doc.buyer.address}, ${doc.buyer.zip} ${doc.buyer.city}`);
    if (doc.buyer.sdiCode) pdf.text(`Codice SDI: ${doc.buyer.sdiCode}`);

    // Lines
    pdf.moveDown(2);
    pdf.fontSize(11).fillColor('#0f172a');
    const tableTop = pdf.y;
    pdf.text('Descrizione',          48,  tableTop);
    pdf.text('Qta',                  330, tableTop, { width: 40,  align: 'right' });
    pdf.text('Prezzo',               375, tableTop, { width: 70,  align: 'right' });
    pdf.text('IVA',                  450, tableTop, { width: 40,  align: 'right' });
    pdf.text('Totale',               495, tableTop, { width: 60,  align: 'right' });
    pdf.moveTo(48, tableTop + 16).lineTo(555, tableTop + 16).stroke('#cbd5e1');

    let y = tableTop + 22;
    let netTotal = 0;
    const vatBuckets: Record<number, number> = {};
    for (const line of doc.lines) {
      const lineNet = line.unitPrice * line.quantity;
      const lineVat = lineNet * (line.vatRate / 100);
      netTotal += lineNet;
      vatBuckets[line.vatRate] = (vatBuckets[line.vatRate] ?? 0) + lineVat;
      pdf.text(line.description, 48,  y, { width: 280 });
      pdf.text(String(line.quantity), 330, y, { width: 40, align: 'right' });
      pdf.text(`€${line.unitPrice.toFixed(2)}`, 375, y, { width: 70, align: 'right' });
      pdf.text(`${line.vatRate}%`, 450, y, { width: 40, align: 'right' });
      pdf.text(`€${(lineNet + lineVat).toFixed(2)}`, 495, y, { width: 60, align: 'right' });
      y += 20;
    }

    pdf.moveTo(48, y + 5).lineTo(555, y + 5).stroke('#cbd5e1');
    y += 14;
    pdf.text('Imponibile', 375, y, { width: 110, align: 'right' });
    pdf.text(`€${netTotal.toFixed(2)}`, 495, y, { width: 60, align: 'right' });
    y += 16;
    for (const [rate, amount] of Object.entries(vatBuckets)) {
      pdf.text(`IVA ${rate}%`, 375, y, { width: 110, align: 'right' });
      pdf.text(`€${amount.toFixed(2)}`, 495, y, { width: 60, align: 'right' });
      y += 16;
    }
    const grandTotal = netTotal + Object.values(vatBuckets).reduce((s, v) => s + v, 0);
    y += 4;
    pdf.fontSize(13).fillColor('#0f172a').text('TOTALE', 375, y, { width: 110, align: 'right' });
    pdf.text(`€${grandTotal.toFixed(2)}`, 495, y, { width: 60, align: 'right' });

    pdf.moveDown(3);
    pdf.fontSize(9).fillColor('#64748b').text(
      `Pagamento: ${doc.paymentMethod === 'cod' ? 'Contanti alla consegna' : 'Carta di credito (gestita da Stripe)'}.\n` +
      'Documento conforme al D.M. 17.06.2014. Per la fattura elettronica con valore fiscale ' +
      'fa fede il file XML inviato al Sistema di Interscambio (SDI).',
    );

    pdf.end();
  });
}
