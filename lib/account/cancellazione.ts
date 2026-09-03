import type { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

type Admin = ReturnType<typeof getAdminSupabase>;

/**
 * Cancellare un account: una pipeline sola, per tutte le strade.
 *
 * Il difetto (#178). Le cancellazioni erano due, scritte in due file diversi, e
 * facevano cose diverse:
 *
 *   · quella del cron (richiesta dalla persona, dopo i 30 giorni) anonimizzava
 *     il profilo, i dati di verifica identità, il testo libero, cancellava i
 *     file dallo storage e toglieva l'iscrizione alla newsletter;
 *   · quella dell'amministratore anonimizzava il profilo e basta. Carta
 *     d'identità e selfie restavano nello storage, le recensioni col nome
 *     dentro restavano, la newsletter continuava ad arrivare.
 *
 * Due strade per la stessa promessa — «i tuoi dati vengono cancellati» — e una
 * delle due non la manteneva. Chi la sceglie non lo decide la persona: dipende
 * da chi preme il pulsante.
 *
 * Ora la pipeline è questa, e la chiamano tutte e due.
 */

/** Campi di vetrina e anagrafica: si azzerano sempre. */
export const CAMPI_PROFILO_DA_AZZERARE = {
  full_name: null,
  phone: null,
  address: null,
  city: null,
  zip: null,
  avatar_url: null,
  store_name: null,
  store_address: null,
  store_phone: null,
  store_lat: null,
  store_lng: null,
  store_logo: null,
  store_media: null,
  store_description: null,
  is_approved: false,
  role: 'buyer',
} as const;

/** Dati di verifica identità e pagamento: si azzerano sempre, anche nel ripiego. */
export const CAMPI_KYC_DA_AZZERARE = {
  legal_first_name: null,
  legal_last_name: null,
  legal_fiscal_code: null,
  legal_birth_date: null,
  legal_residence_addr: null,
  legal_residence_city: null,
  legal_residence_zip: null,
  business_legal_name: null,
  business_vat_number: null,
  business_address: null,
  business_city: null,
  business_zip: null,
  business_pec: null,
  business_sdi: null,
  billing_iban: null,
  billing_card_last4: null,
  approval_status: 'rejected',
  kyc_id_doc_front_url: null,
  kyc_id_doc_back_url: null,
  kyc_selfie_url: null,
  rider_license_url: null,
  rider_insurance_url: null,
  rider_haccp_url: null,
} as const;

/**
 * Secchi dello storage che possono contenere file personali.
 *
 * 27/8/2026 (R057) — «reviews» mancava, ed era il peggiore dei tre.
 * Gli altri due sono secchi privati: il file resta lì ma nessuno lo raggiunge
 * dal web. Quello delle recensioni è PUBBLICO (migrations/039), quindi la foto
 * caricata insieme alla recensione è visibile a chiunque ne conosca
 * l'indirizzo. Dopo «cancella account» il commento spariva e la fotografia
 * restava online per sempre: l'unico dato ancora visibile dall'esterno era
 * proprio quello che sopravviveva alla cancellazione.
 */
export const SECCHI_CON_FILE_PERSONALI = ['kyc-docs', 'cod-proof', 'reviews'] as const;

/**
 * L'ELENCO UNICO delle tabelle che tengono dati personali, e di cosa si azzera
 * in ognuna quando una persona chiede di essere cancellata.
 *
 * 3/9/2026 — IL BUONO REGALO NON ERA IN NESSUN ELENCO.
 *
 * Chi compra un buono regalo scrive nome, indirizzo email e un messaggio del
 * DESTINATARIO: una persona che non si e' mai iscritta, non ha mai letto la
 * nostra informativa e non sa nemmeno che il suo indirizzo e' da noi. Le
 * tabelle da ripulire erano elencate a mano, una riga di codice per ognuna,
 * quindi ogni tabella nata dopo nasceva fuori dall'elenco. `gift_cards` non
 * c'era: cancellato Marco che aveva comprato il regalo, restavano «Chiara
 * Rossi», la sua email e la frase «Buon compleanno, ti aspetto da Pane
 * Quotidiano!», senza piu' nemmeno il legame con chi le aveva scritte.
 *
 * Adesso l'elenco e' un dato: si legge, si percorre e una prova lo esegue
 * tutto. Una tabella nuova si aggiunge QUI, in un posto solo, e se la si
 * dimentica la dimenticanza si vede.
 *
 * `sopravvive` e' il campo che conta, ed e' quello facile da sbagliare: dice
 * se la riga RESTA quando l'utente viene cancellato (chiave esterna ON DELETE
 * SET NULL) invece di sparire insieme a lui (ON DELETE CASCADE). Le righe che
 * sopravvivono vanno ripulite PRIMA della cancellazione: dopo, la colonna che
 * le legava alla persona vale NULL e non le ritrova piu' nessuno.
 */
export type TabellaConDatiPersonali = {
  /** La tabella. */
  tabella: string;
  /** La colonna che lega la riga alla persona. */
  colonna: string;
  /** I campi da azzerare, col valore che devono prendere. */
  azzera: Record<string, unknown>;
  /** La riga resta in vita dopo la cancellazione dell'utente (SET NULL)? */
  sopravvive: boolean;
  /** Cosa si perde se questa riga non viene ripulita. Serve a chi legge. */
  perche: string;
};

export const TABELLE_CON_DATI_PERSONALI: readonly TabellaConDatiPersonali[] = [
  {
    tabella: 'reviews',
    colonna: 'user_id',
    azzera: { comment: null, photo_urls: [] },
    // migrations/001: reviews.user_id -> auth.users ON DELETE SET NULL.
    sopravvive: true,
    perche: 'la recensione resta in vetrina, col testo e le foto di chi se n\'e\' andato',
  },
  {
    tabella: 'store_reviews',
    colonna: 'user_id',
    azzera: { comment: null, photo_urls: [] },
    // migrations/014: ON DELETE CASCADE, la riga se ne va con l'utente.
    sopravvive: false,
    perche: 'testo e foto della recensione al negozio',
  },
  {
    tabella: 'rider_reviews',
    colonna: 'user_id',
    // Questa tabella non ha la colonna delle foto (nasce in migrations/014 e
    // nessuna migrazione gliela aggiunge): chiederne l'azzeramento farebbe
    // respingere tutto l'aggiornamento e resterebbe anche il commento.
    azzera: { comment: null },
    sopravvive: false,
    perche: 'il giudizio scritto al fattorino',
  },
  {
    tabella: 'returns',
    colonna: 'buyer_id',
    azzera: { notes: null },
    sopravvive: false,
    perche: 'le note scritte a mano dentro una richiesta di reso',
  },
  {
    tabella: 'messages',
    colonna: 'sender_id',
    azzera: { body: '[messaggio rimosso]' },
    sopravvive: false,
    perche: 'i messaggi in chat col negozio',
  },
  {
    tabella: 'contact_messages',
    colonna: 'user_id',
    azzera: { name: '[eliminato]', email: '[eliminato]', message: '[rimosso]' },
    // migrations/028: contact_messages.user_id -> profiles ON DELETE SET NULL.
    // La riga sopravvive: se non la si ripulisce prima, nome, email e testo
    // restano in chiaro e senza piu' un proprietario a cui ricondurli.
    sopravvive: true,
    perche: 'nome, email e testo scritti dal modulo dei contatti',
  },
  {
    tabella: 'gift_cards',
    colonna: 'buyer_id',
    // Si azzerano SOLO i dati del destinatario: la riga resta e il credito
    // resta spendibile, perche' quei soldi sono stati pagati e la persona che
    // ha ricevuto il regalo non c'entra niente con chi cancella l'account.
    azzera: { recipient_name: null, recipient_email: null, message: null },
    // migrations/030: gift_cards.buyer_id -> profiles ON DELETE SET NULL.
    sopravvive: true,
    perche: 'nome, email e messaggio del destinatario, che non e\' nemmeno nostro cliente',
  },
  {
    // La stessa riga, vista dall'altra parte. Se il destinatario si iscrive e
    // riscatta il buono diventa lui `redeemed_by`, e il giorno che chiede di
    // essere cancellato il suo nome e la sua email restano scritti nella riga
    // del regalo: la ripulisce solo chi lo ha comprato. Il credito ormai è nel
    // suo portafoglio, quei tre campi non servono più a niente.
    tabella: 'gift_cards',
    colonna: 'redeemed_by',
    azzera: { recipient_name: null, recipient_email: null, message: null },
    sopravvive: true,
    perche: 'nome, email e messaggio di chi ha riscattato il regalo e poi ha chiesto di sparire',
  },
];

/**
 * Cancella i file dell'utente dallo storage.
 *
 * Azzerare la colonna che punta al file NON cancella il file: le carte
 * d'identità e i selfie restavano nello storage per sempre.
 */
export async function cancellaFilePersonali(
  admin: Admin,
  userId: string,
): Promise<{ rimossi: number; errori: string[] }> {
  let rimossi = 0;
  const errori: string[] = [];

  for (const secchio of SECCHI_CON_FILE_PERSONALI) {
    try {
      const { data: elenco, error } = await admin.storage.from(secchio).list(userId, { limit: 1000 });
      if (error) { errori.push(`${secchio}: ${error.message}`); continue; }
      if (!elenco || elenco.length === 0) continue;

      // Un livello di sottocartelle (per esempio cod-proof/<utente>/<ordine>/).
      const percorsi: string[] = [];
      for (const voce of elenco) {
        if (voce.id === null) {
          const { data: dentro } = await admin.storage
            .from(secchio)
            .list(`${userId}/${voce.name}`, { limit: 1000 });
          for (const f of dentro ?? []) percorsi.push(`${userId}/${voce.name}/${f.name}`);
        } else {
          percorsi.push(`${userId}/${voce.name}`);
        }
      }
      if (percorsi.length === 0) continue;

      const { error: errRimozione } = await admin.storage.from(secchio).remove(percorsi);
      if (errRimozione) errori.push(`${secchio}: ${errRimozione.message}`);
      else rimossi += percorsi.length;
    } catch (e) {
      errori.push(`${secchio}: ${e instanceof Error ? e.message : 'errore'}`);
    }
  }
  return { rimossi, errori };
}

/**
 * Toglie le prove di consegna degli ordini di questa persona.
 *
 * 27/8/2026 (R058) — LA FOTO DI CASA SUA STAVA NELLA CARTELLA DI UN ALTRO.
 *
 * Alla consegna in contanti il fattorino carica due fotografie — i contanti e
 * «il pacco lasciato», cioe' quasi sempre l'ingresso dell'abitazione — piu' la
 * firma per ricevuta. Vanno nel secchio `cod-proof`, nella cartella del
 * FATTORINO: `<fattorino>/<ordine>/…`.
 *
 * `cancellaFilePersonali` elenca la cartella della persona che sta cancellando
 * l'account, e in `cod-proof/<cliente>` non c'e' mai stato niente. Cosi' la
 * fotografia della porta di casa di chi se n'e' andato restava li' per sempre,
 * in una cartella intestata a qualcun altro: il posto dove nessuno l'avrebbe
 * mai cercata.
 *
 * Qui si parte dai suoi ordini, che e' l'unico filo che porta a quei file.
 * Prima si tolgono i file, poi si azzerano le colonne: al peggio resta una
 * colonna che punta al vuoto, mai una riga che promette una prova sparita.
 */
export async function cancellaProveDiConsegna(
  admin: Admin,
  userId: string,
): Promise<{ rimossi: number; errori: string[] }> {
  const errori: string[] = [];
  let rimossi = 0;
  try {
    const { data: ordini, error } = await admin
      .from('orders')
      .select('id, cash_photo_url, delivery_photo_url, cash_signature_url')
      .eq('user_id', userId);
    if (error) return { rimossi: 0, errori: [`orders: ${error.message}`] };

    for (const ordine of (ordini ?? []) as Array<{
      id: string;
      cash_photo_url: string | null;
      delivery_photo_url: string | null;
      cash_signature_url: string | null;
    }>) {
      const percorsi = [ordine.cash_photo_url, ordine.delivery_photo_url, ordine.cash_signature_url]
        .filter((p): p is string => typeof p === 'string' && p.length > 0);
      if (percorsi.length === 0) continue;

      const { error: errRimozione } = await admin.storage.from('cod-proof').remove(percorsi);
      if (errRimozione) {
        errori.push(`cod-proof: ${errRimozione.message}`);
        continue;
      }
      rimossi += percorsi.length;
      await admin
        .from('orders')
        .update({ cash_photo_url: null, delivery_photo_url: null, cash_signature_url: null })
        .eq('id', ordine.id);
    }
  } catch (e) {
    errori.push(`prove di consegna: ${e instanceof Error ? e.message : 'errore'}`);
  }
  return { rimossi, errori };
}

/**
 * La stessa scrittura su tabelle diverse, scelte a runtime.
 *
 * I tipi generati del database pretendono il nome della tabella scritto come
 * letterale (`from('reviews')`), perché è da lì che ricavano le colonne. Qui
 * la tabella arriva dall'elenco, quindi il nome è una stringa e basta: questa
 * è la forma minima che serve — scrivi questi campi dove questa colonna vale
 * l'identificativo della persona — e la usa solo questo file.
 */
type ScritturaPerNome = {
  from(tabella: string): {
    update(valori: Record<string, unknown>): {
      eq(colonna: string, valore: string): PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

function scritturaPerNome(admin: Admin): ScritturaPerNome {
  return admin as unknown as ScritturaPerNome;
}

/**
 * Anonimizza il testo libero scritto dalla persona (recensioni, note, chat) e
 * i dati di terzi che ha lasciato da noi (il destinatario di un buono regalo).
 *
 * Non decide più niente da sé: percorre `TABELLE_CON_DATI_PERSONALI`, che è
 * l'unico elenco. Prima le tabelle erano scritte qui una per una, ed è così
 * che i buoni regalo sono rimasti fuori per un anno.
 *
 * 27/8/2026 (R057) — le recensioni perdevano il commento e tenevano le foto.
 * Azzerare `comment` e lasciare `photo_urls` vuol dire lasciare in vetrina
 * l'unica parte della recensione che si vede anche senza account. Le foto si
 * staccano qui e i file si cancellano in `cancellaFilePersonali`: la colonna
 * senza il file è una riga che punta al vuoto, il file senza la colonna è una
 * fotografia che nessuno sa più di avere.
 *
 * `rider_reviews` non ha la colonna delle foto (nasce in migrations/014 e
 * nessuna migrazione gliela aggiunge): chiederne l'azzeramento farebbe
 * respingere tutto l'aggiornamento e resterebbe anche il commento.
 */
export async function anonimizzaTestoLibero(admin: Admin, userId: string): Promise<void> {
  await Promise.all(
    TABELLE_CON_DATI_PERSONALI.map((t) => scritturaPerNome(admin).from(t.tabella).update(t.azzera).eq(t.colonna, userId)),
  ).catch((e) => logger.warn('[cancellazione] anonimizzazione testo libero parziale', { userId, e }));
}

/**
 * Toglie l'iscrizione alla newsletter, che vive per indirizzo email e non per
 * profilo. L'email va letta PRIMA di cancellare l'utente: dopo non esiste più.
 */
export async function togliDallaNewsletter(admin: Admin, userId: string): Promise<void> {
  try {
    const { data: utenteAuth } = await admin.auth.admin.getUserById(userId);
    const emailUtente = utenteAuth?.user?.email ?? null;
    if (!emailUtente) return;
    const { error } = await admin.from('newsletter_subscribers').delete().ilike('email', emailUtente);
    if (error) logger.warn('[cancellazione] newsletter non ripulita', { userId, err: error.message });
  } catch (e) {
    logger.warn('[cancellazione] lettura email per la newsletter fallita', { userId, e });
  }
}

/**
 * I dati di verifica identità e di pagamento: si azzerano SUBITO.
 *
 * Sono carta d'identità, codice fiscale, IBAN. Nessuno li vede a video, quindi
 * toglierli non rompe niente per chi sta ancora usando il sito: si tolgono
 * prima, e se poi la cancellazione dell'account non riesce almeno questi non
 * sono più lì.
 */
export async function anonimizzaDatiSensibili(admin: Admin, userId: string): Promise<{ ok: boolean; errore?: string }> {
  const { error } = await admin.from('profiles').update(CAMPI_KYC_DA_AZZERARE).eq('id', userId);
  if (error) {
    logger.warn('[cancellazione] dati di verifica identità non tutti azzerati', { userId, err: error.message });
    return { ok: false, errore: error.message };
  }
  return { ok: true };
}

/**
 * I dati di vetrina e anagrafica: si azzerano SOLO DOPO che l'account è
 * sparito davvero.
 *
 * 3/9/2026 — IL PROFILO SVUOTATO CON L'ACCOUNT ANCORA VIVO.
 *
 * Questo passo era il primo della catena, e l'ultimo — la cancellazione vera
 * dell'account — non riusciva mai per chi avesse almeno un ordine. Risultato:
 * Maria Rossi chiedeva di sparire, sette giorni dopo il suo profilo era vuoto
 * e il suo account funzionava ancora; per un negozio spariva il nome mentre la
 * vetrina restava online. E siccome la richiesta restava aperta, la notte dopo
 * si riprovava, si rifalliva, e nessuno se ne accorgeva.
 *
 * Adesso questa riga si scrive solo dopo che `deleteUser` ha detto di sì. Se
 * la cancellazione non riesce, la persona resta con un account intero e la
 * richiesta viene ritentata: non le abbiamo tolto niente a metà.
 *
 * Nota: la riga del profilo punta a `auth.users` con ON DELETE CASCADE
 * (migrations/001), quindi cancellato l'utente questa riga di solito non
 * esiste più e l'aggiornamento non tocca nulla. Resta qui come rete: se un
 * giorno quel vincolo cambiasse, i dati non rimarrebbero comunque in chiaro.
 */
export async function anonimizzaProfilo(admin: Admin, userId: string): Promise<{ ok: boolean; errore?: string }> {
  const { error } = await admin.from('profiles').update(CAMPI_PROFILO_DA_AZZERARE).eq('id', userId);
  if (error) return { ok: false, errore: error.message };
  return { ok: true };
}

/**
 * La cassa contanti di un fattorino: quanto ha incassato per le consegne e non
 * ha ancora versato.
 *
 * 3/9/2026 — CANCELLARE IL FATTORINO CANCELLAVA IL SUO DEBITO.
 *
 * `cod_reconciliations` è il registro della cassa: una riga per ogni giornata,
 * con quanto è entrato in contanti e se è stato versato. Quella riga punta
 * all'utente con ON DELETE CASCADE, cioè sparisce insieme a lui. Un fattorino
 * con 120 euro incassati il sabato che chiedeva la cancellazione la domenica,
 * sette giorni dopo non risultava più dovere niente a nessuno: nessun ammanco,
 * nessun sollecito, i soldi semplicemente non erano mai esistiti.
 *
 * Qui la cancellazione si ferma prima di toccare qualunque cosa. Non è un no
 * per sempre: appena il versamento è registrato, la notte dopo riparte da sola.
 * I contanti di altri sono soldi altrui, e un obbligo di legge a cancellare non
 * cancella un debito (art. 17.3 GDPR: conservazione per obblighi contabili e
 * per far valere un diritto).
 *
 * Se il controllo non riesce, la risposta è «fermati». Su una cassa, non
 * sapere vale quanto sapere di sì: il rischio di rinviare una cancellazione di
 * un giorno è piccolo, quello di cancellare per sbaglio la prova di un debito
 * non si ripara.
 */
export type CassaContanti = {
  /** La cancellazione va fermata? */
  bloccante: boolean;
  /** Quanto risulta ancora da versare, in centesimi. */
  centesimi: number;
  /** Quante giornate di cassa sono ancora aperte. */
  giornate: number;
  /** La spiegazione, in parole che leggono sia la persona sia l'amministratore. */
  motivo: string;
};

export async function contantiAncoraDaVersare(admin: Admin, userId: string): Promise<CassaContanti> {
  const nonVerificabile = (perche: string): CassaContanti => ({
    bloccante: true,
    centesimi: 0,
    giornate: 0,
    motivo: `Non siamo riusciti a controllare la cassa contanti, quindi la cancellazione è rinviata: ${perche}`,
  });

  let data: unknown;
  try {
    const risposta = await admin
      .from('cod_reconciliations')
      .select('for_date, collected_cents, status, remitted_at')
      .eq('rider_id', userId);
    if (risposta.error) return nonVerificabile(risposta.error.message);
    data = risposta.data;
  } catch (e) {
    return nonVerificabile(e instanceof Error ? e.message : 'errore');
  }

  const righe = (data ?? []) as Array<{
    for_date: string;
    collected_cents: number | null;
    status: string | null;
    remitted_at: string | null;
  }>;

  // Aperta = i contanti non risultano versati, e o c'è del denaro incassato o
  // la giornata non quadra (un ammanco da chiarire).
  const aperte = righe.filter(
    (r) => r.remitted_at == null && ((r.collected_cents ?? 0) > 0 || r.status === 'MISMATCH'),
  );
  if (aperte.length === 0) return { bloccante: false, centesimi: 0, giornate: 0, motivo: '' };

  const centesimi = aperte.reduce((somma, r) => somma + (r.collected_cents ?? 0), 0);
  const euro = (centesimi / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const giornate = aperte.length;
  return {
    bloccante: true,
    centesimi,
    giornate,
    motivo:
      `Cancellazione rinviata: risultano ${euro} € di contanti incassati alle consegne e non ancora versati ` +
      `(${giornate} ${giornate === 1 ? 'giornata' : 'giornate'} di cassa). ` +
      `Appena il versamento è registrato la cancellazione riparte da sola.`,
  };
}

export type EsitoCancellazione = {
  ok: boolean;
  errore?: string;
  /** Perché non si è fatto, quando la ragione non è un guasto ma una regola. */
  motivo?: 'cassa_da_versare';
  fileRimossi: number;
  erroriFile: string[];
};

/**
 * La cancellazione completa di un account, nell'ordine giusto.
 *
 * L'ordine non è un dettaglio, ed è dove questa funzione si era rotta due
 * volte. La regola, adesso, è una sola frase: **prima si tolgono le cose che
 * dopo non si ritrovano più, poi si chiude l'account, e solo alla fine si
 * svuota il profilo.**
 *
 * ① Ciò che deve sopravvivere alla cancellazione (i contanti da versare) la
 *    ferma prima che parta: non si distrugge il registro di un debito.
 * ② I dati che si raggiungono SOLO passando dal legame con la persona — le
 *    recensioni, il buono regalo, l'iscrizione alla newsletter, le foto della
 *    consegna che stanno nella cartella del fattorino — vanno tolti finché
 *    quel legame esiste. Dopo la cancellazione quelle colonne valgono NULL e
 *    nessuno le ritrova più: è per questo che «prima cancella, poi pulisci»
 *    sarebbe stata la riparazione peggiore del difetto.
 * ③ La cancellazione dell'account: il passo che può fallire.
 * ④ Il profilo (nome, indirizzo, nome del negozio) solo se il ③ è riuscito.
 */
export async function cancellaAccount(admin: Admin, userId: string): Promise<EsitoCancellazione> {
  // ① Prima di toccare qualsiasi cosa: i soldi degli altri.
  const cassa = await contantiAncoraDaVersare(admin, userId);
  if (cassa.bloccante) {
    logger.error('[cancellazione] rinviata: cassa contanti ancora aperta', {
      userId, centesimi: cassa.centesimi, giornate: cassa.giornate,
    });
    return { ok: false, motivo: 'cassa_da_versare', errore: cassa.motivo, fileRimossi: 0, erroriFile: [] };
  }

  // ② I documenti d'identità e l'IBAN non aspettano: non si vedono a video,
  // toglierli non lascia nessuno con un account a metà.
  await anonimizzaDatiSensibili(admin, userId);

  await anonimizzaTestoLibero(admin, userId);
  await togliDallaNewsletter(admin, userId);

  const file = await cancellaFilePersonali(admin, userId);
  if (file.errori.length > 0) {
    logger.warn('[cancellazione] file personali non tutti rimossi', { userId, errori: file.errori });
  }

  // Le prove di consegna stanno nella cartella del fattorino: si arriva a
  // quelle di questa persona solo passando dai suoi ordini (R058).
  const prove = await cancellaProveDiConsegna(admin, userId);
  if (prove.errori.length > 0) {
    logger.warn('[cancellazione] prove di consegna non tutte rimosse', { userId, errori: prove.errori });
  }

  // ③ Il passo che può fallire. Fin qui non abbiamo toccato niente di ciò che
  // la persona vede: se va male, il suo account resta intero e la richiesta
  // viene ritentata.
  const { error: errAuth } = await admin.auth.admin.deleteUser(userId);
  if (errAuth) {
    return {
      ok: false,
      errore: `L'account non è stato cancellato: ${errAuth.message}`,
      fileRimossi: file.rimossi + prove.rimossi,
      erroriFile: [...file.errori, ...prove.errori],
    };
  }

  // ④ L'account non c'è più: adesso il profilo può sparire.
  const profilo = await anonimizzaProfilo(admin, userId);
  if (!profilo.ok) {
    logger.error('[cancellazione] account cancellato ma profilo non ripulito', { userId, err: profilo.errore });
  }

  return {
    ok: true,
    fileRimossi: file.rimossi + prove.rimossi,
    erroriFile: [...file.errori, ...prove.errori],
  };
}
