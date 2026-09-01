import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * C'È ALMENO UNA PROMOZIONE ATTIVA? — una domanda da sì/no, che costava un conteggio completo.
 *
 * 27/8/2026 (R084) — la striscia in cima al sito chiedeva `count: 'exact'` su `seller_promotions`
 * per poi rispondere `> 0`. `exact` obbliga PostgreSQL a contare TUTTE le righe che passano il
 * filtro invece di fermarsi alla prima, e la striscia sta nella barra di navigazione: quella
 * domanda parte su OGNI pagina del sito, per ogni visitatore, ogni cinque minuti.
 *
 * Basta chiedere una riga sola: se torna, ce n'è almeno una.
 */
export async function ciSonoPromoAttive(supabase: SupabaseClient, adesso = new Date()): Promise<boolean> {
  const oraIso = adesso.toISOString();
  const { data } = await supabase
    .from('seller_promotions')
    .select('id')
    .eq('status', 'active')
    .lte('starts_at', oraIso)
    .gte('ends_at', oraIso)
    .limit(1);
  return (data?.length ?? 0) > 0;
}
