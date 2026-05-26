import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { getInvoiceProvider } from '@/lib/invoicing/providers';
import { renderInvoicePdf } from '@/lib/invoicing/pdf';
import type { InvoiceDoc } from '@/lib/invoicing/types';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const Body = z.object({ orderId: z.string().uuid() });

/**
 * Genera fattura per un ordine DELIVERED:
 *  1) Alloca numero progressivo via next_invoice_number(seller, year)
 *  2) Costruisce InvoiceDoc dai dati DB
 *  3) Renderizza PDF e lo upload in bucket privato `invoices`
 *  4) Invia all'SDI tramite provider configurato
 *  5) Salva invoice_number, invoice_pdf_url, invoice_sdi_id, invoice_sdi_status
 *
 * Solo service_role (chiamata da cron o trigger su DELIVERED).
 */
export async function POST(req: NextRequest) {
  const internalKey = req.headers.get('x-internal-secret');
  if (!internalKey || internalKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e: any) {
    return NextResponse.json({ error: 'Bad request', details: e?.message }, { status: 400 });
  }

  const admin = getAdminSupabase();

  // 1) Carica ordine + items + parti
  const { data: order, error: oErr } = await admin
    .from('orders')
    .select(`
      id, user_id, seller_id, total_price, payment_method, delivery_status,
      delivery_full_name, delivery_address, delivery_city, delivery_zip,
      invoice_number, payment_status
    `)
    .eq('id', body.orderId)
    .single();

  if (oErr || !order) return NextResponse.json({ error: 'Ordine non trovato' }, { status: 404 });
  if (order.delivery_status !== 'DELIVERED') {
    return NextResponse.json({ error: 'Ordine non consegnato' }, { status: 409 });
  }
  if (order.invoice_number) {
    return NextResponse.json({ error: 'Fattura gia\' esistente', invoice_number: order.invoice_number }, { status: 409 });
  }

  const { data: items } = await admin
    .from('order_items')
    .select('quantity, unit_price, products(name)')
    .eq('order_id', order.id);

  const { data: seller } = await admin
    .from('profiles')
    .select('store_name, business_legal_name, business_vat_number, business_address, business_city, business_zip, business_pec, business_sdi, legal_fiscal_code')
    .eq('id', order.seller_id)
    .single();

  const { data: ua } = await admin.auth.admin.getUserById(order.user_id);
  const buyerEmail = ua?.user?.email ?? null;

  // 2) Numero progressivo
  const year = new Date().getFullYear();
  const { data: numberData, error: numErr } = await admin
    .rpc('next_invoice_number', { p_seller: order.seller_id, p_year: year });
  if (numErr) {
    logger.error('[invoice] number allocation failed', numErr);
    return NextResponse.json({ error: 'Numero fattura non allocato' }, { status: 500 });
  }
  const invoiceNumber = numberData as string;

  // 3) Build InvoiceDoc
  const today = new Date().toISOString().slice(0, 10);
  const doc: InvoiceDoc = {
    number: invoiceNumber,
    date: today,
    orderId: order.id,
    seller: {
      name: seller?.business_legal_name ?? seller?.store_name ?? 'Venditore',
      vatNumber: seller?.business_vat_number ?? null,
      address: seller?.business_address ?? '',
      city: seller?.business_city ?? '',
      zip: seller?.business_zip ?? '',
      country: 'IT',
      pec: seller?.business_pec ?? null,
      sdiCode: seller?.business_sdi ?? null,
    },
    buyer: {
      name: order.delivery_full_name ?? 'Cliente privato',
      address: order.delivery_address ?? '',
      city: order.delivery_city ?? '',
      zip: order.delivery_zip ?? '',
      country: 'IT',
      sdiCode: '0000000', // privato
      email: buyerEmail,
    },
    lines: (items ?? []).map((it: any) => ({
      description: it.products?.name ?? 'Prodotto',
      quantity: it.quantity,
      unitPrice: Number(it.unit_price),
      vatRate: 22, // semplificazione MVP: aliquota standard IT
    })),
    paymentMethod: (order.payment_method as any) ?? 'card',
  };

  // 4) PDF
  let pdfBytes: Buffer;
  try {
    pdfBytes = await renderInvoicePdf(doc);
  } catch (e: any) {
    logger.error('[invoice] pdf render failed', e);
    return NextResponse.json({ error: 'Errore generazione PDF' }, { status: 500 });
  }

  // Upload PDF in bucket privato "invoices"
  const path = `${order.seller_id}/${order.id}.pdf`;
  const { error: upErr } = await admin.storage
    .from('invoices')
    .upload(path, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (upErr) {
    logger.warn('[invoice] storage upload failed (bucket "invoices" esiste?):', upErr.message);
  }
  const { data: signed } = await admin.storage
    .from('invoices')
    .createSignedUrl(path, 60 * 60 * 24 * 30); // 30 giorni
  const pdfUrl = signed?.signedUrl ?? null;

  // 5) Invia all'SDI
  const provider = getInvoiceProvider();
  const sdiResult = await provider.send(doc);

  // Salva su orders
  await admin
    .from('orders')
    .update({
      invoice_number: invoiceNumber,
      invoice_pdf_url: pdfUrl,
      invoice_sdi_status: sdiResult.ok ? sdiResult.status : 'PENDING',
      invoice_sdi_id: sdiResult.ok ? (sdiResult.sdiId ?? null) : null,
      invoice_issued_at: new Date().toISOString(),
    })
    .eq('id', order.id);

  return NextResponse.json({
    invoice_number: invoiceNumber,
    pdf_url: pdfUrl,
    sdi: sdiResult,
  }, { status: 200 });
}
