/**
 * Verifica identita' (KYC) per seller e rider.
 *
 * Il pattern e' provider-based: caricamento documento + selfie -> il
 * provider esterno (Onfido/Jumio/Veriff) fa OCR, face match, anti-spoof,
 * check liste sanzioni; restituisce PENDING e poi un webhook con
 * APPROVED/REJECTED. In dev usiamo il provider mock che approva subito.
 */

export type KycSubject = {
  userId: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fiscalCode?: string | null;
  birthDate?: string | null;       // YYYY-MM-DD
};

export type KycDocs = {
  idFrontUrl: string;             // URL signed Supabase storage
  idBackUrl?: string | null;
  selfieUrl?: string | null;
};

export type KycCheckResult =
  | { ok: true; status: 'PENDING' | 'APPROVED'; providerCheckId: string }
  | { ok: false; error: string };

export interface KycProvider {
  /**
   * `checkPrecedente`: l'id del controllo salvato nel profilo (`kyc_provider_check_id`). Il
   * fornitore che tiene una scheda per persona la riprende invece di crearne un'altra (R01-015).
   */
  startCheck(subject: KycSubject, docs: KycDocs, checkPrecedente?: string | null): Promise<KycCheckResult>;
  /**
   * Toglie dal fornitore la scheda (dati personali, documenti, selfie) del controllo `checkId`.
   * Solo i fornitori che tengono dati fuori da noi ce l'hanno. Non lancia: 'fallita' vuol dire
   * che la scheda può essere ancora là (R01-015).
   */
  cancellaScheda?(checkId: string | null | undefined): Promise<'tolta' | 'niente' | 'fallita'>;
  /**
   * Verifica una P.IVA su Agenzia Entrate / VIES per controllo formale +
   * esistenza. Restituisce true se attiva.
   */
  verifyVatNumber?(vat: string): Promise<{ valid: boolean; name?: string }>;
}
