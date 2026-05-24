import { env } from '@/lib/env';
import type { KycProvider, KycSubject, KycDocs, KycCheckResult } from './types';

/**
 * Mock provider: ritorna APPROVED se sono presenti idFrontUrl e
 * cognome (per simulare validazione minima). Utile in dev e CI.
 */
class MockKycProvider implements KycProvider {
  async startCheck(subject: KycSubject, docs: KycDocs): Promise<KycCheckResult> {
    if (!docs.idFrontUrl) return { ok: false, error: 'Documento mancante' };
    if (!subject.lastName) return { ok: false, error: 'Cognome mancante' };
    return { ok: true, status: 'APPROVED', providerCheckId: `mock_${Date.now()}` };
  }

  async verifyVatNumber(vat: string) {
    // Validazione formato + length (P.IVA italiana 11 cifre).
    const cleaned = vat.replace(/\s+/g, '').toUpperCase();
    const it = /^IT?\d{11}$/.test(cleaned);
    return { valid: it, name: it ? 'Mock company' : undefined };
  }
}

/**
 * Onfido provider (https://documentation.onfido.com/).
 *
 * Flusso reale:
 *  1) POST /applicants per creare applicant (nome, cognome, dob, email)
 *  2) POST /sdk_token per generare token frontend SDK
 *  3) Lato client SDK Onfido carica documenti + selfie + face video
 *  4) POST /checks { applicant_id, report_names: ['document', 'facial_similarity_photo'] }
 *  5) Webhook check.completed -> APPROVED/REJECTED
 *
 * Qui implementiamo i pezzi server-side base (applicant + check).
 * Per la parte UI servirebbe l'SDK frontend Onfido.
 */
class OnfidoProvider implements KycProvider {
  constructor(private apiKey: string) {}

  async startCheck(subject: KycSubject, docs: KycDocs): Promise<KycCheckResult> {
    try {
      const applicantRes = await fetch('https://api.eu.onfido.com/v3.6/applicants', {
        method: 'POST',
        headers: {
          'Authorization': `Token token=${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          first_name: subject.firstName ?? 'Unknown',
          last_name: subject.lastName ?? 'Unknown',
          email: subject.email ?? undefined,
          dob: subject.birthDate ?? undefined,
        }),
      });
      const applicant = await applicantRes.json();
      if (!applicantRes.ok) {
        return { ok: false, error: applicant?.error?.message ?? `HTTP ${applicantRes.status}` };
      }

      const checkRes = await fetch('https://api.eu.onfido.com/v3.6/checks', {
        method: 'POST',
        headers: {
          'Authorization': `Token token=${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          applicant_id: applicant.id,
          report_names: ['document', 'facial_similarity_photo'],
          // I documenti vanno caricati prima via POST /documents con file binari.
          // In MVP qui assumiamo che il caricamento sia gia' avvenuto via SDK frontend.
        }),
      });
      const check = await checkRes.json();
      if (!checkRes.ok) {
        return { ok: false, error: check?.error?.message ?? `HTTP ${checkRes.status}` };
      }
      return { ok: true, status: 'PENDING', providerCheckId: check.id };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'network' };
    }
  }

  async verifyVatNumber(vat: string) {
    // Onfido non fa VAT lookup; usa VIES come fallback.
    return viesVatLookup(vat);
  }
}

/**
 * VIES (VAT Information Exchange System) — endpoint UE pubblico per
 * verificare validita' e nome di una P.IVA. Restituisce { valid, name }.
 */
async function viesVatLookup(vat: string): Promise<{ valid: boolean; name?: string }> {
  const cleaned = vat.replace(/\s+/g, '').toUpperCase();
  // Estrai country code (2 lettere) e numero
  const m = cleaned.match(/^([A-Z]{2})(\d+)$/);
  if (!m) return { valid: false };
  const [, country, number] = m;

  try {
    const r = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${country}/vat/${number}`,
      { cache: 'no-store' },
    );
    if (!r.ok) return { valid: false };
    const data = await r.json();
    return { valid: !!data.isValid, name: data.name ?? undefined };
  } catch {
    return { valid: false };
  }
}

export function getKycProvider(): KycProvider {
  const which = env.kycProvider();
  const key = env.kycApiKey();
  if (which === 'onfido' && key) return new OnfidoProvider(key);
  // Jumio/Veriff: stub futuro, fallback al mock.
  return new MockKycProvider();
}

export { viesVatLookup };
