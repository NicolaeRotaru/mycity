/**
 * LE FUNZIONI SPENTE AL LANCIO — una casa sola per gli interruttori.
 *
 * Decisione: carta #209, firmata da Nicola il 26/10/2026 con tutte le
 * raccomandazioni. Al lancio restano spente le funzioni che promettono al
 * cliente o al negozio qualcosa che il sito non mantiene ancora: soldi
 * incassati senza regole (buoni regalo), premi che nessuno paga (classifica
 * inviti), prezzi che la cassa non applica (Drop del giorno, codice del Negozio
 * del mese), un regalo di 5 euro che non esiste (newsletter), pulsanti che
 * rispondono «servizio non configurato» (AI per i negozi), una traduzione che
 * cancella l'italiano (Traduci), un caricamento da file che non legge l'Excel
 * italiano. L'app installabile e i codici sconto non hanno un interruttore
 * qui: come stanno oggi lo dice la nota in fondo al file.
 *
 * Perché costanti nel codice e non variabili NEXT_PUBLIC: una variabile del
 * browser si fissa quando il sito viene costruito, e una variabile assente
 * per sbaglio riaccenderebbe o spegnerebbe una funzione senza che nessuno lo
 * veda. Qui riaccendere vuol dire cambiare `false` in `true` in una richiesta
 * di unione, cioè con la firma di Nicola e con la storia nel registro.
 *
 * Ogni interruttore va letto DUE volte: dalla pagina (che non mostra la
 * funzione) e dalla rotta del server (che la rifiuta anche se qualcuno la
 * chiama a mano). La pagina è vetrina; il freno vero è la rotta.
 *
 * Prima di riaccenderne una, leggi il «Per riaccendere» accanto.
 *
 * Qui sta solo un interruttore che qualcuno legge davvero: un `false` che
 * nessun file importa scrive «spento» su una cosa che nessuno spegne. Lo
 * controlla tests/unit/ogni-interruttore-del-lancio-lo-legge-qualcuno.test.ts.
 */

/** Vendita dei buoni regalo. Per riaccendere: parere legale e IVA sul buono
 *  multiuso, regole nei Termini (chi lo emette, validità, rimborso), fondi non
 *  trattenuti dalla piattaforma. Il riscatto e il credito restano accesi. */
export const BUONI_REGALO_IN_VENDITA: boolean = false;

/** Classifica mensile degli inviti. Per riaccendere coi premi: è un concorso a
 *  premi (DPR 430/2001), serve regolamento, comunicazione al Ministero e
 *  cauzione, più il pagamento automatico dei premi. Il credito di 5 € per
 *  invito non dipende da qui. */
export const CLASSIFICA_INVITI_ACCESA: boolean = false;

/** «Drop del giorno» in home. Per riaccendere: il prezzo del drop deve essere
 *  calcolato dal server in scheda, carrello e ordine, col prezzo di
 *  riferimento più basso dei 30 giorni precedenti (Codice del Consumo, 17-bis). */
export const DROP_DEL_GIORNO_ACCESO: boolean = false;

/** Iscrizione alla newsletter. Per riaccendere: chiave di servizio Supabase e
 *  posta (Resend) in produzione; e nessun regalo promesso finché non esiste un
 *  buono vero legato all'iscrizione. Conferma e disiscrizione restano vive. */
export const NEWSLETTER_ACCESA: boolean = false;

/** Strumenti di intelligenza artificiale per i negozi. Per riaccendere:
 *  ANTHROPIC_API_KEY e chiave di servizio su Vercel, e chiusi prima i difetti
 *  AI aperti (modello in scadenza, prezzo proposto, chat che riscrive). */
export const AI_NEGOZI_ACCESA: boolean = false;

/** «Traduci» un prodotto o il catalogo. Per riaccendere: le traduzioni devono
 *  stare ACCANTO all'italiano (campi o tabella per lingua). Oggi il prodotto ha
 *  un nome solo, e tradurre vuol dire cancellare l'italiano. */
export const TRADUCI_ACCESO: boolean = false;

/** Caricamento dei prodotti da file CSV. Per riaccendere: il lettore deve
 *  riconoscere il punto e virgola e la codifica dell'Excel italiano, e le
 *  regole del database (allergeni, misure) devono valere anche sulle righe
 *  importate. Il modulo «Nuovo prodotto» resta acceso. */
export const CARICAMENTO_DA_FILE_ACCESO: boolean = false;

/* SENZA INTERRUTTORE QUI (nessun interruttore finché nessuno lo legge).
 *
 * App installabile: oggi l'app non si installa perché il manifest non è nel
 * <head> (difetto 239), ma il banner che invita a installarla si vede ancora.
 * Lo spegne la squadra dell'app, che prima di riaccendere prova tutto su un
 * Android vero.
 *
 * Codici sconto in cassa: spenti nel database dal 27/10/2026 alle 12:01, con
 * BENVENUTO10 e SPED5 non attivi (comando SQL di Nicola, carta #214). La cassa
 * però li applicherebbe ancora se qualcuno li riattivasse: l'interruttore della
 * cassa arriva con la squadra della cassa. Prima di riaccenderli va deciso chi
 * paga lo sconto: oggi il netto del negozio si calcola sul totale già
 * scontato, quindi un codice di MyCity lo pagherebbe il negozio al 90%. */
