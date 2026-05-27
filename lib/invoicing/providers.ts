import { env } from '@/lib/env';
import type { InvoiceDoc, InvoiceProvider, InvoiceProviderResult } from './types';

/**
 * Provider mock: utile in dev e CI. Non manda nulla, ritorna SENT.
 */
class MockProvider implements InvoiceProvider {
  async send(doc: InvoiceDoc): Promise<InvoiceProviderResult> {
    console.log('[invoice:mock] would send', { number: doc.number, order: doc.orderId });
    return { ok: true, sdiId: `mock_${Date.now()}`, status: 'SENT' };
  }
}

/**
 * Provider FattureInCloud (https://developers.fattureincloud.it/).
 *
 * Esempio reale: la creazione fattura richiede prima un POST a
 * /c/{companyId}/issued_documents con type=invoice; la trasmissione
 * SDI avviene impostando e_invoice=true e fornendo i dati XML.
 *
 * In MVP qui c'e' lo scheletro: chiama l'endpoint API e parsea la
 * risposta. Adatta il payload alla doc reale FattureInCloud prima
 * di andare in produzione.
 */
class FattureInCloudProvider implements InvoiceProvider {
  constructor(private apiKey: string, private companyId: string) {}

  async send(doc: InvoiceDoc): Promise<InvoiceProviderResult> {
    try {
      const payload = {
        data: {
          type: 'invoice',
          number: parseInt(doc.number.split('/').pop() ?? '0', 10) || undefined,
          numeration: doc.number.split('/')[0],
          date: doc.date,
          entity: {
            name: doc.buyer.name,
            vat_number: doc.buyer.vatNumber ?? undefined,
            tax_code: doc.buyer.fiscalCode ?? undefined,
            address_street: doc.buyer.address,
            address_postal_code: doc.buyer.zip,
            address_city: doc.buyer.city,
            country: doc.buyer.country,
            ei_code: doc.buyer.sdiCode ?? '0000000',
            certified_email: doc.buyer.pec ?? undefined,
          },
          items_list: doc.lines.map((l) => ({
            name: l.description,
            qty: l.quantity,
            net_price: l.unitPrice,
            vat: { value: l.vatRate },
          })),
          payment_method: { name: doc.paymentMethod === 'cod' ? 'Contanti alla consegna' : 'Carta di credito' },
          e_invoice: true,
        },
      };
      const r = await fetch(`https://api-v2.fattureincloud.it/c/${this.companyId}/issued_documents`, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) {
        return { ok: false, error: data?.error?.message ?? `HTTP ${r.status}` };
      }
      return { ok: true, sdiId: String(data?.data?.id ?? ''), status: 'SENT' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'network' };
    }
  }
}

/**
 * Provider Aruba (https://www.aruba.it/fatturazione-elettronica.aspx)
 * scheletro analogo a sopra. Richiede SOAP/REST credentials separati.
 */
class ArubaProvider implements InvoiceProvider {
  constructor(private _apiKey: string) {}
  async send(_doc: InvoiceDoc): Promise<InvoiceProviderResult> {
    return { ok: false, error: 'Aruba provider non ancora implementato. Configura SDI_PROVIDER=fattureincloud.' };
  }
}

/**
 * Factory: ritorna il provider configurato. Default mock per dev.
 */
export function getInvoiceProvider(): InvoiceProvider {
  const which = env.sdiProvider();
  const key = env.sdiApiKey();
  const companyId = env.sdiCompanyId();

  if (which === 'fattureincloud' && key && companyId) {
    return new FattureInCloudProvider(key, companyId);
  }
  if (which === 'aruba' && key) {
    return new ArubaProvider(key);
  }
  return new MockProvider();
}
