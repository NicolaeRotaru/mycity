import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Le coordinate della consegna usate per calcolare la spedizione devono venire
 * dal server, non dal browser.
 *
 * Il commento in cima a `lib/shipping.ts` dichiarava: «il server passa SEMPRE il
 * subtotale e le coordinate ricalcolati dal DB, mai valori provenienti dal
 * client». Per il negozio era vero (letto da profiles), per la consegna no:
 * arrivavano da `body.delivery.lat/lng`, cioè dal browser. E il prezzo della
 * consegna dipende dalla distanza: chi manda coordinate a due passi dal negozio
 * paga meno di quanto costa portargli la spesa a casa.
 *
 * Qui si cercano le coordinate fra gli indirizzi SALVATI della persona,
 * confrontando via, città e CAP. Se l'indirizzo di consegna è uno dei suoi, le
 * coordinate sono quelle registrate nel database. Se non lo è, non si usa nulla:
 * si ricade sulla tariffa fissa, che non è manovrabile da fuori.
 */

export type IndirizzoConsegna = {
  address: string;
  city: string;
  zip: string;
};

function normalizza(v: string | null | undefined): string {
  return (v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // accenti
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Coordinate affidabili per l'indirizzo di consegna, o `null` se non se ne
 * trovano fra quelle salvate dalla persona.
 */
export async function coordinateDaIndirizziSalvati(
  client: Pick<SupabaseClient, 'from'>,
  userId: string,
  consegna: IndirizzoConsegna,
): Promise<{ lat: number; lng: number } | null> {
  const { data } = await client
    .from('user_addresses')
    .select('address, city, zip, lat, lng')
    .eq('user_id', userId);

  if (!data || data.length === 0) return null;

  const cercato = {
    address: normalizza(consegna.address),
    city: normalizza(consegna.city),
    zip: normalizza(consegna.zip),
  };

  for (const riga of data as Array<{
    address: string | null; city: string | null; zip: string | null;
    lat: number | null; lng: number | null;
  }>) {
    if (riga.lat == null || riga.lng == null) continue;
    if (
      normalizza(riga.address) === cercato.address &&
      normalizza(riga.city) === cercato.city &&
      normalizza(riga.zip) === cercato.zip
    ) {
      return { lat: riga.lat, lng: riga.lng };
    }
  }
  return null;
}
