import { env } from '@/lib/env';
import type { KycProvider, KycSubject, KycDocs, KycCheckResult } from './types';

/** Timeout per le fetch verso provider esterni KYC/VIES (audit 🟠-14). */
const KYC_FETCH_TIMEOUT_MS = 10_000;

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
const ONFIDO = 'https://api.eu.onfido.com/v3.6';

class OnfidoProvider implements KycProvider {
  constructor(private apiKey: string) {}

  private intestazioni(json = true): Record<string, string> {
    return json
      ? { Authorization: `Token token=${this.apiKey}`, 'Content-Type': 'application/json' }
      : { Authorization: `Token token=${this.apiKey}` };
  }

  /**
   * Carica un file (dall'URL firmato del nostro archivio) su Onfido.
   * `percorso` e' /documents (documento d'identita') o /live_photos (selfie).
   */
  private async carica(
    percorso: '/documents' | '/live_photos',
    applicantId: string,
    url: string,
    campi: Record<string, string> = {},
  ): Promise<string | null> {
    const file = await fetch(url, { signal: AbortSignal.timeout(KYC_FETCH_TIMEOUT_MS) });
    if (!file.ok) return `file non leggibile (HTTP ${file.status})`;
    const corpo = new FormData();
    corpo.append('applicant_id', applicantId);
    for (const [k, v] of Object.entries(campi)) corpo.append(k, v);
    corpo.append('file', await file.blob(), percorso === '/live_photos' ? 'selfie.jpg' : 'documento.jpg');
    const res = await fetch(`${ONFIDO}${percorso}`, {
      method: 'POST',
      headers: this.intestazioni(false),
      body: corpo,
      signal: AbortSignal.timeout(KYC_FETCH_TIMEOUT_MS), // 🟠-14
    });
    if (res.ok) return null;
    const errore = await res.json().catch(() => null);
    return errore?.error?.message ?? `HTTP ${res.status}`;
  }

  /** Toglie da Onfido la scheda con i dati personali. Non lancia mai. */
  private async togliScheda(applicantId: string): Promise<void> {
    try {
      await fetch(`${ONFIDO}/applicants/${encodeURIComponent(applicantId)}`, {
        method: 'DELETE',
        headers: this.intestazioni(false),
        signal: AbortSignal.timeout(KYC_FETCH_TIMEOUT_MS),
      });
    } catch {
      /* best effort: il registro di start-check dice gia' che la verifica e' fallita */
    }
  }

  /**
   * 12/11/2026 (R04-024) — UNA SCHEDA CON NOME, EMAIL E DATA DI NASCITA PER
   * OGNI TENTATIVO, E NESSUN DOCUMENTO.
   *
   * Si creava la scheda (applicant) e subito il controllo, senza caricare i
   * documenti: il controllo falliva e la scheda restava su Onfido, orfana, a
   * ogni tentativo. Adesso: scheda → documento fronte (e retro) → selfie →
   * controllo; se uno qualunque dei passi dopo la scheda fallisce, la scheda si
   * toglie. (Una verifica gia' in attesa non ne apre un'altra: start-check.)
   */
  async startCheck(subject: KycSubject, docs: KycDocs): Promise<KycCheckResult> {
    let applicantId: string | null = null;
    try {
      const applicantRes = await fetch(`${ONFIDO}/applicants`, {
        method: 'POST',
        headers: this.intestazioni(),
        body: JSON.stringify({
          first_name: subject.firstName ?? 'Unknown',
          last_name: subject.lastName ?? 'Unknown',
          email: subject.email ?? undefined,
          dob: subject.birthDate ?? undefined,
        }),
        // 🟠-14: timeout obbligatorio — un hang upstream non deve bloccare il
        // worker (rate-limit KYC ~5/ora: pochi hang lo esaurirebbero).
        signal: AbortSignal.timeout(KYC_FETCH_TIMEOUT_MS),
      });
      const applicant = await applicantRes.json();
      if (!applicantRes.ok) {
        return { ok: false, error: applicant?.error?.message ?? `HTTP ${applicantRes.status}` };
      }
      applicantId = typeof applicant?.id === 'string' ? applicant.id : null;
      if (!applicantId) return { ok: false, error: 'Onfido: scheda senza id' };

      const passi: Array<[string, () => Promise<string | null>]> = [
        ['documento (fronte)', () => this.carica('/documents', applicantId!, docs.idFrontUrl, { type: 'national_identity_card', side: 'front' })],
      ];
      if (docs.idBackUrl) {
        passi.push(['documento (retro)', () => this.carica('/documents', applicantId!, docs.idBackUrl!, { type: 'national_identity_card', side: 'back' })]);
      }
      if (docs.selfieUrl) passi.push(['selfie', () => this.carica('/live_photos', applicantId!, docs.selfieUrl!)]);
      for (const [nome, passo] of passi) {
        const errore = await passo();
        if (errore) {
          await this.togliScheda(applicantId);
          return { ok: false, error: `Onfido: caricamento ${nome} non riuscito: ${errore}` };
        }
      }

      const checkRes = await fetch(`${ONFIDO}/checks`, {
        method: 'POST',
        headers: this.intestazioni(),
        body: JSON.stringify({
          applicant_id: applicantId,
          report_names: docs.selfieUrl ? ['document', 'facial_similarity_photo'] : ['document'],
        }),
        signal: AbortSignal.timeout(KYC_FETCH_TIMEOUT_MS), // 🟠-14
      });
      const check = await checkRes.json();
      if (!checkRes.ok) {
        await this.togliScheda(applicantId);
        return { ok: false, error: check?.error?.message ?? `HTTP ${checkRes.status}` };
      }
      return { ok: true, status: 'PENDING', providerCheckId: check.id };
    } catch (err) {
      if (applicantId) await this.togliScheda(applicantId);
      return { ok: false, error: err instanceof Error ? err.message : 'network' };
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
async function viesVatLookup(vat: string): Promise<{ valid: boolean; name?: string; irraggiungibile?: boolean }> {
  const cleaned = vat.replace(/\s+/g, '').toUpperCase();
  // 5/11/2026 — La partita IVA salvata dal modulo del negozio è di sole 11 cifre
  // (il prefisso IT viene tolto): senza paese davanti la regola qui sotto non
  // combaciava e ogni negozio risultava «non valido». Undici cifre = Italia.
  const conPaese = /^\d{11}$/.test(cleaned) ? `IT${cleaned}` : cleaned;
  // Estrai country code (2 lettere) e numero
  const m = conPaese.match(/^([A-Z]{2})(\d+)$/);
  if (!m) return { valid: false };
  const [, country, number] = m;

  try {
    const r = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${country}/vat/${number}`,
      { cache: 'no-store', signal: AbortSignal.timeout(KYC_FETCH_TIMEOUT_MS) }, // 🟠-14
    );
    // 5/11/2026 — Un VIES che non risponde non dice che la partita IVA è falsa.
    if (!r.ok) return { valid: false, irraggiungibile: true };
    const data = await r.json();
    // Il servizio risponde 200 anche quando lo Stato membro non è raggiungibile.
    if (typeof data?.userError === 'string' && data.userError !== 'VALID' && data.userError !== 'INVALID') {
      return { valid: false, irraggiungibile: true };
    }
    return { valid: !!data.isValid, name: data.name ?? undefined };
  } catch {
    return { valid: false, irraggiungibile: true };
  }
}

/**
 * Provider fail-closed per la PRODUZIONE quando manca un provider reale: NON
 * auto-approva mai (status 'PENDING' → review manuale admin). Evita che un deploy
 * senza Onfido configurato verifichi automaticamente ogni venditore.
 */
class ManualReviewKycProvider implements KycProvider {
  async startCheck(_subject: KycSubject, docs: KycDocs): Promise<KycCheckResult> {
    if (!docs.idFrontUrl) return { ok: false, error: 'Documento mancante' };
    return { ok: true, status: 'PENDING', providerCheckId: `manual_${Date.now()}` };
  }

  async verifyVatNumber(vat: string) {
    return viesVatLookup(vat);
  }
}

export function getKycProvider(): KycProvider {
  const which = env.kycProvider();
  const key = env.kycApiKey();
  if (which === 'onfido' && key) return new OnfidoProvider(key);
  // PRODUZIONE: nessun provider reale → fail-closed (PENDING, mai APPROVED auto).
  // Il MockKycProvider (APPROVED) resta solo per dev/CI.
  if (process.env.NODE_ENV === 'production') return new ManualReviewKycProvider();
  return new MockKycProvider();
}

export { viesVatLookup };
