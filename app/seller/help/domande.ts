import { Package, ShoppingBag, Euro, Star, Rocket, type LucideIcon } from 'lucide-react';
import { MARKETPLACE_FEE_BPS } from '@/lib/constants';
import { FRASE_PREZZO_NEGOZI, spiegazioneCommissione } from '@/app/seller/earnings/commissione';
import { AI_NEGOZI_ACCESA } from '@/lib/funzioni-al-lancio';
import { ORDER_STATUS_LABEL, etichettaPronto } from '@/lib/order-status';

// 31/10/2026 (ondata 4) — Qui c'era «Bonifico mensile il giorno 5»: una terza
// versione dei tempi, diversa dalla pagina Guadagni e da quello che facciamo
// davvero. La risposta adesso è la stessa frase della pagina Guadagni.
const tempiBonifico = spiegazioneCommissione().find((p) => p.tema === 'bonifico');
const RISPOSTA_TEMPI_BONIFICO = tempiBonifico
  ? `${tempiBonifico.prima}${tempiBonifico.forte}${tempiBonifico.dopo}`
  : 'Da "Guadagni" vedi quanto ti spetta e quando arriva.';

/**
 * 30/8/2026 (R037) — AL NEGOZIO SCRIVEVAMO «PAGHI L'8%», E NE TRATTENEVAMO IL 10.
 *
 * La percentuale che MyCity trattiene sta in un posto solo — `MARKETPLACE_FEE_BPS`
 * in lib/constants — ed e' quella che il codice usa davvero per calcolare quanto
 * arriva sul conto del negozio. Le risposte del Centro venditori, invece, la
 * riscrivevano a mano: c'era scritto «8%» mentre il conto ne tratteneva il 10.
 * Il negoziante leggeva una promessa e ne incassava un'altra: su mille euro di
 * venduto sono venti euro al mese che non tornano, e il primo che se ne accorge
 * ha ragione a non fidarsi piu' di nessun altro numero che scriviamo.
 *
 * Le domande vivono qui, fuori dalla pagina, per due motivi: la percentuale la
 * prendono dalla costante e non da una frase battuta a mano, e cosi' una prova
 * puo' leggere davvero il testo che il negoziante ha sotto gli occhi (la pagina
 * e' JSX e i test non la sanno aprire).
 */

/** La commissione come la legge una persona: 10 quando i punti base sono 1000. */
export const COMMISSIONE_PERCENTO = MARKETPLACE_FEE_BPS / 100;

export type ArgomentoAiuto = {
  icon: LucideIcon;
  title: string;
  items: { q: string; a: string }[];
};

export const TOPICS: ArgomentoAiuto[] = [
  {
    icon: Package,
    title: 'Gestione ordini',
    items: [
      { q: 'Come accetto un ordine?',
        // Le etichette sono quelle dei pulsanti veri (lib/order-status.ts e la pagina dell'ordine).
        a: `Da "Ordini" apri l'ordine "${ORDER_STATUS_LABEL.NEW}" e premi "Accetta ordine". Riceverai una notifica quando un rider lo prenderà in carico.` },
      { q: 'Posso rifiutare un ordine?',
        a: 'Sì, se non puoi evaderlo. Fornisci sempre un motivo (es. prodotto esaurito). Il cliente riceve rimborso automatico.' },
      { q: 'Come segnalo l\'ordine pronto?',
        a: `Dalla pagina dell'ordine premi "${etichettaPronto(false)}" (oppure "${etichettaPronto(true)}" se il cliente passa in negozio). Il rider o il cliente vengono avvisati.` },
    ],
  },
  {
    icon: ShoppingBag,
    title: 'Prodotti e foto',
    items: [
      { q: 'Quante foto per prodotto?',
        a: 'Da 3 a 5 foto sono l\'ideale. La prima è la copertina: scegli la più chiara e luminosa.' },
      { q: 'Posso aggiornare prezzo o disponibilità?',
        a: 'Sì, da "Prodotti": "Modifica" per prezzo e scorta, "Nascondi" per toglierlo dalla vetrina.' },
      // L'assistente AI per i negozi è spento al lancio: la risposta compare solo se è acceso.
      ...(AI_NEGOZI_ACCESA
        ? [{ q: 'Come uso l\'AI per compilare la scheda?',
            a: 'Quando crei un prodotto, carica la foto: l\'assistente AI estrae nome, descrizione e categoria. Tu controlli e correggi.' }]
        : []),
    ],
  },
  {
    icon: Euro,
    title: 'Guadagni e pagamenti',
    items: [
      { q: 'Quando ricevo i soldi delle vendite?',
        a: `${RISPOSTA_TEMPI_BONIFICO} Da "Guadagni" vedi il prossimo importo previsto.` },
      { q: 'Quanto tratteniamo?',
        // 31/10/2026 (ondata 6) — Diceva «Nessun costo mensile»: il prezzo dei negozi è una frase sola.
        a: `${FRASE_PREZZO_NEGOZI} La percentuale si calcola sul venduto effettivamente concluso.` },
      { q: 'Cosa succede se un ordine viene rimborsato?',
        a: 'Non viene calcolato nel netto. Se è già stato pagato, viene compensato sul payout successivo.' },
    ],
  },
  {
    icon: Star,
    title: 'Recensioni e clienti',
    items: [
      { q: 'Posso rispondere alle recensioni?',
        a: 'Sì, da "Recensioni" → "Rispondi". La risposta è pubblica: chi legge la recensione legge anche te.' },
      { q: 'Vedo i dati dei clienti?',
        a: 'Nome, indirizzo e telefono di chi ha ordinato, per preparare e consegnare quell\'ordine: usali solo per quello. L\'email resta privata. Per mandare pubblicità serve il consenso della persona.' },
      { q: 'Come gestisco un cliente VIP?',
        a: 'Da "Clienti" filtra per "VIP (5+ ordini)": vedi chi torna più spesso e quanto ha speso.' },
    ],
  },
  {
    icon: Rocket,
    title: 'Vendere di più',
    items: [
      { q: 'Cosa rende un negozio attraente?',
        a: 'Logo + copertina + 10+ prodotti con foto pulite e descrizioni complete (peso, materiali, provenienza).' },
      { q: 'Come miglioro il posizionamento?',
        // Gli stessi criteri dei Termini (app/terms, «come ordiniamo i risultati»).
        a: 'I risultati si ordinano per pertinenza con la ricerca, distanza, voto delle recensioni e disponibilità; i prodotti sponsorizzati sono segnalati. Schede complete e prodotti disponibili aiutano.' },
    ],
  },
];
