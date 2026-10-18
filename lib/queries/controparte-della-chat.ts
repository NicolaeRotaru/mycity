import { fetchSellerPublicMap, type LettoreVista } from '@/lib/queries/seller-public-profiles';

/**
 * IN CHAT, IL CLIENTE VEDE L'INSEGNA DEL NEGOZIO LETTA DALLA VETRINA PUBBLICA.
 *
 * 18/10/2026 (seconda ondata, squadra ordini) — L'elenco dei messaggi e la
 * conversazione prendevano il nome della controparte da `profiles`, agganciata
 * alla conversazione (`seller:profiles!conversations_seller_id_fkey`). Per il
 * cliente la controparte e' il negozio, e la sua insegna si leggeva solo grazie
 * alla regola «chiunque legge i negozi approvati», che le migrazioni 110, 112 e
 * 161 tolgono. Dopo, il cliente avrebbe letto «Utente» al posto del negozio a cui
 * sta scrivendo.
 *
 * L'insegna adesso arriva dalla vista `seller_public_profiles`, una domanda sola
 * per tutto l'elenco. Il resto dell'aggancio resta com'era: il nome del cliente
 * visto dal negozio e quello dell'account Assistenza sono un altro lavoro, con la
 * sua scheda, e non cambiano qui.
 */

/** Attacca a ogni conversazione l'insegna del suo negozio, o `null` se la vetrina non lo mostra. */
export async function conInsegnaDelNegozio<T extends { seller_id: string }>(
  supa: LettoreVista,
  conversazioni: T[],
): Promise<Array<T & { insegna: string | null }>> {
  if (conversazioni.length === 0) return [];
  const negozi = await fetchSellerPublicMap(supa, conversazioni.map((c) => c.seller_id), 'id, store_name');
  return conversazioni.map((c) => ({ ...c, insegna: negozi.get(c.seller_id)?.store_name ?? null }));
}

type Persona = { full_name: string | null; store_name: string | null } | null;

/**
 * Il nome di chi sta dall'altra parte, come lo legge chi guarda.
 *
 * Il cliente vede l'insegna del negozio (dalla vetrina, poi il ripiego di prima);
 * il negozio vede il nome del cliente, come prima.
 */
export function nomeDellaControparte(
  conversazione: { buyer_id: string; buyer: Persona; seller: Persona; insegna: string | null },
  userId: string | null,
): string {
  const iAmBuyer = conversazione.buyer_id === userId;
  if (iAmBuyer) {
    const negozio = conversazione.seller;
    return conversazione.insegna ?? negozio?.store_name ?? negozio?.full_name ?? 'Utente';
  }
  return conversazione.buyer?.full_name ?? 'Utente';
}
