import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { statoFinaleDeiPermessi, type Funzione, type Vista } from './aiuti/permessi-dalle-migrazioni';

/**
 * IL GUARDIANO CHE NON SI FIDA DELL'ELENCO.
 *
 * ── Perche' esiste, e perche' non bastava la revoca ─────────────────────────────────────────────
 * Il 3/9/2026 l'advisor di sicurezza della produzione contava quattordici funzioni con i permessi
 * del creatore chiamabili da chi non ha fatto l'accesso, e sei viste che leggono coi permessi di chi
 * le ha create. Sul database ricostruito da tutte le migrazioni le funzioni erano DICIANNOVE e le
 * viste OTTO: le migrazioni scritte e non ancora applicate portano dentro le altre.
 *
 * Le migrazioni 151 e 152 chiudono i casi di oggi. Ma il difetto non e' nei diciannove nomi: e' che
 * QUI UN OGGETTO NASCE APERTO. Postgres concede EXECUTE a PUBLIC su ogni funzione nuova, e i
 * privilegi di default di Supabase concedono EXECUTE ad `anon` e SELECT sulle viste nuove. La
 * ventesima funzione nascera' aperta esattamente come le altre diciannove, e nessuno se ne
 * accorgera' — e' successo tre volte, sempre allo stesso modo:
 *   · `REVOKE … FROM anon, authenticated` senza PUBLIC: cinque righe che sembravano divieti e non lo
 *     erano (la storia sta in tests/sql/rls/10);
 *   · `REVOKE … FROM public` senza anon: `is_rider_approvato`, migrazione 114 riga 55;
 *   · `GRANT SELECT … TO authenticated` scambiato per un divieto verso gli altri:
 *     `rider_consegne_storico`, migrazione 127 riga 760, leggibile da chiunque fino alla 152.
 *
 * E il divieto non si puo' scrivere nel database: `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON
 * FUNCTIONS FROM PUBLIC` su Postgres 16 non lascia nessuna riga in `pg_default_acl` e non ha alcun
 * effetto (provato su un database vuoto). Quindi l'unico posto in cui il divieto puo' vivere e'
 * questo file. Non e' un ripiego: e' l'unica cosa che pue' fallire.
 *
 * ── Come fa a essere una prova, se le migrazioni non le applica nessuno da qui ──────────────────
 * Non cerca parole nei file. `aiuti/permessi-dalle-migrazioni.ts` rilegge tutte le migrazioni in
 * ordine e ricostruisce lo stato finale dei permessi — creazioni, revoche, concessioni, anche quelle
 * scritte dentro i cicli `DO $$` — tenendo separati i due rubinetti (PUBLIC e anon), che e'
 * esattamente il punto in cui il repo ha sbagliato tre volte. Quella ricostruzione e' stata
 * confrontata col catalogo di un Postgres 16 con tutte le migrazioni applicate: stesse funzioni,
 * stesse viste, stessi permessi, zero differenze.
 *
 * ── Cosa NON prova ─────────────────────────────────────────────────────────────────────────────
 * Che la produzione sia davvero cosi'. Le migrazioni 151 e 152 le applica Nicola: finche' non lo fa,
 * questo file dice cosa succedera', non cosa succede. La foto della produzione si prende con
 * l'advisor di Supabase; la prova che gira contro un database vero e'
 * tests/sql/rls/27-le-funzioni-potenti-non-sono-in-mano-agli-anonimi.test.sql.
 */

const MIGRAZIONI = path.resolve(process.cwd(), 'migrations');

/**
 * LE ESENZIONI. Ognuna e' una porta che lasciamo aperta al pubblico APPOSTA, e ognuna ha scritto
 * accanto perche'. Aggiungerne una si vede in una richiesta di unione: e' il contrario di una porta
 * che si apre da sola. Le regole qui sotto le tengono oneste — una funzione che SCRIVE non puo'
 * entrare in questa lista, e un nome che non esiste piu' fa diventare rosso il file.
 */
const FUNZIONI_PUBBLICHE_VOLUTE: Record<string, string> = {
  // Servono alle regole di lettura riga-per-riga: senza, il catalogo pubblico da' errore.
  // Provato sul database vero: revocando `negozio_approvato` ad anon,
  // `SELECT count(*) FROM products` come anonimo risponde «permission denied».
  is_admin: 'la richiamano 28 regole di lettura, fra cui quella di products',
  is_rider_approvato: 'la richiama la regola di lettura di orders; risponde solo su chi chiama',
  negozio_approvato: 'la richiamano le regole di lettura di products e store_reviews',
  prodotto_in_vetrina: 'la richiamano le regole di lettura di reviews e product_variants',
  // Vetrina e filtri del catalogo: chi cerca spesso non ha ancora un account.
  categorie_per_negozio: 'quali categorie tocca ogni negozio, per i filtri di app/stores',
  event_rsvp_counts: 'quante persone vanno a ogni evento, un conteggio per tutti',
  negozi_aperti_adesso: 'quali negozi sono aperti in questo momento, filtro del catalogo',
  prodotti_con_voto_almeno: 'i prodotti col voto medio minimo, filtro del catalogo',
  product_active_discounts: 'i prezzi scontati mostrati in vetrina',
  store_cards: 'le schede negozio della home e di app/near',
  store_follower_count: 'quante persone seguono un negozio: un numero, nessuna riga',
  trending_product_ids_24h: 'i piu' + " visti: solo identificativo e conteggio, mai chi ha guardato",
};

const VISTE_IN_VETRINA_VOLUTE: Record<string, string> = {
  seller_public_profiles:
    'vetrina dei negozi approvati; con security_invoker=true l elenco negozi si svuota (misurato 1 -> 0)',
  shop_of_month_leaderboard: 'classifica pubblica del negozio del mese: nome, logo e conteggio voti',
  live_activity_public: 'attivita del marketplace a blocchi di un ora, senza identificativi di ordine',
  sponsored_active_public: 'annunci a pagamento attivi, senza prezzo pagato ne conteggi',
};

/**
 * Colonne che non possono finire in una vista che legge chi non ha l'account. Sono i dati di una
 * PERSONA, non di un negozio: la ragione sociale e la partita IVA di un'attivita' stanno in vetrina
 * per legge, il nome e cognome di un cliente no. E' la regola che avrebbe fermato
 * `referral_leaderboard`, che serviva nome e cognome di cinquanta persone a chiunque.
 */
const COLONNE_DA_NON_METTERE_IN_VETRINA = [
  'full_name',
  'email',
  'user_id',
  'buyer_id',
  'voter_id',
  'delivery_full_name',
  'delivery_phone',
  'delivery_address',
  'delivery_notes',
  'fiscal_code',
  'legal_fiscal_code',
  'iban',
  'stripe_account_id',
];

const stato = statoFinaleDeiPermessi(MIGRAZIONI);
const potenti = [...stato.funzioni.values()].filter((f) => f.potente);
const descrivi = (f: Funzione): string =>
  `${f.nome} (nasce in ${f.ultimoFile}, aperta via ${f.rubinettiAperti})`;
const descriviVista = (v: Vista): string => `${v.nome} (${v.ultimoFile})`;

describe('le funzioni che girano coi permessi di chi le ha create', () => {
  it('nessuna e in mano a chi non ha fatto l accesso, se non guarda chi la chiama e non e nell elenco', () => {
    const aperte = potenti
      .filter((f) => f.anonPuoEseguire && !f.controllaChiChiama)
      .filter((f) => !(f.nome in FUNZIONI_PUBBLICHE_VOLUTE));
    expect(
      aperte.map(descrivi),
      'Una funzione coi permessi del creatore, chiamabile da chi non ha l account e che non guarda ' +
        'chi la chiama. Chiudila con «REVOKE EXECUTE ON FUNCTION public.<nome>(<tipi>) FROM PUBLIC, anon» ' +
        '— tutti e due i destinatari, o non chiude — oppure, se deve stare in vetrina, aggiungila a ' +
        'FUNZIONI_PUBBLICHE_VOLUTE scrivendo perche.',
    ).toEqual([]);
  });

  it('nessuna funzione che SCRIVE e in mano a chi non ha fatto l accesso senza un limite per chi chiama', () => {
    const scrivono = potenti.filter((f) => f.anonPuoEseguire && f.scrive && !f.controllaChiChiama);
    expect(
      scrivono.map(descrivi),
      'Questa funzione scrive su una tabella e la puo chiamare chiunque, senza account e senza ' +
        'nessun limite per chi chiama: un ciclo di richieste le fa scrivere quello che vuole. ' +
        'Era il caso di track_sponsored_click e track_sponsored_impression, che gonfiavano i clic ' +
        'degli annunci a pagamento. Nessun elenco puo esentarla.',
    ).toEqual([]);
  });

  it('l elenco delle funzioni pubbliche non contiene nessuna funzione che scrive', () => {
    const scrivono = Object.keys(FUNZIONI_PUBBLICHE_VOLUTE).filter(
      (nome) => stato.funzioni.get(nome)?.scrive,
    );
    expect(
      scrivono,
      'Una funzione che scrive non puo stare fra le porte lasciate aperte al pubblico: se serve ' +
        'davvero, mettile un tetto per chi chiama come fa sponsored_sotto_tetto.',
    ).toEqual([]);
  });

  it('l elenco delle funzioni pubbliche non tiene nomi che non esistono piu', () => {
    const fantasmi = Object.keys(FUNZIONI_PUBBLICHE_VOLUTE).filter(
      (nome) => !stato.funzioni.get(nome)?.anonPuoEseguire,
    );
    expect(
      fantasmi,
      'Questi nomi sono nell elenco delle porte aperte apposta, ma la porta non c e piu: ' +
        'togli la riga, altrimenti la prossima funzione con lo stesso nome nasce esente senza che nessuno lo decida.',
    ).toEqual([]);
  });

  it('nessuna funzione potente che SCRIVE e in mano a chi ha l account senza guardare chi la chiama', () => {
    // La superficie che l advisor chiama «31 funzioni eseguibili da authenticated»: un cliente
    // qualunque con l account le puo chiamare via /rest/v1/rpc/. Le letture sono un altro discorso
    // e non le tocchiamo qui; una SCRITTURA che non guarda chi chiama, no.
    const scrivono = potenti.filter(
      (f) => f.autenticatoPuoEseguire && f.scrive && !f.controllaChiChiama,
    );
    expect(
      scrivono.map(descrivi),
      'Scrive su una tabella, la puo chiamare qualunque persona che ha fatto l accesso, e dentro ' +
        'non guarda mai chi sia: e una scrittura in mano al primo che passa.',
    ).toEqual([]);
  });
});

describe('le viste', () => {
  const inVetrina = [...stato.viste.values()].filter((v) => v.anonPuoLeggere);

  it('nessuna vista leggibile senza account scavalca le regole di lettura, se non e nell elenco', () => {
    // Due modi di scavalcarle, e contano tutti e due: la vista senza `security_invoker`, e la vista
    // che ha `security_invoker` ma dentro chiama una funzione coi permessi del creatore — che e
    // esattamente il caso di referral_leaderboard, invisibile all advisor di Supabase.
    const scavalcano = inVetrina
      .filter((v) => !v.usaPermessiDiChiLegge || v.funzioniPotentiDentro.length > 0)
      .filter((v) => !(v.nome in VISTE_IN_VETRINA_VOLUTE));
    expect(
      scavalcano.map(descriviVista),
      'Questa vista la legge chi non ha l account e non applica le regole di lettura delle tabelle ' +
        'sotto. O la chiudi con «REVOKE ALL ON public.<nome> FROM PUBLIC, anon», o metti ' +
        'security_invoker = true se le regole sotto bastano (verifica prima che non si svuoti), o la ' +
        'aggiungi a VISTE_IN_VETRINA_VOLUTE scrivendo perche.',
    ).toEqual([]);
  });

  it('nessuna vista in vetrina mostra dati di una persona', () => {
    const colpevoli: string[] = [];
    for (const v of inVetrina) {
      for (const colonna of COLONNE_DA_NON_METTERE_IN_VETRINA) {
        if (new RegExp(`\\b${colonna}\\b`, 'i').test(v.corpo)) {
          colpevoli.push(`${v.nome}: ${colonna}`);
        }
      }
    }
    expect(
      colpevoli,
      'In vetrina — cioe leggibile da chiunque, senza account — c e una colonna che riguarda una ' +
        'persona e non un negozio. La ragione sociale e la partita IVA di un attivita ci stanno per ' +
        'legge; il nome di un cliente no.',
    ).toEqual([]);
  });

  it('ogni vista in vetrina elenca le colonne che mostra', () => {
    const conAsterisco = inVetrina.filter((v) => /select\s+(distinct\s+)?\*/i.test(v.corpo));
    expect(
      conAsterisco.map(descriviVista),
      'Una vista pubblica scritta con «SELECT *» mostra domani le colonne che qualcuno aggiungera ' +
        'alla tabella, senza che nessuno lo decida. Elenca le colonne.',
    ).toEqual([]);
  });

  it('l elenco delle viste in vetrina non tiene nomi che non esistono piu', () => {
    const fantasmi = Object.keys(VISTE_IN_VETRINA_VOLUTE).filter(
      (nome) => !stato.viste.get(nome)?.anonPuoLeggere,
    );
    expect(fantasmi, 'togli la riga: la vista non e piu in vetrina').toEqual([]);
  });
});

describe('il lettore delle migrazioni', () => {
  it('ha capito tutte le righe di permesso che ha incontrato', () => {
    // Se una migrazione futura scrive un permesso in una forma nuova, il lettore la ignorerebbe e
    // tutti i controlli qui sopra diventerebbero piu permissivi SENZA diventare rossi. Questo e il
    // controllo che se ne accorge.
    expect(
      stato.formeNonCapite,
      'righe GRANT/REVOKE che il lettore non sa interpretare: finche restano qui, i controlli di ' +
        'questo file non coprono quelle righe. Insegnagli la forma nuova in aiuti/permessi-dalle-migrazioni.ts.',
    ).toEqual([]);
  });

  it('ha trovato le funzioni e le viste che sappiamo esserci', () => {
    // Se il lettore smette di leggere (percorso sbagliato, split rotto), tutti i controlli sopra
    // diventano verdi su zero elementi. Questo li tiene onesti.
    expect(potenti.length, 'nessuna funzione potente trovata: il lettore non sta leggendo').toBeGreaterThan(50);
    expect(stato.viste.size, 'nessuna vista trovata: il lettore non sta leggendo').toBeGreaterThan(5);
  });
});
