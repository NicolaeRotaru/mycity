import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { leggiSchedaSalvata, type SchedaCliente } from './scheda-cliente';
import { leggiSchedaEPagellaAperte, schedaEPagellaAperte, schedaPerIlSito, statoCheApre } from './scheda-dopo-abbonamento';
import { analisiPerLaFascia } from './rapporto';
import { ABBONAMENTI, type Abbonamento } from './preventivo';
import { abbonamentoIncluso } from './abbonamento-di-sdg';

/**
 * LA SCHEDA COME LA VEDE IL NEGOZIO — una strada sola (26/11/2026, revisione di sicurezza di mycity#336).
 *
 * La usano la dashboard (/api/seller/scheda-cliente) e «Scarica i miei dati» (/api/account/export). Prima l'export
 * leggeva la riga intera con `select('*')`: un negozio in prova, o col Base, riceveva il rapporto di tutte le fasce.
 * Qui la scheda passa dalle stesse regole della pagina:
 *  · finché il negozio non ha pagato, solo l'analisi con l'assaggio (`schedaPerIlSito`);
 *  · dopo, solo le parti dell'abbonamento attivo (`analisiPerLaFascia`); senza un abbonamento attivo vale il Base.
 * Il rapporto è un dato che produciamo noi, non un dato che il titolare ci ha dato: se l'export debba
 * contenerlo tutto (art. 20 GDPR) è una domanda aperta per Nicola, scritta nella PR.
 */
export type SchedaDelNegozio = { scheda: SchedaCliente | null; aperta: boolean; fascia: Abbonamento | null; errore: string | null };

/** La fascia dell'abbonamento attivo (active o past_due), dalle righe di `abbonamenti_servizi`; `null` se non c'è. */
export function fasciaAttiva(righe: ReadonlyArray<{ fascia?: unknown; stato?: unknown }> | null | undefined): Abbonamento | null {
  const riga = (righe ?? []).find((r) => r.stato === 'active' || r.stato === 'past_due');
  return riga && (ABBONAMENTI as readonly unknown[]).includes(riga.fascia) ? (riga.fascia as Abbonamento) : null;
}

/**
 * Le stesse regole, senza rete: dalla scheda salvata, da `visibile_senza_abbonamento` e dalle righe degli abbonamenti.
 * La usa l'export, che quelle righe le ha già lette.
 */
export function schedaComeLaVedeIlNegozio(
  grezza: unknown,
  d: { visibileSenzaAbbonamento: unknown; abbonamenti: ReadonlyArray<{ fascia?: unknown; stato?: unknown; origine?: unknown }> | null | undefined },
): SchedaCliente | null {
  const aperta = schedaEPagellaAperte({ visibileSenzaAbbonamento: d.visibileSenzaAbbonamento, statiAbbonamenti: (d.abbonamenti ?? []).map(statoCheApre) });
  const intera = schedaPerIlSito(leggiSchedaSalvata(grezza), aperta);
  return intera && aperta ? { ...intera, analisi: analisiPerLaFascia(intera.analisi, fasciaAttiva(d.abbonamenti)) } : intera;
}

export async function schedaPerIlNegozio(admin: SupabaseClient, idAttivita: string): Promise<SchedaDelNegozio> {
  const [letta, aperta, abbonamenti] = await Promise.all([
    admin.from('schede_clienti').select('scheda').eq('id_attivita', idAttivita).limit(1).maybeSingle(),
    leggiSchedaEPagellaAperte(admin, idAttivita),
    admin.from('abbonamenti_servizi').select('fascia, stato').eq('seller_id', idAttivita).order('creato_il', { ascending: false }).limit(20),
  ]);
  if (letta.error) logger.warn('[scheda-del-negozio] scheda non letta', { idAttivita, message: letta.error.message });
  const intera = letta.error ? null : schedaPerIlSito(leggiSchedaSalvata((letta.data as { scheda?: unknown } | null)?.scheda), aperta);
  // 28/11/2026 — SDG ha il Premium incluso senza righe in tabella (lib/agenzia/abbonamento-di-sdg.ts): dal collaudo.
  const fascia = abbonamentoIncluso(idAttivita)?.fascia
    ?? (abbonamenti.error ? null : fasciaAttiva(abbonamenti.data as Array<{ fascia?: unknown; stato?: unknown }> | null));
  const scheda = intera && aperta ? { ...intera, analisi: analisiPerLaFascia(intera.analisi, fascia) } : intera;
  return { scheda, aperta, fascia, errore: letta.error ? letta.error.message : null };
}
