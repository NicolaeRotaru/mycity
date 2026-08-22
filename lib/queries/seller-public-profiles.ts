import type { SupabaseClient } from '@supabase/supabase-js';
import { conRipiegoSchema, senzaColonne, stessaFormaDi, COLONNE_124_VISTA } from '@/lib/db/migrazione-124';

/** Colonne vetrina esposte da seller_public_profiles (migration 107). */
export type SellerPublicProfile = {
  id: string;
  store_name: string | null;
  store_address?: string | null;
  store_lat?: number | null;
  store_lng?: number | null;
  store_phone?: string | null;
  store_logo?: string | null;
  store_hours?: unknown;
  store_media?: unknown;
  store_description?: string | null;
  is_approved?: boolean;
  stripe_charges_enabled?: boolean | null;
  stripe_payouts_enabled?: boolean | null;
  role?: string | null;
  offers_express?: boolean | null;
  founded_year?: number | null;
  created_at?: string;
};

const PUBLIC_SELLER_SELECT =
  'id, store_name, store_address, store_lat, store_lng, store_phone, store_logo, store_hours, store_media, store_description, is_approved, stripe_charges_enabled, stripe_payouts_enabled, role, offers_express, founded_year, created_at';

/** Carica le vetrine pubbliche per un insieme di seller id (batch). */
export async function fetchSellerPublicMap(
  supabase: SupabaseClient,
  sellerIds: string[],
  select = PUBLIC_SELLER_SELECT,
): Promise<Map<string, SellerPublicProfile>> {
  const unique = [...new Set(sellerIds.filter(Boolean))];
  const map = new Map<string, SellerPublicProfile>();
  if (unique.length === 0) return map;

  // 22/8/2026 — `stripe_charges_enabled` e `stripe_payouts_enabled` arrivano
  // sulla vista con la migrazione 124. Prima di quella, PostgREST rifiuta la
  // select intera: qui l'errore veniva rilanciato, quindi ogni pagina che
  // passa da questo lettore — prodotti, ordini, vetrine — si fermava del tutto
  // invece di mostrarsi senza due bandierine.
  const conBandierine = () =>
    supabase.from('seller_public_profiles').select(select).in('id', unique);
  const { data, error } = await conRipiegoSchema(
    'fetchSellerPublicMap',
    conBandierine,
    () =>
      stessaFormaDi<Awaited<ReturnType<typeof conBandierine>>>(
        supabase
          .from('seller_public_profiles')
          .select(senzaColonne(select, COLONNE_124_VISTA))
          .in('id', unique),
      ),
  );
  if (error) throw error;

  const rows = (data ?? []) as unknown as SellerPublicProfile[];
  for (const row of rows) {
    map.set(row.id, row);
  }
  return map;
}

/** Attacca `profiles` (compat embed) da seller_public_profiles su prodotti/ordini. */
export function attachSellerProfiles<T extends { seller_id?: string | null }>(
  rows: T[],
  sellerMap: Map<string, SellerPublicProfile>,
): Array<T & { profiles: SellerPublicProfile | null }> {
  return rows.map((row) => ({
    ...row,
    profiles: row.seller_id ? sellerMap.get(row.seller_id) ?? null : null,
  }));
}
