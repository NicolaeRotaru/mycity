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
 * italiano. Dal 31/10/2026 qui stanno anche la carta, l'abbonamento dei
 * negozi, i codici sconto in cassa, l'app installabile, inviti e punti e
 * PostHog: prima la loro accensione dipendeva da una chiave messa su Vercel, o
 * da nessuno — e un «spento» che nessuno leggeva diceva il falso.
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
 * Due eccezioni, perché una rotta da frenare non c'è: la classifica inviti la
 * legge il browser da una vista (nessun premio passa di mano, la promessa è
 * solo nella pagina) e il caricamento da file è il lettore della pagina, che
 * poi scrive come il modulo «Nuovo prodotto», acceso. Lì il freno è la pagina.
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
 *  AI aperti (modello in scadenza, prezzo proposto, chat che riscrive).
 *  Il server lo legge in lib/ai/client.ts, dove nasce il collegamento da cui
 *  passa ogni chiamata al modello: spento, la chiave da sola non riaccende niente. */
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

/*
 * 31/10/2026 — LE SCELTE CHE PRIMA DIPENDEVANO DA UNA CHIAVE O DA NESSUNO.
 *
 * Nicola, 31/10: «accendi solo la carta» — la carta entra nel lancio, ma si
 * accende con un interruttore suo. Fino a ieri «al lancio solo contanti» si
 * reggeva sull'assenza di NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: chi la metteva su
 * Vercel cambiava la cassa e tutte le frasi del pagamento senza un avviso.
 * Adesso la chiave serve ma non basta: senza il `true` qui sotto la carta resta
 * spenta, e la rotta la rifiuta anche con le chiavi presenti.
 */

/** Pagamento con carta al checkout. Letto da app/api/stripe/checkout (rifiuto),
 *  dalla cassa e dalle frasi del pagamento (`cartaAlCheckoutDisponibile` in
 *  lib/promesse-pubbliche.ts). Per riaccendere: chiavi Stripe in produzione,
 *  webhook collegato e un pagamento vero provato fino al payout del negozio. */
export const CARTA_ACCESA: boolean = false;

/** Abbonamento da 50 € al mese dei negozi e campagne sponsorizzate: soldi che
 *  Stripe chiederebbe al negozio. Letto da app/api/seller/subscription/checkout,
 *  subscription/portal, app/api/sponsored/checkout, dal banner del pannello
 *  negozio e da /seller/promote. Per riaccendere: è un costo nuovo per il
 *  negozio, cioè uno dei paletti del lancio — serve la firma di Nicola. */
export const ABBONAMENTO_NEGOZI_ACCESO: boolean = false;

/** Codici sconto in cassa, in contanti e con carta. Spenti anche nel database
 *  dal 27/10/2026 12:01 (BENVENUTO10 e SPED5 non attivi, carta #214): questo è
 *  il freno della cassa, che li rifiuta anche se un admin ne riattiva uno. Per
 *  riaccendere: decidere chi paga lo sconto — oggi il netto del negozio si
 *  calcola sul totale già scontato, quindi un codice di MyCity lo pagherebbe il
 *  negozio al 90%. */
export const CODICI_SCONTO_IN_CASSA: boolean = false;

/** App installabile: manifest nel <head> e banner «metti MyCity in home».
 *  Letto da app/layout.tsx. Per riaccendere: provare l'installazione su un
 *  Android vero e su un iPhone, icone comprese. */
export const APP_INSTALLABILE_ACCESA: boolean = false;

/** Inviti («invita un amico», codice ?ref= all'iscrizione) e punti. Letto da
 *  app/sign-up, app/profile/referral e app/profile (il riquadro dei 5 euro).
 *  Per riaccendere: l'invito va registrato
 *  dal server. Oggi la pagina di iscrizione cerca chi ha invitato leggendo
 *  `profiles` dal browser di chi non ha ancora un account: le regole del
 *  database non lo permettono, e l'invito non si registrava mai. */
export const INVITI_E_PUNTI_ACCESI: boolean = false;

/** PostHog (analisi del comportamento, server negli Stati Uniti). Letto da
 *  lib/analytics/posthog.tsx: spento, non parte nemmeno con la chiave su
 *  Vercel. Per riaccendere: informativa privacy che lo nomina; la raccolta
 *  automatica dei clic resta comunque fuori dalle pagine con dati di terzi. */
export const POSTHOG_ACCESO: boolean = false;
