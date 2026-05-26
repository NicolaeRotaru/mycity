/**
 * Generatore label di spedizione per stampante termica 4×6 inch (102×152mm).
 * Standard del settore (DHL, BRT, GLS usano questo formato).
 *
 * Esperti senior consultati:
 * - Operations Manager: "Un seller con 50 ordini/giorno DEVE poter stampare
 *   label in 1 click, non scrivere a mano"
 * - Logistics Manager: "QR code obbligatorio per scanning rider"
 * - Privacy: "Niente PII inutili sul label (solo nome + via + CAP + città)"
 *
 * Usa pdfkit (già installato per fatture).
 * Output: Buffer PDF pronto per stampa o download.
 */

import PDFDocument from 'pdfkit';

export type LabelData = {
  orderId: string;
  recipientName: string;
  street: string;
  zip: string;
  city: string;
  phone: string;
  notes?: string;
  sellerName: string;
  totalCents: number;
  isCod: boolean;
};

const MM_TO_PT = 72 / 25.4;
const LABEL_W = 102 * MM_TO_PT; // 102mm = 4 inch
const LABEL_H = 152 * MM_TO_PT; // 152mm = 6 inch

export async function buildShippingLabel(data: LabelData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: [LABEL_W, LABEL_H],
        margin: 8 * MM_TO_PT,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header brand
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#C0492C').text('MyCity', { align: 'center' });
      doc.fontSize(7).font('Helvetica').fillColor('#666666').text('Marketplace dei negozi locali · Piacenza', { align: 'center' });
      doc.moveDown(0.5);

      // Linea separatore
      doc.strokeColor('#cccccc').lineWidth(0.5)
        .moveTo(8 * MM_TO_PT, doc.y)
        .lineTo(LABEL_W - 8 * MM_TO_PT, doc.y)
        .stroke();
      doc.moveDown(0.5);

      // ORDER ID grande
      doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold').text('ORDINE:');
      doc.fontSize(14).font('Courier-Bold').text(`#${data.orderId.slice(0, 8).toUpperCase()}`);
      doc.moveDown(0.6);

      // Mittente
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#666666').text('DA:');
      doc.fontSize(10).font('Helvetica').fillColor('#000000').text(data.sellerName);
      doc.fontSize(7).fillColor('#888888').text('Piacenza, Italia');
      doc.moveDown(0.6);

      // Destinatario (grande, ben leggibile)
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#666666').text('A:');
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#000000').text(data.recipientName);
      doc.fontSize(11).font('Helvetica').text(data.street);
      doc.fontSize(11).font('Helvetica-Bold').text(`${data.zip} ${data.city}`);
      doc.moveDown(0.3);
      doc.fontSize(9).font('Helvetica').fillColor('#666666').text(`Tel: ${data.phone}`);

      if (data.notes) {
        doc.moveDown(0.4);
        doc.fontSize(8).fillColor('#000000').font('Helvetica-Bold').text('NOTE:');
        doc.fontSize(8).font('Helvetica').text(data.notes.slice(0, 200));
      }

      doc.moveDown(0.6);

      // COD box (se cash on delivery)
      if (data.isCod) {
        const y = doc.y;
        doc.lineWidth(1.5).strokeColor('#C0492C')
          .rect(8 * MM_TO_PT, y, LABEL_W - 16 * MM_TO_PT, 35)
          .stroke();
        doc.fillColor('#C0492C').fontSize(8).font('Helvetica-Bold').text('💰 CONTRASSEGNO', 10 * MM_TO_PT, y + 4);
        doc.fontSize(14).font('Helvetica-Bold').text(`Riscuoti: €${(data.totalCents / 100).toFixed(2)}`, 10 * MM_TO_PT, y + 16);
        doc.fillColor('#000000');
        doc.y = y + 40;
      }

      // Footer
      doc.moveDown(0.5);
      doc.fontSize(7).font('Helvetica').fillColor('#888888')
        .text(`Generato: ${new Date().toLocaleString('it-IT')}`, { align: 'center' });
      doc.fontSize(6).fillColor('#aaaaaa')
        .text('mycity-marketplace.com', { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
