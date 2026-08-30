import { Package, ShoppingBag, Euro, Star, Rocket, type LucideIcon } from 'lucide-react';
import { MARKETPLACE_FEE_BPS } from '@/lib/constants';

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
        a: 'Da "Ordini ricevuti" clicca sull\'ordine "Nuovo" e premi "Accetta". Riceverai una notifica quando un rider lo prenderà in carico.' },
      { q: 'Posso rifiutare un ordine?',
        a: 'Sì, se non puoi evaderlo. Fornisci sempre un motivo (es. prodotto esaurito). Il cliente riceve rimborso automatico.' },
      { q: 'Come segnalo l\'ordine pronto?',
        a: 'Dalla pagina dell\'ordine premi "Pronto per la consegna". Verrà notificato il primo rider disponibile in zona.' },
    ],
  },
  {
    icon: ShoppingBag,
    title: 'Prodotti e foto',
    items: [
      { q: 'Quante foto per prodotto?',
        a: 'Da 3 a 5 foto sono l\'ideale. La prima è la copertina: scegli la più chiara e luminosa.' },
      { q: 'Posso aggiornare prezzo o disponibilità?',
        a: 'Sì, da "I miei prodotti" → menu del prodotto → "Modifica" o switch "Disponibile/Esaurito".' },
      { q: 'Come uso l\'AI per compilare la scheda?',
        a: 'Quando crei un prodotto, carica la foto: l\'assistente AI estrae nome, descrizione e categoria. Tu controlli e correggi.' },
    ],
  },
  {
    icon: Euro,
    title: 'Guadagni e pagamenti',
    items: [
      { q: 'Quando ricevo i soldi delle vendite?',
        a: 'Bonifico mensile il giorno 5 sull\'IBAN che hai registrato in Impostazioni. Da "Guadagni" vedi il prossimo importo previsto.' },
      { q: 'Quanto tratteniamo?',
        a: `Il ${COMMISSIONE_PERCENTO}% sul venduto effettivamente concluso. Nessun costo mensile o di iscrizione.` },
      { q: 'Cosa succede se un ordine viene rimborsato?',
        a: 'Non viene calcolato nel netto. Se è già stato pagato, viene compensato sul payout successivo.' },
    ],
  },
  {
    icon: Star,
    title: 'Recensioni e clienti',
    items: [
      { q: 'Posso rispondere alle recensioni?',
        a: 'Sì, da "Recensioni" → "Rispondi". Una risposta pubblica ben fatta migliora la fiducia del 30%.' },
      { q: 'Vedo i dati dei clienti?',
        a: 'Solo nome e indirizzo per la consegna. Telefono ed email restano privati per GDPR.' },
      { q: 'Come gestisco un cliente VIP?',
        a: 'Da "I miei clienti" filtra per "VIP (5+ ordini)". Considera un piccolo omaggio o sconto dedicato.' },
    ],
  },
  {
    icon: Rocket,
    title: 'Vendere di più',
    items: [
      { q: 'Cosa rende un negozio attraente?',
        a: 'Logo + copertina + 10+ prodotti con foto pulite e descrizioni complete (peso, materiali, provenienza).' },
      { q: 'Conviene partecipare ai gruppi d\'acquisto?',
        a: 'Sì per prodotti con buon margine: sconti dal 10-30% portano traffico massiccio in giornate specifiche.' },
      { q: 'Come miglioro il posizionamento?',
        a: 'Rispondi velocemente agli ordini, mantieni rating alto, pubblica regolarmente. L\'algoritmo premia i negozi attivi.' },
    ],
  },
];
