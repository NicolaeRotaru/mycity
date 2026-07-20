/** Profilo minimo per il bollino «Negozio Verificato MyCity». */
export type StoreTrustProfile = {
  is_approved?: boolean | null;
  stripe_charges_enabled?: boolean | null;
  stripe_payouts_enabled?: boolean | null;
};

/**
 * Un negozio è «Verificato» solo se approvato e può incassare via Stripe Connect.
 * Standard: consegne/trust-safety/2026-07-06-standard-negozio-verificato.md
 */
export function isVerifiedStore(p?: StoreTrustProfile | null): boolean {
  if (!p) return false;
  return !!p.is_approved && !!p.stripe_charges_enabled && !!p.stripe_payouts_enabled;
}
