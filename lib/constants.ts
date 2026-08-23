import { EXPRESS_ETA_LABEL } from './delivery';
export const FREE_SHIPPING_THRESHOLD = 30;
export const LOW_STOCK_THRESHOLD = 5;
export const NEW_PRODUCT_DAYS = 14;

/** Spedizione flat di fallback quando le coordinate non sono note (€). */
export const SHIPPING_PER_ORDER = 4.9;

/**
 * 22/8/2026 — Le due tariffe che compongono il prezzo della spedizione a
 * distanza. Stavano scritte dentro il corpo di `prezzoSpedizioneEuro()` in lib/geo.ts,
 * mentre ogni altra grandezza economica del sito vive qui: chi cercava «quanto
 * costa la spedizione» non le trovava, e la pagina di amministrazione delle
 * consegne non poteva mostrarle accanto alle altre.
 */
export const SPEDIZIONE_BASE_EUR = 2.5;
export const SPEDIZIONE_PER_KM_EUR = 1.2;
/**
 * Sconto percentuale per ritiro in negozio.
 *
 * Vale 0 perche' il ritiro in negozio e' MESSO DA PARTE: Nicola, 20/8/2026,
 * «togli il 10% di sconto per ritira in negozio, o mettilo da parte per il
 * momento, perche non ne ho ancora parlato con i negozi di questo». Uno sconto
 * sul prezzo di un negozio non si offre prima di averglielo chiesto.
 */
export const PICKUP_DISCOUNT_PERCENT = 0;

/**
 * Il ritiro in negozio si puo' scegliere in cassa?
 *
 * No, per adesso. Stesso motivo dello sconto qui sopra: coi negozi non se n'e'
 * ancora parlato. Tenerlo acceso senza sconto non basterebbe, perche' un ordine
 * ritirato in negozio oggi non arriva mai a «consegnato»: il solo modo di
 * chiudere un ordine e' il bottone del fattorino, e su un ritiro il fattorino
 * non c'e'. Il negoziante consegnerebbe a mano e resterebbe senza incasso.
 *
 * Si riaccende cambiando questa riga in `true` — ma prima va data al venditore
 * una via per confermare il ritiro.
 */
export const RITIRO_IN_NEGOZIO_ATTIVO = false;

/**
 * Quanto prende il fattorino per una consegna, in centesimi.
 *
 * Fisso, non a distanza: Nicola, 20/8/2026, «il compenso del fattorino e' di 3€
 * e non si paga a chilometro».
 *
 * Prima era `2,50 + 1,20 al km`, scollegato da quanto incassava l'ordine. Sopra
 * i 30 euro la spedizione e' gratis per il cliente, quindi l'unica cosa che
 * restava per pagare il fattorino erano i 3 euro di fee di consegna: il conto
 * si rompeva oltre i 420 metri. Il versamento al fattorino e' legato all'incasso
 * di quell'ordine, quindi non falliva in silenzio — falliva e basta, e il cron
 * lo ritentava all'infinito.
 *
 * Con il compenso fisso a 3 euro il conto torna sempre: la fee di consegna che
 * la piattaforma trattiene e' 3 euro, quindi copre il compenso da sola anche
 * quando la spedizione pagata dal cliente e' zero.
 */
export const COMPENSO_RIDER_CENTS = 300;
/**
 * Fee di consegna trattenuta dalla piattaforma (in centesimi) su ogni ordine
 * con consegna a domicilio. NON si applica ai ritiri in negozio. La incassa
 * MyCity: non finisce nel payout del venditore né nel compenso del rider.
 */
export const PLATFORM_DELIVERY_FEE_CENTS = 300;

/**
 * Commissione marketplace in basis point (1000 = 10.00%) trattenuta da MyCity
 * su ogni vendita. Sorgente unica e client-safe: la importano sia il calcolo
 * del payout Stripe (lib/stripe/client → computeApplicationFeeCents) sia
 * l'economia mostrata al venditore (net-to-seller in lib/products/economics).
 * Vive qui — e non in lib/stripe/client (server-only, importa l'SDK Stripe) —
 * così è usabile anche dai componenti client senza trascinare Stripe nel bundle.
 */
export const MARKETPLACE_FEE_BPS = 1000; // 10.00%

// Riferimenti per icone (nomi lucide-react). Componenti li importano e
// renderizzano per evitare di sparare emoji nelle UI strutturali.
// La soglia vale per NEGOZIO, non sul totale del carrello: dirlo qui costa tre parole e toglie il
// caso in cui uno legge «gratuita sopra 30 €», ne spende 35 fra due negozi e paga la spedizione.
// E i minuti vengono da lib/delivery, dove il numero e' deciso — non riscritti qui.
export const VALUE_PROPS = [
  { icon: 'Truck',      title: 'Spedizione gratuita',      subtitle: `sopra €${FREE_SHIPPING_THRESHOLD} per negozio` },
  { icon: 'BanknoteArrowUp', title: 'Pagamento alla consegna', subtitle: 'in contanti, zero rischi' },
  { icon: 'Store',      title: '100% locale',              subtitle: 'venditori della tua città' },
  { icon: 'Zap',        title: 'Consegna rapida',          subtitle: `in ${EXPRESS_ETA_LABEL} dalla conferma del negozio` },
] as const;
