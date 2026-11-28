import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { eConsegnaVeloce } from '@/lib/ordini/consegna-veloce';
import { giornoDiPiacenza } from '@/lib/ordini/fascia-leggibile';
import { FASCE_AMMESSE, MOTIVO_FASCIA_PIENA, ORDINI_PER_FASCIA, finestraDellaFascia } from '@/lib/quando-arriva';

/**
 * 28/11/2026 (R07-009, onda 2) — IL TETTO DEI GIRI PER FASCIA, UNA REGOLA SOLA PER CONTANTI E CARTA.
 *
 * La regola (fatto `consegna.capienza`, `ORDINI_PER_FASCIA`) stava solo nella rotta della carta, che
 * al lancio è spenta (`CARTA_ACCESA`): la rotta dei contanti, l'unica accesa, accettava ordini senza
 * limite nella stessa fascia. Adesso il conteggio sta qui, e lo chiedono tutte e due le rotte prima
 * di scrivere l'ordine. Per i contanti l'ultima parola è del database (migrazione
 * `999s_la_fascia_piena_ferma_i_contanti_anche_insieme.sql`): due invii nello stesso istante
 * leggerebbero tutti e due «c'è posto».
 *
 * Il giorno e la finestra di una fascia si contano dal giorno in cui è stata scelta, come fanno tutti
 * i lettori di `orders.delivery_slot`: «Domani · 16:30–18:00» di un ordine nato ieri è la stessa
 * fascia di «Oggi · 16:30–18:00» scelta adesso. Si contano gli ordini non annullati, a domicilio,
 * per PORTA (cliente + indirizzo): un carrello con più negozi sono più righe ma un giro solo, e un
 * secondo carrello dello stesso cliente allo stesso indirizzo è la stessa porta (`mio`). Allo
 * stesso cliente ma a un altro indirizzo è un altro giro: prima passava come «mio».
 *
 * Una fascia di prima (lib/quando-arriva.ts, `FASCE_DI_PRIMA`) può coprire due fasce di adesso:
 * «Domani · 9:00–12:00» occupa il fattorino sia nella 9:00–11:00 sia nella 11:00–13:00. Si contano
 * le finestre che si SOVRAPPONGONO, non solo quelle con la stessa etichetta.
 */
export type GiornoEFinestra = { giorno: string; da: number; a: number };

/** Il giorno di Piacenza («AAAA-MM-GG») e i minuti di una fascia, contati dal momento in cui è stata scelta. */
export function giornoEFinestra(fascia: string, sceltaIl: string | number | Date): GiornoEFinestra | null {
  const f = finestraDellaFascia(fascia);
  const giornoDellaScelta = giornoDiPiacenza(sceltaIl);
  if (!f || !giornoDellaScelta) return null;
  const giorno = new Date(Date.parse(giornoDellaScelta) + (f.giorno === 'domani' ? 86_400_000 : 0)).toISOString().slice(0, 10);
  return { giorno, da: f.daMinuti, a: f.aMinuti };
}

/** Stesso giorno e finestre che si toccano per almeno un minuto (9-11 e 11-13 no, 9-12 e 11-13 sì). */
export function finestreSiSovrappongono(x: GiornoEFinestra, y: GiornoEFinestra): boolean {
  return x.giorno === y.giorno && x.da < y.a && y.da < x.a;
}

/** Le etichette ammesse (di oggi, di domani e di prima) la cui finestra si sovrappone a quella di `fascia`. */
export function etichetteCheSiSovrappongono(fascia: string): string[] {
  const cercata = finestraDellaFascia(fascia);
  if (!cercata) return [];
  return FASCE_AMMESSE.filter((e) => {
    const f = finestraDellaFascia(e);
    return f !== null && f.daMinuti < cercata.aMinuti && cercata.daMinuti < f.aMinuti;
  });
}

/** Chi riceve: il cliente e l'indirizzo, scritti allo stesso modo anche con maiuscole e spazi diversi. */
export type Porta = { cliente: string; indirizzo?: string | null; cap?: string | null };

function pulito(s: string | null | undefined): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function stessaPorta(o: { user_id?: string | null; delivery_address?: string | null; delivery_zip?: string | null }, porta: Porta): boolean {
  if (o.user_id !== porta.cliente) return false;
  // Un ordine senza indirizzo scritto (o una chiamata che non lo passa) si giudica dal solo cliente.
  if (!pulito(porta.indirizzo) || !pulito(o.delivery_address)) return true;
  return pulito(o.delivery_address) === pulito(porta.indirizzo) && pulito(o.delivery_zip) === pulito(porta.cap);
}

/**
 * Quanti giri ALTRI ha già la fascia e se uno è già di questa porta. `null` = lettura non riuscita
 * (cosa farne lo dice chi chiama).
 */
export async function giriNellaFascia(
  admin: Pick<SupabaseClient, 'from'>,
  fascia: string,
  porta: Porta,
  adesso: Date,
): Promise<{ altri: number; mio: boolean } | null> {
  const cercata = giornoEFinestra(fascia, adesso);
  if (!cercata) return { altri: 0, mio: false };
  try {
    const { data, error, count } = await admin
      .from('orders')
      .select('id, user_id, delivery_slot, created_at, pickup_in_store, delivery_status, delivery_address, delivery_zip', { count: 'exact' })
      .in('delivery_slot', etichetteCheSiSovrappongono(fascia))
      // Una fascia di oggi o di domani: gli ordini che la possono avere sono nati da ieri in poi.
      .gte('created_at', new Date(adesso.getTime() - 48 * 3_600_000).toISOString());
    if (error || !Array.isArray(data) || (typeof count === 'number' && count > data.length)) return null;
    const giri = new Set<string>();
    let mio = false;
    for (const o of data as Array<{
      id?: string; user_id?: string | null; delivery_slot?: string | null; created_at?: string | null;
      pickup_in_store?: boolean | null; delivery_status?: string | null;
      delivery_address?: string | null; delivery_zip?: string | null;
    }>) {
      if (o.delivery_status === 'CANCELED' || o.pickup_in_store || !o.delivery_slot || !o.created_at) continue;
      const g = giornoEFinestra(o.delivery_slot, o.created_at);
      if (!g || !finestreSiSovrappongono(g, cercata)) continue;
      if (stessaPorta(o, porta)) mio = true;
      else giri.add(o.user_id ? `porta:${o.user_id}|${pulito(o.delivery_address)}|${pulito(o.delivery_zip)}` : `riga:${o.id}`);
    }
    return { altri: giri.size, mio };
  } catch {
    return null;
  }
}

/**
 * Il 409 della fascia piena, o `null` se l'ordine passa. La veloce non è una fascia (ha il suo
 * freno, migrazione 840) e il ritiro non chiede un giro. Un conteggio non riuscito non ferma
 * l'ordine (il tetto è morbido: il negozio può rifiutare quelli in più), ma va nel registro come
 * errore: è un controllo dei soldi saltato, non un avviso.
 */
export async function rifiutoPerFasciaPiena(
  admin: Pick<SupabaseClient, 'from'>,
  ordine: { fascia: string | null | undefined; ritiroInNegozio: boolean },
  porta: Porta,
  // N-004 (onda 3) — 'veloce': il freno della veloce che sposta l'ordine non confermato in una fascia.
  dove: 'cod' | 'stripe' | 'veloce',
  adesso: Date = new Date(),
): Promise<string | null> {
  const fascia = ordine.fascia;
  if (ordine.ritiroInNegozio || !fascia || eConsegnaVeloce({ fascia, ritiroInNegozio: false })) return null;
  const giri = await giriNellaFascia(admin, fascia, porta, adesso);
  if (giri === null) {
    logger.error(`[${dove}] giri della fascia non contati: il tetto non è stato controllato`, { userId: porta.cliente });
    return null;
  }
  return !giri.mio && giri.altri + 1 > ORDINI_PER_FASCIA ? MOTIVO_FASCIA_PIENA : null;
}

/**
 * Il «no» del database (migrazione 999s): 23514 col segno `fascia_piena`. È un 409, non un guasto.
 * N-004 (onda 3) — Lo dice anche quando l'ordine ENTRA nella fascia con uno spostamento (il freno della veloce).
 */
export function eLaFasciaPienaDelDatabase(errore: unknown): boolean {
  const e = errore as { code?: unknown; hint?: unknown } | null | undefined;
  return e?.code === '23514' && e?.hint === 'fascia_piena';
}
