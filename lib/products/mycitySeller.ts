/**
 * Negozio "MyCity": seller di sistema a cui l'admin assegna i prodotti importati
 * dai marketplace esterni quando non esiste un negozio reale di destinazione.
 *
 * Lo stesso UUID è creato dal seed `seeds/007_mycity_seller.sql` (profilo +
 * utente auth fittizio, stesso pattern dei rider/seller demo). Costante stabile
 * referenziata da seed e API per evitare lookup fragili per `store_name`.
 */
export const MYCITY_SELLER_ID = '11111111-1111-1111-1111-c1ec0de00001';

export const MYCITY_STORE_NAME = 'MyCity';
