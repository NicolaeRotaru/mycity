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
 *
 * Aruba espone API REST autenticate via OAuth2 client credentials.
 * Endpoint principale per upload XML SDI: /sign-and-send (firma + invio).
 *
 * IMPORTANTE: Aruba si aspetta XML formato FatturaPA 1.2.2 (XSD ufficiale).
 * Qui costruiamo XML minimale per fatture semplificate (B2B con P.IVA).
 * Per fatture complete (B2C con TD24, ritenute, casse previdenziali, ecc.)
 * occorre estendere lo schema XML.
 *
 * Esperti consultati:
 * - Tax Compliance: "XML FatturaPA non bypassa validazione SDI. Errori XSD
 *   = invio rifiutato. In prod testa SEMPRE con ambiente sandbox Aruba."
 * - Senior Backend: "Token OAuth scade ogni 1h. Re-fetch on 401."
 */
class ArubaProvider implements InvoiceProvider {
  private apiKey: string;
  private apiSecret: string;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(apiKey: string, apiSecret = '') {
    this.apiKey = apiKey;
    // Aruba richiede client_id + client_secret. Convenzione: API_KEY = "id:secret"
    if (!apiSecret && apiKey.includes(':')) {
      const [id, sec] = apiKey.split(':');
      this.apiKey = id;
      this.apiSecret = sec;
    } else {
      this.apiSecret = apiSecret;
    }
  }

  private async getToken(): Promise<string | null> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }
    try {
      const r = await fetch('https://auth.fatturazioneelettronica.aruba.it/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          username: this.apiKey,
          password: this.apiSecret,
        }),
      });
      if (!r.ok) return null;
      const data = await r.json() as { access_token?: string; expires_in?: number };
      if (!data.access_token) return null;
      this.tokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      };
      return data.access_token;
    } catch {
      return null;
    }
  }

  private buildFatturaPaXml(doc: InvoiceDoc): string {
    // XML FatturaPA 1.2.2 minimale (B2B con P.IVA).
    // Per pieno schema: https://www.fatturapa.gov.it/it/norme-e-regole/formato/
    const lines = doc.lines.map((l, i) => `
      <DettaglioLinee>
        <NumeroLinea>${i + 1}</NumeroLinea>
        <Descrizione>${this.escapeXml(l.description)}</Descrizione>
        <Quantita>${l.quantity.toFixed(2)}</Quantita>
        <PrezzoUnitario>${l.unitPrice.toFixed(2)}</PrezzoUnitario>
        <PrezzoTotale>${(l.unitPrice * l.quantity).toFixed(2)}</PrezzoTotale>
        <AliquotaIVA>${l.vatRate.toFixed(2)}</AliquotaIVA>
      </DettaglioLinee>`).join('');

    const totale = doc.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

    return `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" versione="FPR12">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>${this.escapeXml(doc.seller.vatNumber ?? '00000000000')}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>${doc.number.replace(/\//g, '')}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>${this.escapeXml(doc.buyer.sdiCode ?? '0000000')}</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>${this.escapeXml(doc.seller.vatNumber ?? '')}</IdCodice>
        </IdFiscaleIVA>
        <Anagrafica><Denominazione>${this.escapeXml(doc.seller.name)}</Denominazione></Anagrafica>
        <RegimeFiscale>RF01</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${this.escapeXml(doc.seller.address)}</Indirizzo>
        <CAP>${this.escapeXml(doc.seller.zip)}</CAP>
        <Comune>${this.escapeXml(doc.seller.city)}</Comune>
        <Nazione>IT</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <Anagrafica><Denominazione>${this.escapeXml(doc.buyer.name)}</Denominazione></Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${this.escapeXml(doc.buyer.address)}</Indirizzo>
        <CAP>${this.escapeXml(doc.buyer.zip)}</CAP>
        <Comune>${this.escapeXml(doc.buyer.city)}</Comune>
        <Nazione>IT</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>${doc.date}</Data>
        <Numero>${doc.number}</Numero>
        <ImportoTotaleDocumento>${totale.toFixed(2)}</ImportoTotaleDocumento>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>${lines}
    </DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;
  }

  private escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  async send(doc: InvoiceDoc): Promise<InvoiceProviderResult> {
    const token = await this.getToken();
    if (!token) return { ok: false, error: 'Aruba auth failed (credentials?)' };

    try {
      const xml = this.buildFatturaPaXml(doc);
      const r = await fetch('https://ws.fatturazioneelettronica.aruba.it/services/invoice/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/xml',
        },
        body: xml,
      });
      if (!r.ok) {
        const errText = await r.text();
        return { ok: false, error: `Aruba HTTP ${r.status}: ${errText.slice(0, 200)}` };
      }
      const data = await r.json() as { uploadFileName?: string; transactionID?: string };
      return { ok: true, sdiId: data.transactionID ?? data.uploadFileName ?? '', status: 'SENT' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'network' };
    }
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
