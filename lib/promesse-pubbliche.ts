import {
  MARKETPLACE_FEE_BPS,
  PICKUP_DISCOUNT_PERCENT,
  PLATFORM_DELIVERY_FEE_CENTS,
  RAGGIO_CONSEGNA_KM,
  RITIRO_IN_NEGOZIO_ATTIVO,
  SPESA_SENZA_SUPPLEMENTO_CENTS,
  SUPPLEMENTO_CONSEGNA_CENTS,
} from './constants';
import { EXPRESS_ETA_LABEL } from './delivery';
import { formatPrice } from './format';
import { spesaPerConsegnaGratisColCodiceCents, tariffaConsegnaCents } from './ordini/prezzi';

/**
 * IL NOME DELLA VOCE DA 3 EURO — uno solo, in ogni schermata.
 *
 * 27/10/2026 (terzo giro) — La stessa cifra aveva quattro nomi: «Consegna MyCity» nel carrello e
 * sulla pagina dell'ordine, «Spedizione» nel riepilogo della cassa, «Consegna a casa» nella riga
 * sotto il prezzo della scheda prodotto, che la diceva due volte con due nomi. Chi legge due nomi
 * pensa a due costi, e somma: 6 euro invece di 3. Qui il nome sta in un posto, e chi scrive la voce
 * lo prende da qui (carrello, cassa, pagina dell'ordine, vetrina).
 */
export const VOCE_CONSEGNA = 'Consegna MyCity';

/**
 * LE PROMESSE PUBBLICHE — quelle scritte nelle pagine, derivate da chi le mantiene.
 *
 * ── Il difetto che ha prodotto questo file ───────────────────────────────────────────────────
 * Le pagine FAQ e Spedizioni promettevano tre cose che il sito non fa:
 *
 *   ① «Ritiro in negozio, e ottieni il 10% di sconto: selezionalo al checkout».
 *      Al checkout quel blocco è dentro `RITIRO_IN_NEGOZIO_ATTIVO`, che vale `false`. Le due rotte
 *      che creano l'ordine forzano `pickupInStore = false`. L'opzione non esiste, e nella FAQ c'è
 *      perfino l'istruzione per selezionarla.
 *   ② «Se il negozio è chiuso, l'ordine parte alla riapertura e te lo diciamo prima che tu paghi».
 *      Le due rotte fanno l'opposto: se il negozio è chiuso rifiutano con un conflitto. Nessun
 *      ordine viene messo in coda.
 *   ③ «30-60 minuti», scritto a mano in quattro punti mentre `EXPRESS_ETA_LABEL` esiste dal giorno
 *      in cui qualcuno ha deciso quel numero.
 *
 * ── Perché un file e non tre correzioni di testo ────────────────────────────────────────────
 * Perché correggere il testo lascia in piedi il meccanismo: la funzione ha un interruttore, la
 * frase che la promette non lo legge, e le due si separano il giorno dopo. `RITIRO_IN_NEGOZIO_ATTIVO`
 * esiste già ed è letto dal checkout, dalle due rotte e dalla pagina di amministrazione — cioè da
 * tutti tranne che dalle pagine che lo promettono ai clienti.
 *
 * Qui le promesse NASCONO dagli stessi interruttori. Riaccendere il ritiro fa ricomparire la FAQ e
 * il riquadro da sé; spegnerlo li fa sparire. Non c'è più un testo da ricordarsi di aggiornare.
 *
 * 🟢 Puro: nessuna rete, nessun orologio. Una prova lo ESEGUE con gli interruttori nei due versi.
 */

export interface DomandaRisposta {
  q: string;
  a: string;
}

/**
 * Le promesse sul RITIRO IN NEGOZIO. Elenco vuoto quando la funzione è spenta: una promessa che
 * nessuno può accettare non è un'informazione in meno, è una bugia in più.
 */
export function promesseRitiroInNegozio(
  attivo: boolean = RITIRO_IN_NEGOZIO_ATTIVO,
  scontoPercento: number = PICKUP_DISCOUNT_PERCENT,
): DomandaRisposta[] {
  if (!attivo) return [];
  // Lo sconto è un secondo interruttore, e vale zero (`PICKUP_DISCOUNT_PERCENT = 0`): la FAQ ne
  // prometteva il 10%. Se un giorno il ritiro si riaccende senza sconto, la promessa non deve
  // resuscitare la percentuale — nasce da quel numero, e a zero non si nomina.
  const sconto = scontoPercento > 0 ? `, e ottieni il ${scontoPercento}% di sconto` : '';
  return [
    {
      q: 'Posso ritirare in negozio?',
      a: `Sì${sconto}. Seleziona "Ritiro in negozio" al checkout: ti avviseremo appena l'ordine sarà pronto.`,
    },
  ];
}

/**
 * COME ARRIVA L'ORDINE — la riga che si legge PRIMA di entrare.
 *
 * ── Il difetto che ha prodotto queste tre funzioni ──────────────────────────────────────────
 * Il lotto precedente aveva ripulito le pagine di contenuto (FAQ ritiro, Spedizioni, scheda
 * prodotto) e aveva lasciato indietro i posti dove la promessa arriva PRIMA di tutti:
 *
 *   ① la descrizione di ogni pagina negozio (`app/store/[id]/layout.tsx`) e di ogni categoria
 *      (`app/category/[slug]/layout.tsx`): «Consegna locale in 30-60 minuti o ritiro in negozio».
 *      È il testo che finisce nel risultato di Google e nell'anteprima quando il negoziante incolla
 *      il link su WhatsApp — cioè il primo contatto di chi arriva dal QR in vetrina;
 *   ② la PRIMA risposta delle FAQ: «scegli un indirizzo di consegna o il ritiro in negozio»;
 *   ③ la scheda «Spedizioni» della pagina di aiuto: «Tempi, costi, ritiro in negozio, tracciamento».
 *
 * Il ritiro in cassa non c'è: `RITIRO_IN_NEGOZIO_ATTIVO` vale `false`, il riquadro del checkout gli
 * sta dietro e le due rotte che creano l'ordine forzano `pickupInStore = false`. Il cliente sceglie
 * MyCity credendo di poter passare a ritirare, riempie il carrello e alla cassa scopre che l'unica
 * strada è farsi consegnare a casa pagando la consegna. Nicola l'ha spento apposta — «non ne ho
 * ancora parlato con i negozi» — e noi lo promettevamo lo stesso, in vetrina.
 *
 * ── Perché tre funzioni e non quattro frasi corrette ────────────────────────────────────────
 * Perché i metadati nessuno li rilegge come «testo per il cliente»: non si vedono a schermo. Una
 * frase corretta a mano oggi torna a mentire alla prossima pagina che qualcuno scrive. Qui la
 * frase NASCE dall'interruttore, e i minuti dal numero deciso in lib/delivery.ts: riaccendere il
 * ritiro la fa ricomparire dappertutto da sé.
 */
export function fraseComeArriva(attivo: boolean = RITIRO_IN_NEGOZIO_ATTIVO): string {
  return attivo
    ? `Consegna locale in ${EXPRESS_ETA_LABEL} o ritiro in negozio.`
    : `Consegna locale in ${EXPRESS_ETA_LABEL}.`;
}

/** La prima risposta delle FAQ: i passi per ordinare, senza quello che non si può fare. */
export function rispostaComeOrdinare(attivo: boolean = RITIRO_IN_NEGOZIO_ATTIVO): DomandaRisposta {
  const scelta = attivo
    ? 'scegli un indirizzo di consegna o il ritiro in negozio'
    : "scegli l'indirizzo di consegna";
  return {
    q: 'Come faccio a ordinare su MyCity?',
    a: `Cerca un prodotto o un negozio, aggiungilo al carrello, ${scelta} e conferma. Riceverai una notifica per ogni cambio di stato dell'ordine.`,
  };
}

/** Cosa si trova nella pagina Spedizioni, detto nella scheda della pagina di aiuto. */
export function temiDellaSpedizione(attivo: boolean = RITIRO_IN_NEGOZIO_ATTIVO): string {
  return attivo
    ? 'Tempi, costi, ritiro in negozio, tracciamento.'
    : 'Tempi, costi e tracciamento della consegna.';
}

/** Il riquadro «Ritiro in negozio» della pagina Spedizioni, o niente se la funzione è spenta. */
export function riquadroRitiroInNegozio(
  attivo: boolean = RITIRO_IN_NEGOZIO_ATTIVO,
  scontoPercento: number = PICKUP_DISCOUNT_PERCENT,
): { titolo: string; sottotitolo: string } | null {
  if (!attivo) return null;
  return {
    titolo: 'Ritiro in negozio',
    sottotitolo: scontoPercento > 0 ? `${scontoPercento}% di sconto sull'ordine` : 'Niente spese di spedizione',
  };
}

/**
 * Cosa succede se il negozio è chiuso — e la risposta è quella che dà la cassa.
 *
 * 27/10/2026 — LA FRASE DICEVA «NON PUOI ORDINARE», E LA CASSA LASCIA PRENOTARE PER DOMANI.
 * Con la consegna immediata, a negozio chiuso le due rotte rispondono con un conflitto. Ma la
 * cassa offre anche le fasce di domani (`FASCE_DI_DOMANI` in lib/quando-arriva.ts), e
 * `negozioPuoServire` in lib/store-hours.ts per quelle guarda gli orari di domani, non se il
 * negozio è aperto adesso. Alle 21:30 si può ordinare il pane per la mattina dopo: è l'abitudine
 * che un forno vuole, e la frase la scoraggiava. Una prova esegue la regola della cassa e legge
 * questa frase.
 */
/**
 * QUANDO ARRIVA, detto senza un negozio davanti (home, /come-funziona): la regola firmata da Nicola
 * il 26/10 — «in giornata», niente minuti. Al lancio si consegna in bici e solo negli orari del
 * negozio: «30-60 minuti» scritto in una pagina che non sa di quale negozio parla è una promessa
 * che alle 19:50 non si mantiene. Sta qui, puro, perché lo leggono anche i componenti server
 * (quello di `components/ui/DeliveryCutoff.tsx` vive in un modulo client).
 */
export const QUANDO_ARRIVA_SENZA_NEGOZIO = 'in giornata, negli orari di apertura del negozio';

export const NEGOZIO_CHIUSO_COSA_SUCCEDE =
  'Se il negozio è chiuso puoi prenotare per domani, scegliendo una fascia oraria in cassa: la consegna subito, invece, parte solo negli orari di apertura.';

/** La risposta sui tempi di consegna, col numero preso da dove è deciso. */
export function rispostaTempiDiConsegna(): DomandaRisposta {
  return {
    q: "In quanto tempo arriva l'ordine?",
    a: `In ${EXPRESS_ETA_LABEL} dalla conferma del negozio, nei comuni serviti e negli orari di apertura del negozio. ${NEGOZIO_CHIUSO_COSA_SUCCEDE}`,
  };
}

/**
 * Quanto costa farsi portare la spesa, con le cifre prese da dove sono decise.
 *
 * 27/10/2026 — La risposta diceva «GRATUITA sopra €30» e «sotto soglia in media €2,50–4,50»: una
 * forbice scritta a mano che non era il conto della cassa (2,50 € più 1,20 € al km, più 3 euro di
 * consegna). Adesso si paga solo la consegna per negozio, e il confine è quello della cassa.
 */
export function rispostaCostoSpedizione(): DomandaRisposta {
  // 29/10/2026 — Diceva «3,00 € per ogni negozio, qualunque sia la spesa» anche dopo la regola dei
  // 4 € sotto i 10 €: un ordine da 8 € pagava in cassa un euro che la FAQ negava. Ora la frase
  // nasce dalla tariffa della cassa: «qualunque sia la spesa» solo se la spesa davvero non conta.
  const { fasciaCents, pienaCents } = tariffeDellaCassa();
  const quanto =
    pienaCents <= 0
      ? 'La consegna è gratuita, qualunque sia la spesa.'
      : fasciaCents === pienaCents
        ? `Paghi solo la consegna: ${formatPrice(fasciaCents / 100)} per ogni negozio da cui ordini, qualunque sia la spesa.`
        : `Paghi solo la consegna, una per ogni negozio da cui ordini: ${fraseTariffaConsegna()}.`;
  return {
    q: 'Quanto costa la spedizione?',
    a: `${quanto} Non c'è un costo a chilometro: consegniamo fino a ${RAGGIO_CONSEGNA_KM} km dal negozio. Vedi tutti i dettagli nella pagina Spedizioni.`,
  };
}

/**
 * COSA SI PUÒ PAGARE E QUANDO — e la promessa dice quello che offre il checkout.
 *
 * Il claim scritto a mano era: «Puoi pagare alla consegna — carta o contanti, decidi tu», sulla
 * scheda prodotto (l'ultimo schermo prima di aggiungere al carrello) e nel carrello.
 *
 * Al checkout le opzioni sono due e diverse: **carta adesso**, uscendo dal sito su Stripe, oppure
 * **contanti al rider**. La carta alla consegna non esiste. Chi si è fidato proprio perché non
 * voleva anticipare i soldi lo scopre alla cassa, dopo aver riempito il carrello e scritto
 * l'indirizzo — cioè nel punto in cui abbandonare costa di più.
 *
 * Qui la frase nasce dall'elenco dei metodi. Aggiungerne uno cambia la promessa da sé.
 */
export type MetodoPagamento = 'carta-adesso' | 'contanti-alla-consegna';

/*
 * 28/10/2026 — L'ELENCO ERA FISSO, LA CASSA NO.
 *
 * L'elenco conteneva sempre 'carta-adesso'. La cassa invece accende la carta solo se esiste
 * `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, che in produzione manca (al lancio si paga solo in
 * contanti, decisione di Nicola del 26/10). Risultato: la scheda prodotto prometteva «oppure con
 * carta adesso» e la cassa offriva solo i contanti. Adesso la condizione è UNA, qui, e la legge
 * anche il checkout (`cartaAlCheckoutDisponibile`): la frase e la cassa non possono più divergere.
 */
export function cartaAlCheckoutDisponibile(
  chiave: string | undefined = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
): boolean {
  return !!chiave && chiave.trim() !== '';
}

export function metodiAlCheckout(
  chiave: string | undefined = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
): readonly MetodoPagamento[] {
  return cartaAlCheckoutDisponibile(chiave)
    ? ['carta-adesso', 'contanti-alla-consegna']
    : ['contanti-alla-consegna'];
}

/** I metodi che la cassa offre in questa build (la chiave pubblica è fissata al momento della build). */
export const METODI_AL_CHECKOUT: readonly MetodoPagamento[] = Object.freeze([...metodiAlCheckout()]);

export function frasePagamento(metodi: readonly MetodoPagamento[] = metodiAlCheckout()): string {
  const contanti = metodi.includes('contanti-alla-consegna');
  const carta = metodi.includes('carta-adesso');
  if (contanti && carta) return 'Paghi in contanti alla consegna, oppure con carta adesso';
  if (contanti) return 'Paghi in contanti alla consegna';
  if (carta) return 'Paghi con carta adesso';
  return 'Metodi di pagamento in aggiornamento';
}

/*
 * 28/10/2026 — ANCHE IL «COME» SEGUE I METODI DELLA CASSA.
 *
 * /come-funziona attaccava a mano «: al rider quando arriva, oppure su Stripe prima della conferma»
 * dietro a `frasePagamento()`. Con la chiave Stripe assente (produzione) il cliente leggeva
 * «Paghi in contanti alla consegna: … oppure su Stripe»: la carta spariva dalla frase e tornava
 * dalla coda. Qui ogni modo di pagare porta con sé il suo «come», e non compare se il metodo manca.
 */
export function fraseComeSiPaga(metodi: readonly MetodoPagamento[] = metodiAlCheckout()): string {
  const come: string[] = [];
  if (metodi.includes('contanti-alla-consegna')) come.push('al rider quando arriva');
  if (metodi.includes('carta-adesso')) come.push('su Stripe prima della conferma');
  const frase = frasePagamento(metodi);
  return come.length ? `${frase}: ${come.join(', oppure ')}.` : `${frase}.`;
}

/**
 * IL RESO — «gratuito» era vero solo per il difetto di conformità, non per il ripensamento.
 *
 * La scheda prodotto prometteva «Reso gratuito entro 14 giorni» su ogni prodotto. La pagina resi
 * dice l'opposto in due punti: «Cambio idea: le spese di restituzione sono a tuo carico», e i
 * prodotti deperibili — cioè il cuore di un marketplace di negozi di quartiere — sono esclusi.
 * Carrello e checkout scrivevano già la versione onesta: la scheda prodotto era l'unica a promettere
 * la gratuità, ed è l'ultimo schermo prima dell'acquisto.
 */
export const FRASE_RESO = 'Reso entro 14 giorni';

/**
 * IL RIQUADRO «LO SAPEVI?» DEL CARRELLO — la frase che non reggeva i numeri sopra di sé.
 *
 * Diceva: «Niente intermediari, niente commissioni nascoste». Stava nella colonna del riepilogo,
 * poche righe sotto la voce che addebita 3 € di «Consegna MyCity», su una piattaforma che trattiene
 * anche il 10% al negozio (`MARKETPLACE_FEE_BPS`, e la parte venditori lo scrive per esteso:
 * «Abbonamento €50/mese e commissione del 10% sulle vendite»).
 *
 * MyCity **è** l'intermediario, e la commissione c'è. La contraddizione si vedeva senza uscire dalla
 * pagina: il numero era venti righe sopra la frase. In un carrello la fiducia è l'unica leva, e una
 * frase smentita dalla riga sopra la toglie invece di darla.
 *
 * La versione onesta non rinuncia al vantaggio: dice quello vero — che il costo c'è ed è scritto lì.
 */
/*
 * 28/10/2026 — ANCHE LA SECONDA VERSIONE NON REGGEVA I NUMERI.
 *
 * «Ogni euro di questo carrello va ai commercianti. La nostra parte è la consegna»: falso, perché
 * oltre ai 3 € di consegna MyCity trattiene il 10% della merce al negozio (decisione di Nicola del
 * 26/10: 10% IVA inclusa). La frase adesso nasce dalla stessa commissione che usa la cassa: se la
 * percentuale cambia, cambia anche il riquadro.
 */
export function riquadroLoSapevi(commissioneBps: number = MARKETPLACE_FEE_BPS): string {
  if (commissioneBps <= 0) {
    return 'Il prezzo dei prodotti è quello del negozio, e al negozio va tutto. La nostra parte è la consegna che vedi qui sopra.';
  }
  const nostra = commissioneBps / 100;
  const negozio = 100 - nostra;
  const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1).replace('.', ',')}%`;
  return `Il prezzo dei prodotti è quello del negozio. Al negozio va il ${pct(negozio)}, a noi il ${pct(nostra)} e la consegna che vedi qui sopra.`;
}

export const RIQUADRO_LO_SAPEVI = riquadroLoSapevi();

/**
 * LA SPEDIZIONE — quello che si scrive in vetrina, deciso dove si decide quanto si paga.
 *
 * ── Il difetto che ha prodotto questa funzione ──────────────────────────────────────────────
 * In vetrina il sito prometteva «Spedizione gratuita» sopra €30: sulla scheda prodotto, sul
 * badge della card di catalogo, sulla barra «Hai la spedizione gratis», nelle quattro promesse
 * della home. In cassa, su ogni ordine consegnato a casa, addebitava comunque 3 € di «Consegna
 * MyCity» — uno per negozio, anche sopra i 30 € (`PLATFORM_DELIVERY_FEE_CENTS`, e il conto lo fa
 * `prezziDelCarrello` in lib/ordini/prezzi.ts).
 *
 * Per chi compra, «spedizione» e «consegna» sono la stessa cosa. Il costo compariva per la prima
 * volta nel carrello, cioè dopo la scelta: sulla scheda prodotto — l'ultimo schermo prima di
 * aggiungere — non c'era da nessuna parte. Al checkout il riepilogo scriveva «Spedizione: Gratis»
 * e la riga sotto «Consegna MyCity 3,00 €», con «Niente costi nascosti» appoggiato sopra un costo
 * mai annunciato prima.
 *
 * ── Perché una funzione e non quattro testi corretti ────────────────────────────────────────
 * Perché correggere i testi lascia in piedi il modo in cui si è rotto: la cifra sta in un posto,
 * la frase che la promette in altri quattro, e il giorno in cui la cifra cambia le frasi restano
 * indietro. Qui la frase NASCE dalla cifra. Portare la fee a zero fa tornare da sé il claim
 * pulito; alzarla lo aggiorna dappertutto senza che nessuno riscriva niente.
 *
 * 🟢 Pura: nessuna rete, nessun orologio. La prova la ESEGUE con la fee accesa e spenta, e
 * confronta il numero che dice con quello che la cassa addebita davvero.
 */
export interface PromessaSpedizione {
  /**
   * Sempre `false` dal 27/10/2026: la soglia della spedizione gratis non esiste più. Resta nel tipo
   * perché la scheda prodotto e la card di catalogo lo leggono ancora per decidere se mostrare la
   * pastiglia verde «gratis»: con `false` non la mostrano più.
   */
  sopraSoglia: boolean;
  /** Sempre zero dal 27/10/2026: non c'è più una soglia da raggiungere. */
  mancano: number;
  /** Quanto si paga per farsi portare l'ordine a casa, in euro, per negozio. Zero = niente. */
  costoConsegna: number;
  /** La frase principale: quella del badge sulla scheda e della riga sotto il prezzo. */
  titolo: string;
  /** La stessa cosa in un'etichetta stretta, per le card di catalogo. */
  breve: string;
  /** La riga che nomina il costo per esteso, o `null` quando non c'è niente da pagare. */
  dettaglioConsegna: string | null;
}

/**
 * 27/10/2026 — LA SOGLIA DEI 30 EURO NON ESISTE PIÙ. Scelta 8 della carta #209: il cliente paga
 * solo la consegna, per negozio, sempre. Le frasi «Spedizione gratis · 3,00 € di consegna» e «Ti
 * mancano X € alla spedizione gratis» promettevano un traguardo che la cassa non dà più.
 *
 * Il primo argomento (il sottototale) non cambia più la risposta: resta perché la scheda prodotto
 * e la card di catalogo lo passano ancora, e si toglie quando si toccano quei file.
 */
export function promessaSpedizione(
  _sottototale: number = 0,
  consegnaCents: number = PLATFORM_DELIVERY_FEE_CENTS,
): PromessaSpedizione {
  const costoConsegna = Math.max(0, consegnaCents) / 100;
  const siPaga = costoConsegna > 0;
  return {
    sopraSoglia: false,
    mancano: 0,
    costoConsegna,
    titolo: siPaga ? `${VOCE_CONSEGNA} ${formatPrice(costoConsegna)} per negozio` : 'Consegna a casa gratuita',
    breve: siPaga ? `Consegna ${formatPrice(costoConsegna)}` : 'Consegna gratuita',
    dettaglioConsegna: siPaga ? `${VOCE_CONSEGNA} ${fraseTariffaConsegna(consegnaCents)}` : null,
  };
}

/**
 * 27/10/2026 — LA RIGA SOTTO LA CONSEGNA QUANDO IL CODICE «SPEDIZIONE GRATUITA» LA COPRE IN PARTE.
 *
 * Il codice regala la consegna fin dove la paga la commissione di quel negozio (`prezziDelCarrello`):
 * da 30 € di spesa per negozio tutta, sotto una parte. Senza questa riga la cassa scriveva «Consegna
 * MyCity 3,00 € per negozio» sopra un addebito di 1 €, e chi aveva letto «codice applicato» non
 * capiva perché pagava ancora. `null` quando non c'è niente da spiegare: consegna già a zero, o un
 * codice che su quella spesa non copre neanche un centesimo.
 */
/**
 * 29/10/2026 — LA TARIFFA DELLA CONSEGNA IN UNA FRASE SOLA (registro dei fatti, consegna.promessa).
 * 3 € per negozio con la fascia, 4 € sotto i 10 € di spesa o con la consegna veloce, mai di più.
 * I numeri nascono dalle costanti e il conto lo fa `tariffaConsegnaCents`: la frase non li riscrive.
 * La usano la cassa, la pagina Spedizioni e il pannello consegne dell'amministratore.
 */
export function fraseTariffaConsegna(baseCents: number = PLATFORM_DELIVERY_FEE_CENTS): string {
  const base = formatPrice(Math.max(0, baseCents) / 100);
  const piena = formatPrice((Math.max(0, baseCents) + SUPPLEMENTO_CONSEGNA_CENTS) / 100);
  const soglia = formatPrice(SPESA_SENZA_SUPPLEMENTO_CENTS / 100);
  return `${base} per negozio con la fascia oraria che scegli; ${piena} sotto i ${soglia} di spesa o con la consegna veloce, mai di più`;
}

/**
 * Le due tariffe estreme come le calcola la cassa (`tariffaConsegnaCents`): con la fascia e una
 * spesa sopra la soglia, e la più alta (veloce, o spesa sotto la soglia). Se sono uguali la spesa
 * non conta, e solo allora una frase può dire «qualunque sia la spesa».
 */
function tariffeDellaCassa(): { fasciaCents: number; pienaCents: number } {
  return {
    fasciaCents: tariffaConsegnaCents({ pickupInStore: false, merceCents: SPESA_SENZA_SUPPLEMENTO_CENTS, consegnaVeloce: false }),
    pienaCents: tariffaConsegnaCents({ pickupInStore: false, merceCents: 0, consegnaVeloce: true }),
  };
}

/**
 * 29/10/2026 — IL RIQUADRO DEL PREZZO IN CIMA ALLA PAGINA SPEDIZIONI.
 *
 * Scriveva «Consegna 3,00 € · Per ogni negozio, qualunque sia la spesa» mentre la cassa, sotto i
 * 10 € di merce di quel negozio, addebita 4 €. Il paragrafo sotto era già stato corretto, il
 * riquadro no: la stessa pagina diceva due tariffe. Ora titolo e riga sotto nascono dalla tariffa
 * della cassa. `siPaga` dice alla pagina se c'è qualcosa da pagare, con lo stesso conto.
 */
export function riquadroTariffaConsegna(): { siPaga: boolean; titolo: string; sottotitolo: string } {
  const { fasciaCents, pienaCents } = tariffeDellaCassa();
  if (pienaCents <= 0) {
    return { siPaga: false, titolo: 'Consegna senza costi', sottotitolo: 'Per ogni negozio, qualunque sia la spesa' };
  }
  const fascia = formatPrice(fasciaCents / 100);
  if (fasciaCents === pienaCents) {
    return { siPaga: true, titolo: `Consegna ${fascia}`, sottotitolo: 'Per ogni negozio, qualunque sia la spesa' };
  }
  const piena = formatPrice(pienaCents / 100);
  const soglia = formatPrice(SPESA_SENZA_SUPPLEMENTO_CENTS / 100);
  return {
    siPaga: true,
    titolo: `Consegna ${fascia} o ${piena}`,
    sottotitolo: `Per ogni negozio: ${piena} sotto i ${soglia} di spesa o con la consegna veloce`,
  };
}

export function rigaDelCodiceSpedizione(
  consegnaDaPagareCents: number,
  negozi: number,
  /**
   * 29/10/2026 — Quanto si pagherebbe SENZA codice (spedizione più tariffe, `tariffaConsegnaCents`).
   * Dal 29/10 la tariffa non è più 3 € fissi: sotto i 10 € o con la veloce è 4 €, e il codice
   * l'euro in più non lo copre. Senza questo numero la riga contava come «coperto» un euro che il
   * cliente paga.
   */
  tariffaSenzaCodiceCents: number = negozi * PLATFORM_DELIVERY_FEE_CENTS,
): string | null {
  const copertaCents = tariffaSenzaCodiceCents - consegnaDaPagareCents;
  if (consegnaDaPagareCents <= 0 || copertaCents <= 0) return null;
  const sogliaCents = spesaPerConsegnaGratisColCodiceCents();
  return `Il codice copre ${formatPrice(copertaCents / 100)} della consegna; da ${formatPrice(sogliaCents / 100)} di spesa per negozio la copre tutta.`;
}

/**
 * «Vicino a te» senza negozi nel raggio scelto: cosa si dice a chi guarda la lista vuota.
 *
 * 27/10/2026 (terzo giro) — L'avviso diceva sempre «Aumenta il raggio per vederne di più». Il cursore
 * però si ferma al confine della consegna (`RAGGIO_CONSEGNA_KM`): lì l'invito è un vicolo cieco, e
 * oltre quel confine la cassa non consegna comunque. Al confine si dice com'è.
 */
export function avvisoNessunNegozioVicino(raggioKm: number): string {
  const nessuno = `Nessun negozio entro ${raggioKm} km.`;
  return raggioKm < RAGGIO_CONSEGNA_KM
    ? `${nessuno} Aumenta il raggio per vederne di più.`
    : `${nessuno} Per ora consegniamo fino a ${RAGGIO_CONSEGNA_KM} km dal negozio, e oltre non arriviamo.`;
}
