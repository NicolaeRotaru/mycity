/**
 * Tipi condivisi per la fatturazione elettronica.
 *
 * Le fatture vengono generate al delivery confermato (o al rilascio
 * payout) per ogni ordine con payment_status = PAID. Il provider SDI
 * concreto e' scelto in env (SDI_PROVIDER).
 */

export type InvoiceLine = {
  description: string;
  quantity: number;
  unitPrice: number;      // euro, IVA esclusa
  vatRate: number;        // percentuale es. 22 / 10 / 4 / 0
};

export type InvoiceParty = {
  name: string;
  vatNumber?: string | null;     // P.IVA (IT12345678901)
  fiscalCode?: string | null;
  address: string;
  city: string;
  zip: string;
  country: string;               // "IT"
  pec?: string | null;
  sdiCode?: string | null;       // 7 chars per B2B o "0000000" per privati
  email?: string | null;
};

export type InvoiceDoc = {
  number: string;                 // es "2026/000123"
  date: string;                   // YYYY-MM-DD
  orderId: string;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  lines: InvoiceLine[];
  paymentMethod: 'card' | 'cod' | 'wire';
  paymentReference?: string | null;
};

export type InvoiceProviderResult =
  | { ok: true; sdiId?: string | null; status: 'SENT' | 'ACCEPTED' | 'PENDING' }
  | { ok: false; error: string };

export interface InvoiceProvider {
  /** Invia la fattura al Sistema di Interscambio. */
  send(doc: InvoiceDoc): Promise<InvoiceProviderResult>;
}
