/**
 * QUALI VALORI IL REGISTRO ATTIVITA' PUO' COPIARSI, E QUALI NO.
 *
 * Ogni modifica a una riga di `profiles`, `orders`, `gift_cards` e altre nove
 * tabelle finisce in `activity_events.metadata.changed`, con il valore VECCHIO e
 * quello NUOVO di ogni colonna cambiata. E' la traccia che serve a capire chi ha
 * fatto cosa. Ma una traccia che si porta dietro i valori e' anche una seconda
 * copia dei dati personali, in una tabella che non e' quella dichiarata per
 * contenerli, e che dura quattordici mesi — anche quando l'account e' stato
 * cancellato: il profilo sparisce, la copia dentro il diff no.
 *
 * ── IL DIFETTO E LA SUA CAUSA ──
 *
 * La regola era: «oscura la colonna se il suo NOME somiglia a una di queste
 * parole». Una lista scritta a mano, cresciuta a strappi. Aveva `full_name`,
 * `nome`, `cognome` — e non aveva `first_name` ne' `last_name`. Cosi'
 * `profiles.legal_first_name` e `profiles.legal_last_name` — l'identita' legale
 * usata per la verifica di negozianti e fattorini — finivano nel registro in
 * chiaro. Stessa sorte per `gift_cards.recipient_name`, per `gift_cards.message`
 * (il testo privato che una persona scrive a un'altra) e per
 * `rider_haccp_url` / `rider_insurance_url`.
 *
 * Il difetto vero non e' che mancavano tre parole: e' il VERSO della regola. Con
 * un elenco di cose da nascondere, ogni colonna nuova nasce in chiaro, e non se
 * ne accorge nessuno finche' qualcuno non va a guardare. Allungare l'elenco
 * ripara il caso di oggi e lascia in piedi il modo in cui si e' rotto.
 *
 * ── LA REGOLA, ROVESCIATA ──
 *
 * Adesso il diff porta il valore SOLO delle colonne che stanno in un elenco
 * chiuso: stati, prezzi, quantita', bandierine, date, identificativi. Tutto il
 * resto esce `***`. La chiave resta visibile — si vede sempre CHE COSA e'
 * cambiato — sparisce il valore.
 *
 * Cosi' una colonna nuova nasce oscurata: il caso peggiore diventa «abbiamo
 * nascosto un dato che potevamo mostrare», che si ripara quando serve, invece
 * di «abbiamo copiato per quattordici mesi il cognome di un fattorino», che non
 * si ripara affatto.
 *
 * ── PERCHE' LE DUE REGOLE E NON UNA ──
 *
 * L'elenco chiuso e' fatto di FORME (`*_id`, `*_at`, `*_cents`). Una forma puo'
 * far passare per sbaglio un dato personale: `tax_id` finisce in `*_id`,
 * `birth_at` finisce in `*_at`. Per questo la vecchia lista di parole resta, e
 * fa da veto: se una chiave passa per la forma ma somiglia a un dato personale,
 * si oscura lo stesso.
 *
 * Le due espressioni stanno qui ED E' DA QUI CHE SI COPIANO nella migrazione
 * (`migrations/155_…`). La prova
 * `tests/unit/il-registro-attivita-non-copia-il-cognome-legale.test.ts` le
 * rilegge dal file SQL VERO, le esegue su un elenco di colonne reali e fallisce
 * se le due copie divergono: e' quello che impedisce alla regola nel database di
 * allontanarsi da questa.
 */

/**
 * Le colonne il cui valore serve davvero in un registro, e che non dicono
 * niente di una persona. Ancorata (`^…$`): il confronto e' esatto, non per
 * somiglianza — la somiglianza e' proprio la cosa che ci ha fatto male.
 */
export const COLONNE_PERMESSE_NEL_DIFF =
  '^(id|status|state|stato|role|ruolo|type|tipo|kind|slug|locale|lang|currency|valuta|'
  + 'category|categoria|source|channel|canale|method|provider|version|position|sort_order|'
  + 'priority|step|quantity|qty|qta|amount|price|prezzo|total|subtotal|discount|sconto|'
  + 'percent|percentuale|rating|stars|score|active|approved|enabled|visible|published|'
  + 'stock|sku|weight|unit|size|color|colore|'
  + 'archived|deleted|expired|is_[a-z0-9_]+|has_[a-z0-9_]+|can_[a-z0-9_]+|'
  + '[a-z0-9_]*_id|[a-z0-9_]*_at|[a-z0-9_]*_cents|[a-z0-9_]*_count|[a-z0-9_]*_qty|'
  + '[a-z0-9_]*_status|[a-z0-9_]*_state)$';

/**
 * Il veto. E' la lista storica delle migrazioni 115 e 118, tenuta parola per
 * parola (piu' i nomi che le mancavano), e serve per le chiavi che passerebbero
 * per la forma: `tax_id`, `birth_at`, `email_id`.
 *
 * `lat` e `lng` sono ancorate ai confini di parola: senza ancora si portavano
 * dietro `cancelled_at` («cancel-LAT-ed») e ogni `*_related_id`, cioe' proprio
 * le date e i legami che a un registro servono.
 */
export const COLONNE_SEMPRE_SENSIBILI =
  '(password|token|secret|iban|bic|swift|card|cvv|fiscal|tax|vat|piva|birth|resid|phone|'
  + 'mobile|tel|address|indirizz|email|mail|sdi|pec|kyc|selfie|licen|document|doc_|'
  + 'signature|firma|(^|_)(lat|latitud|lng|longitud)($|_)|zip|cap$|full_name|nome|cognome|'
  + 'note|first_name|last_name|recipient|message|messaggio|haccp|insurance|assicur|photo)';

/** La regola completa: il valore si oscura? */
export function valoreDaOscurare(
  chiave: string,
  permesse: RegExp = new RegExp(COLONNE_PERMESSE_NEL_DIFF, 'i'),
  sempreSensibili: RegExp = new RegExp(COLONNE_SEMPRE_SENSIBILI, 'i'),
): boolean {
  return !permesse.test(chiave) || sempreSensibili.test(chiave);
}

/**
 * Le colonne personali VERE, prese dallo schema (le migrazioni fra parentesi).
 * Sono l'elenco che la prova percorre una per una: finche' questo elenco esiste,
 * «nessuno ha mai verificato che il diff non le contenga» non e' piu' vero.
 */
export const COLONNE_PERSONALI: readonly string[] = [
  // profiles — identita' legale per la verifica di negozianti e fattorini (021)
  'legal_first_name',
  'legal_last_name',
  'legal_birth_date',
  'legal_fiscal_code',
  'full_name',
  'phone',
  'address',
  'billing_address',
  'iban',
  'business_iban',
  // profiles — le prove caricate dai fattorini (024)
  'rider_license_url',
  'rider_insurance_url',
  'rider_haccp_url',
  'kyc_doc_url',
  'kyc_selfie_url',
  // gift_cards — dati di una persona che con noi non ha nessun rapporto (030)
  'recipient_name',
  'recipient_email',
  'message',
  // ordini, recensioni, chat
  'delivery_address',
  'delivery_notes',
  'customer_note',
  'comment',
  'photo_urls',
  'body',
  'ip',
  'user_agent',
];

/**
 * Le colonne il cui valore un registro DEVE poter mostrare. Se una regola le
 * oscurasse, il registro diventerebbe una fila di `***` e non servirebbe piu' a
 * niente: e' l'altro modo di sbagliare, e va tenuto d'occhio quanto il primo.
 */
export const COLONNE_DA_MOSTRARE: readonly string[] = [
  'status',
  'is_approved',
  'price',
  'price_cents',
  'total_cents',
  'quantity',
  'stock',
  'role',
  'seller_id',
  'order_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'cancelled_at',
  'remitted_at',
  'approval_status',
  'payment_status',
];
