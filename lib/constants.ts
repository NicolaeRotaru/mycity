import { EXPRESS_ETA_LABEL } from './delivery';
import { formatPrice } from './format';
// promessa-consegna non importa questo file (né i suoi: store-hours, quando-arriva, delivery): niente giro.
import { QUANDO_SI_PUO_LA_VELOCE } from './promessa-consegna';
export const LOW_STOCK_THRESHOLD = 5;
export const NEW_PRODUCT_DAYS = 14;

/**
 * 27/10/2026 — LA SPEDIZIONE A CHILOMETRI E LA SOGLIA DEI 30 EURO NON ESISTONO PIÙ.
 *
 * Qui vivevano `FREE_SHIPPING_THRESHOLD` (30 € per negozio), `SHIPPING_PER_ORDER` (4,90 € senza
 * coordinate) e le due tariffe a distanza `SPEDIZIONE_BASE_EUR` + `SPEDIZIONE_PER_KM_EUR` (2,50 €
 * più 1,20 € al km). Nicola ha firmato un'altra promessa (scelta 8 della carta #209, 26/10): il
 * cliente paga SOLO la consegna, `PLATFORM_DELIVERY_FEE_CENTS` per negozio, sempre, anche sotto i
 * 30 euro; col ritiro in negozio niente. Le costanti sono state tolte, non lasciate a zero: un
 * numero che resta esportato prima o poi qualcuno lo rimette in una frase o in un conto.
 */
/**
 * FIN DOVE SI CONSEGNA — in chilometri in linea d'aria dal negozio.
 *
 * 6/9/2026 — IL SITO ACCETTAVA UNA CONSEGNA A MILANO E NON CHIEDEVA UN
 * CENTESIMO DI SPEDIZIONE. Il perimetro del servizio — Piacenza e dintorni —
 * viveva solo nei testi del sito: non c'era un controllo, in nessun punto del
 * progetto. Lo schema della cassa accetta qualunque CAP, e la soglia della
 * spedizione gratuita (30 € per negozio) azzera il prezzo PRIMA di guardare la
 * distanza: negozio a Piacenza, consegna a Milano, 60 km, carrello da 35 € →
 * spedizione 0,00 e ordine accettato. Al fattorino spettano lo stesso i suoi
 * 3 €, e quei 60 km li avremmo pagati noi. Sotto i 30 € succedeva il rovescio:
 * la stessa consegna veniva quotata oltre 70 € alla cassa dopo che il carrello
 * aveva scritto 4,90.
 *
 * DA DOVE VIENE IL NUMERO — 27/10/2026, decisione di Nicola: al lancio le
 * consegne le fa lui, IN BICI, fino a 10 km dal negozio. Prima qui c'era 25,
 * preso dal caso più lontano che una prova sui soldi percorreva (~24 km): un
 * confine che nessuno può pedalare. Con 25 la cassa accettava un indirizzo a
 * 20 km, il cliente pagava in contanti alla consegna e aspettava un fattorino
 * che non sarebbe partito — il primo cliente perso, e un negozio che prepara
 * la merce per niente. Dentro i 10 km ci sta Piacenza città con la prima
 * cintura; fuori restano Fiorenzuola, Castel San Giovanni, Cremona, Lodi,
 * Milano.
 *
 * 28/10/2026, 08:30 — CORREZIONE DI NICOLA: 5 KM, NON 10. «Mi ero sbagliato,
 * la consegna va fatta in un'area di 5 km.» Con 10 la cassa accettava un
 * indirizzo a 8 km: il cliente pagava, e in bici non ci si arrivava — un
 * rimborso, un negozio che ha preparato per niente, il primo cliente perso.
 * Da un negozio in centro, dentro i 5 km ci sta Piacenza città; fuori restano
 * Podenzano, Rottofreno, Gossolengo e la prima cintura. Il confine si misura
 * in linea d'aria (`haversineKm`, in lib/ordini/zona-di-consegna.ts): 5 km in
 * linea d'aria sono circa 6-7 km di strada, una stima e non una misura.
 *
 * La promessa sui tempi che va con questo confine (registro dei fatti,
 * `consegna.promessa`): la consegna normale arriva nella fascia che il cliente
 * sceglie in cassa; la veloce in 30-60 minuti (`EXPRESS_ETA_LABEL`). Al confine
 * dei 5 km il conto in bici ci sta: 15 di preparazione + 20 di viaggio + al
 * massimo 20 di andata del fattorino al negozio = 55 (`deliveryEtaMinutes`,
 * lib/geo.ts); oltre i 5 km non si consegna, quindi nemmeno la veloce
 * (`fuoriZonaDiConsegna`). Prova: tests/unit/la-veloce-al-confine-dei-5-km.test.ts.
 * La pagina Spedizioni, la FAQ, «Vicino a te» e la pagina
 * admin delle consegne leggono il confine da qui (27/10, secondo giro); dal
 * 28/10 anche il raggio con cui si apre «Vicino a te».
 *
 * 🟡 IL NUMERO È UNA DECISIONE COMMERCIALE, NON TECNICA: dice a chi possiamo
 * vendere. Sta qui, in una riga, apposta perché cambiarlo sia una firma e non
 * una caccia al tesoro. La prova
 * tests/unit/al-lancio-si-consegna-in-bici-fino-a-5-km.test.ts lo inchioda
 * (fino al 28/10 si chiamava …-fino-a-10-km.test.ts): chi lo cambia cambia
 * anche quella, nome compreso, con la decisione nuova accanto. Chi lo alza si
 * prenda anche il compenso del fattorino (`COMPENSO_RIDER_CENTS`), che è fisso
 * e non cresce coi chilometri.
 */
export const RAGGIO_CONSEGNA_KM = 5;

/**
 * La velocità media di chi consegna, in km/h, per stimare il tempo di viaggio
 * (`deliveryEtaMinutes` in lib/geo.ts: il «fra quanti minuti arriva» mentre il
 * fattorino è in strada). Al lancio si consegna in bici (decisione del
 * 27/10/2026): in città una bici fa 12-18 km/h fra semafori e incroci. Prima la
 * stima usava 25 km/h, che è uno scooter: 10 km risultavano 24 minuti invece
 * di 40, e il cliente leggeva un arrivo che non poteva succedere.
 */
export const VELOCITA_MEDIA_BICI_KMH = 15;

/**
 * Sconto percentuale per ritiro in negozio.
 *
 * Vale 0 perche' il ritiro in negozio e' MESSO DA PARTE: Nicola, 20/8/2026,
 * «togli il 10% di sconto per ritira in negozio, o mettilo da parte per il
 * momento, perche non ne ho ancora parlato con i negozi di questo». Uno sconto
 * sul prezzo di un negozio non si offre prima di averglielo chiesto.
 */
export const PICKUP_DISCOUNT_PERCENT = 0;

export { RITIRO_IN_NEGOZIO_ATTIVO } from './ritiro-in-negozio';

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
 * 29/10/2026 23:04 — Il fattorino prende 3 € per il giro (`COMPENSO_RIDER_CENTS`, sull'ordine che
 * porta la base della consegna) e 1 € per ogni negozio in più da cui passa (registro dei fatti,
 * logistica.compenso-fattorino). Prima dell'ondata 14 prendeva 3 € su OGNI ordine: con 15 + 12 €
 * il cliente pagava 4 € di consegna e il fattorino ne prendeva 6, e con la carta i bonifici della
 * stessa charge superavano l'addebito. È un fatto suo, non `CONSEGNA_NEGOZIO_IN_PIU_CENTS`: oggi
 * valgono uguale, ma uno lo paga il cliente e l'altro lo prende il fattorino.
 */
export const COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS = 100;
/**
 * Fee di consegna trattenuta dalla piattaforma (in centesimi) su ogni ordine
 * con consegna a domicilio. NON si applica ai ritiri in negozio. La incassa
 * MyCity: non finisce nel payout del venditore né nel compenso del rider.
 */
export const PLATFORM_DELIVERY_FEE_CENTS = 300;

/**
 * 29/10/2026 22:21 — LA CONSEGNA È UNA SOLA PER TUTTO IL CARRELLO (registro dei fatti, consegna.promessa).
 *
 * 3 € di base per tutto il carrello con la fascia oraria che sceglie il cliente; 1 € in più per ogni
 * negozio in più; 1 € in più per ogni negozio in cui la merce (dopo gli sconti) sta sotto i 10 €; la
 * veloce («Adesso») 1 € in più una volta sola, compresa se c'è già un euro della spesa piccola.
 * Il fattorino prende 3 € per il giro e 1 € per ogni negozio in più (`COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS`):
 * gli euro della spesa piccola e della veloce restano a MyCity, dentro `delivery_fee_cents`.
 * Il conto lo fa una funzione sola: `vociDellaConsegna` in lib/ordini/prezzi.ts.
 */
export const SUPPLEMENTO_CONSEGNA_CENTS = 100;
/** Da quanta merce per negozio (dopo gli sconti) la consegna con la fascia torna a 3 €. */
export const SPESA_SENZA_SUPPLEMENTO_CENTS = 1000;
/**
 * La consegna più alta di un carrello con UN negozio solo: base più un euro. Con più negozi non c'è
 * più un massimo (regola del 29/10 alle 22:21): ogni negozio in più e ogni negozio sotto i 10 €
 * aggiungono il loro euro.
 */
export const CONSEGNA_MASSIMA_CENTS = PLATFORM_DELIVERY_FEE_CENTS + SUPPLEMENTO_CONSEGNA_CENTS;
/** 29/10/2026 22:21 — Ogni negozio in più nel carrello: una fermata in più nello stesso giro. */
export const CONSEGNA_NEGOZIO_IN_PIU_CENTS = 100;
/** La consegna veloce («Adesso»): una volta sola per tutto il carrello, compresa se un negozio è sotto i 10 €. */
export const SUPPLEMENTO_VELOCE_CENTS = 100;

/**
 * Commissione marketplace in basis point (1000 = 10.00%) trattenuta da MyCity
 * su ogni vendita. Sorgente unica e client-safe: la importano sia il calcolo
 * del payout Stripe (lib/stripe/client → computeApplicationFeeCents) sia
 * l'economia mostrata al venditore (net-to-seller in lib/products/economics).
 * Vive qui — e non in lib/stripe/client (server-only, importa l'SDK Stripe) —
 * così è usabile anche dai componenti client senza trascinare Stripe nel bundle.
 */
export const MARKETPLACE_FEE_BPS = 1000; // 10.00%

/**
 * La commissione su una cifra di merce, in centesimi interi: `MARKETPLACE_FEE_BPS` arrotondato al
 * centesimo. 27/10/2026 — la formula ha un posto solo, client-safe, perché la usano in due: il
 * payout (`computeApplicationFeeCents` in lib/stripe/client) e la cassa (`prezziDelCarrello`), che
 * col codice «Spedizione gratuita» deve sapere quanto dell'ordine resta alla piattaforma per pagare
 * il fattorino. Con due copie, il giorno che cambia l'arrotondamento la cassa conterebbe un
 * centesimo che il bonifico non trova.
 */
export function commissioneCents(merceCents: number): number {
  return Math.round((merceCents * MARKETPLACE_FEE_BPS) / 10000);
}

// Riferimenti per icone (nomi lucide-react). Componenti li importano e
// renderizzano per evitare di sparare emoji nelle UI strutturali.
// 27/10/2026 — La prima promessa diceva «Spedizione gratuita sopra 30 € per negozio · 3,00 € di
// consegna». La soglia non esiste più: si paga solo la consegna, per negozio, e il confine è quello
// della cassa. Le due cifre nascono dalle costanti qui sopra. Le parole della vetrina le decide
// `promessaSpedizione()` in lib/promesse-pubbliche (qui non si può chiamare: quel file importa
// questo, e il giro si chiuderebbe su se stesso); una prova tiene le frasi allineate.
// I minuti della quarta promessa vengono da lib/delivery, dove il numero è deciso.
export const VALUE_PROPS = [
  { icon: 'Truck',      title: 'Consegna a casa',          subtitle: PLATFORM_DELIVERY_FEE_CENTS > 0 ? `da ${formatPrice(PLATFORM_DELIVERY_FEE_CENTS / 100)} per tutto il carrello, entro ${RAGGIO_CONSEGNA_KM} km` : `gratuita, entro ${RAGGIO_CONSEGNA_KM} km` },
  { icon: 'BanknoteArrowUp', title: 'Pagamento alla consegna', subtitle: 'in contanti, zero rischi' },
  { icon: 'Store',      title: '100% locale',              subtitle: 'venditori della tua città' },
  // 30/10/2026 — Diceva «Consegna rapida in 30-60 min dalla conferma» come cosa certa: la veloce c'è
  // solo coi negozi aperti e un fattorino in servizio (lib/ordini/consegna-veloce.ts, veloceSiPuo).
  // 30/10/2026 (ondata 18) — Ne diceva una sola su tre: le condizioni vengono da QUANDO_SI_PUO_LA_VELOCE.
  { icon: 'Zap',        title: 'Consegna rapida',          subtitle: `in ${EXPRESS_ETA_LABEL}, ${QUANDO_SI_PUO_LA_VELOCE}; se no all'ora che scegli` },
] as const;
