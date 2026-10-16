import { logger } from '@/lib/logger';
import { colonnaNonTrovata } from '@/lib/db/migrazione-148';
import {
  cifraDelBonificoDelReso,
  eUnBonificoDiRimborso,
  registrazioneMancanteDelBonifico,
  tabellaDeiBonificiMancante,
} from './bonifici-da-fare';
import { formatPriceFromCents } from '@/lib/format';
import { serveLaSceltaDelRimborso, type OrdineDaRimborsare } from './regole-del-rimborso';
import { MESI_DEI_MESSAGGI_DEI_CONTATTI } from '@/lib/privacy/potature-ritenzione';

/**
 * QUANTO TENIAMO L'IBAN DI UN RIMBORSO (R71, riesame del 16/10).
 *
 * Chi paga in contanti e restituisce un prodotto ci lascia l'IBAN, e noi gli
 * facciamo il bonifico a mano. Prima l'IBAN restava sul reso per sempre: dopo
 * il bonifico, dopo un reso respinto, e anche dopo che il cliente aveva
 * cancellato l'account — su una riga che non portava piu' il suo nome ma il
 * suo conto si', con l'informativa che diceva «usato solo per quel bonifico».
 *
 * LA REGOLA, in una frase: l'IBAN si tiene SOLO finche' il bonifico e' da fare,
 * perche' rimborsare e' un obbligo di legge e per farlo serve il conto.
 *
 *  · Bonifico segnato fatto → l'IBAN si cancella (lo fa la rotta che segna
 *    «fatto», e la 162 non accetta un «fatto» con l'IBAN ancora scritto).
 *  · Reso chiuso senza bonifico — respinto, annullato, rimborsato col credito
 *    o sulla carta → il bonifico non ci sara' mai, l'IBAN si cancella.
 *  · Il cliente cancella l'account con un bonifico ancora da fare → sul reso
 *    (o sul bonifico del reclamo) restano SOLO l'IBAN e il nome
 *    dell'intestatario, fino al pagamento; poi si cancellano anche quelli. Il
 *    nome va scritto li' perche' la riga ordine, a quel punto, non lo porta
 *    piu': senza un nome il bonifico non si fa.
 *  · Il cliente cancella l'account senza bonifici da fare → l'IBAN se ne va
 *    con l'account.
 *
 * La regola la possono cambiare Nicola e il legale: e' scritta qui, una volta
 * sola, e la informativa la legge da qui (`app/privacy/page.tsx`).
 */

/** Gli stati di un reso ancora in corso: il rimborso deve ancora arrivare. */
export const STATI_APERTI_DEL_RESO = ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'] as const;

/** Quello che serve sapere di un reso per decidere se il suo IBAN serve ancora. */
export interface RigaDelResoPerLIban {
  status: string | null | undefined;
  refund_id?: string | null;
  refund_method?: string | null;
  refund_bonifico_fatto_at?: string | null;
}

/**
 * Il bonifico di questo reso e' ancora da fare — adesso, o quando il reso
 * arrivera' in fondo?
 *
 *  · rimborsato col segno del bonifico e non ancora segnato fatto → si';
 *  · ancora in corso, e il cliente ha scelto il bonifico → si': quando il
 *    negozio rimborsa, il bonifico sara' dovuto;
 *  · ancora in corso SENZA una scelta, su un ordine pagato in contanti → si'
 *    (riesame del 16/10, terzo giro): nessuna scelta vuol dire bonifico, lo
 *    dicono la 162 e `comeTornanoIContanti`. Prima contava solo «BONIFICO»
 *    scritto: un reso aperto prima della 162, o da un modulo che non manda la
 *    scelta, alla cancellazione dell'account restava senza il nome di chi pagare.
 *    «In contanti» vuol dire con una parte pagata in contanti (`serveLaSceltaDelRimborso`): un
 *    ordine coperto tutto col credito MyCity torna credito (riesame del 16/10, quinto giro);
 *  · tutto il resto (fatto, respinto, annullato, credito, carta) → no.
 */
export function ilBonificoDelResoEAncoraDaFare(r: RigaDelResoPerLIban, ordineInContanti = false): boolean {
  if (r.refund_bonifico_fatto_at) return false;
  if (r.status === 'REFUNDED') return eUnBonificoDiRimborso(r.refund_id);
  if ((STATI_APERTI_DEL_RESO as readonly string[]).includes(String(r.status))) {
    return r.refund_method === 'BONIFICO' || (r.refund_method == null && ordineInContanti);
  }
  return false;
}

/** I campi che portano via il conto e il nome dal reso. */
export const IBAN_DEL_RESO_CANCELLATO = { refund_iban: null, refund_intestatario: null } as const;

/** I campi che portano via il conto e il nome dal bonifico di un reclamo. */
export const IBAN_DEL_RECLAMO_CANCELLATO = { iban: null, intestatario: null } as const;

/**
 * Il nome a cui intestare il bonifico, quando il cliente se ne va: quello che
 * ha scritto sull'ordine, se no quello del profilo. Spazi tolti; vuoto = null.
 */
export function nomeDellIntestatario(
  dallOrdine: string | null | undefined,
  dalProfilo: string | null | undefined,
): string | null {
  for (const nome of [dallOrdine, dalProfilo]) {
    const pulito = typeof nome === 'string' ? nome.replace(/\s+/g, ' ').trim() : '';
    if (pulito) return pulito;
  }
  return null;
}

// ── Le parole per chi legge: l'informativa e le impostazioni le prendono da qui ──

/** Un numero di mesi detto come lo direbbe una persona: 24 → «2 anni», 18 → «18 mesi». */
export function durataDetta(mesi: number): string {
  if (mesi % 12 === 0) return mesi === 12 ? '1 anno' : `${mesi / 12} anni`;
  return `${mesi} mesi`;
}

/** Quanto resta un messaggio dai Contatti: lo stesso numero che usa la potatura notturna. */
const QUANTO_RESTA_UN_MESSAGGIO = durataDetta(MESI_DEI_MESSAGGI_DEI_CONTATTI);

/** Dove chiediamo l'IBAN, davvero. */
export const DOVE_CHIEDIAMO_L_IBAN =
  "Nel modulo di reso, se scegli il bonifico. Per un reclamo — o se nel reso non l'hai scritto — " +
  "te lo chiediamo per email e ce lo mandi con un messaggio dalla pagina Contatti: quel messaggio " +
  `arriva anche nella casella email dell'assistenza e resta fra i messaggi dell'assistenza al massimo ${QUANTO_RESTA_UN_MESSAGGIO}. ` +
  "Chi fa il bonifico copia l'IBAN sulla richiesta di rimborso.";

/** Perché lo teniamo. */
export const PERCHE_TENIAMO_L_IBAN =
  'Obbligo di rimborsare il consumatore (Codice del Consumo, art. 56; art. 6.1.c GDPR) ed esecuzione del contratto (art. 6.1.b)';

/**
 * Quanto lo teniamo: è la regola qui sopra, detta a chi legge.
 *
 * Riesame del 16/10, terzo giro — la tabella diceva «fatto il bonifico, l'IBAN
 * si cancella» anche per l'IBAN mandato dai Contatti, che e' la strada di ogni
 * reclamo: quel messaggio invece resta fra i messaggi dell'assistenza fino alla
 * potatura notturna. Adesso la riga lo dice, con lo stesso numero della potatura.
 */
export const QUANTO_TENIAMO_L_IBAN =
  'Solo finché il bonifico è da fare. Quando il bonifico è fatto, o la richiesta si chiude senza bonifico, ' +
  "l'IBAN si cancella. Se cancelli l'account e non ti dobbiamo nessun bonifico, l'IBAN se ne va con l'account. " +
  "Se cancelli l'account mentre ti dobbiamo ancora un bonifico, sulla richiesta di rimborso restano solo " +
  "l'IBAN e il tuo nome come intestatario, fino al pagamento; poi si cancellano anche quelli. " +
  "Se l'IBAN ce lo hai mandato con un messaggio dalla pagina Contatti, quel messaggio resta fra i messaggi " +
  `dell'assistenza al massimo ${QUANTO_RESTA_UN_MESSAGGIO}, come tutti i messaggi dei Contatti, e una copia ` +
  "arriva nella casella email dell'assistenza.";

/**
 * La frase per chi sta cancellando l'account.
 *
 * Riesame del 16/10, quarto giro — anche il caso senza IBAN: la cancellazione aspetta
 * (`rinvioPerIBonificiSenzaIban`), e chi la chiede lo legge prima di premere.
 */
export const SE_CANCELLI_L_ACCOUNT_CON_UN_BONIFICO_DA_FARE =
  "Se ti dobbiamo ancora un rimborso con bonifico, sulla richiesta di rimborso restano solo il tuo IBAN e il " +
  "tuo nome, fino al pagamento; poi li cancelliamo. Se il tuo IBAN non ce l'hai ancora dato, la cancellazione " +
  "aspetta: che il reso si chiuda, se è ancora aperto, e che ci mandi l'IBAN dalla pagina Contatti, se il " +
  'bonifico è dovuto. Senza, non sapremmo come restituirti i soldi.';

/** Il motivo di rinvio della cancellazione quando a un bonifico dovuto manca l'IBAN. */
export const MOTIVO_BONIFICO_SENZA_IBAN = 'bonifico_senza_iban' as const;

/** I bonifici che gli dobbiamo, o gli dovremo, e per cui non abbiamo l'IBAN. */
export interface BonificiSenzaIban {
  /** Bonifici gia' dovuti (reso rimborsato, reclamo chiuso) senza IBAN. */
  dovuti: number;
  /** Quanto fanno, in centesimi, quando la cifra si sa. */
  centesimiDovuti: number;
  /** Vero se di ogni bonifico dovuto si sa la cifra. */
  cifreCerte: boolean;
  /** Resi ancora aperti su ordini in contanti che, se rimborsati, andranno col bonifico, senza IBAN. */
  resiInCorso: number;
}

/**
 * Riesame del 16/10, quarto giro — UN DEBITO SENZA IBAN NON SI PAGA DOPO CHE IL CLIENTE E' SPARITO.
 *
 * Prima di cancellare un account si mettono al sicuro IBAN e nome di chi aspetta un bonifico
 * (`custodisciIBonificiDaFare`). Ma il reclamo non chiede l'IBAN, e un reso puo' non averlo: in
 * quel caso, cancellato l'account, se ne andava l'unico modo di chiederglielo — l'email — e chi
 * paga si trovava «24 € da fare» con un nome e nessun conto. Adesso la cancellazione aspetta,
 * con questo motivo, che la persona legge (lo stesso canale del rinvio per la cassa contanti).
 * `null` quando non c'e' niente da aspettare.
 */
export function rinvioPerIBonificiSenzaIban(b: BonificiSenzaIban): string | null {
  if (b.dovuti <= 0 && b.resiInCorso <= 0) return null;
  const quanto = b.cifreCerte && b.centesimiDovuti > 0 ? ` di ${formatPriceFromCents(b.centesimiDovuti)}` : '';
  const frasi = ['Cancellazione rinviata:'];
  if (b.dovuti > 0) {
    frasi.push(
      `ti dobbiamo ancora un rimborso${quanto} con un bonifico, e non abbiamo il tuo IBAN. ` +
        "Mandacelo con un messaggio dalla pagina Contatti, indicando il numero dell'ordine.",
    );
  }
  // Riesame del 16/10, quinto giro — UN RESO APERTO NON SI SBLOCCA CON L'IBAN. Qui si diceva
  // «riparte quando avremo l'IBAN» anche per un reso ancora aperto: ma su un reso aperto l'IBAN non
  // ha un posto dove scriverlo (la lista dei bonifici ha solo i rimborsi fatti), e la cancellazione
  // ripartiva solo quando il negozio chiudeva il reso. Adesso la frase dice questo.
  if (b.resiInCorso > 0) {
    const resi = b.resiInCorso > 1 ? 'dei resi ancora aperti' : 'un reso ancora aperto';
    frasi.push(
      `${b.dovuti > 0 ? 'Hai anche' : 'hai'} ${resi} su un ordine pagato in contanti: se ti rimborsiamo sarà con ` +
        "un bonifico, e allora ci servirà il tuo IBAN, da mandarci dalla pagina Contatti.",
    );
  }
  frasi.push(
    b.resiInCorso > 0
      ? `La cancellazione riparte da sola quando ${b.resiInCorso > 1 ? 'i resi saranno chiusi' : 'il reso sarà chiuso'} ` +
          "e, per ogni bonifico che ti dobbiamo, avremo il tuo IBAN."
      : "La cancellazione riparte da sola quando avremo l'IBAN, o quando non ti dovremo più niente.",
  );
  return frasi.join(' ');
}

/**
 * Riesame del 16/10, quinto giro — LA STESSA ATTESA, DETTA A CHI AMMINISTRA. La rotta che cancella
 * un account dal pannello rispondeva con la frase scritta per il cliente («Mandacelo dalla pagina
 * Contatti»): a chi amministra non diceva dove si sblocca. Il bonifico dovuto e' una voce della lista
 * dei bonifici, dove l'IBAN si scrive; un reso aperto deve prima chiudersi.
 */
export const RINVIO_PER_CHI_AMMINISTRA =
  'Cancellazione rinviata: a questa persona dobbiamo un bonifico di rimborso e non abbiamo il suo IBAN, ' +
  'oppure ha un reso ancora aperto su un ordine pagato in contanti. Il bonifico dovuto lo trovi nella pagina ' +
  "«Rimborsi da bonificare»: chiedile l'IBAN e scrivilo lì. Un reso aperto deve prima chiudersi. Poi riprova.";

// ── Le scritture ─────────────────────────────────────────────────────────────

/**
 * Il client si accetta «largo» e si restringe qui dentro, come in
 * `scelta-del-reso.ts`: il tipo completo del client di Supabase, confrontato con
 * quelli stretti, manda in giro il controllore dei tipi senza fine.
 */
type ClientLargo = { from(tabella: string): unknown };
type Errore = { code?: string; message?: string } | null;
type Risposta = PromiseLike<{ data?: unknown; error: Errore }>;

/** La catena di filtri minima che usano le scritture e le letture qui sotto. */
interface Catena extends Risposta {
  eq(colonna: string, valore: unknown): Catena;
  in(colonna: string, valori: readonly unknown[]): Catena;
  is(colonna: string, valore: null): Catena;
  maybeSingle(): Risposta;
}
interface Tabella {
  select(colonne: string): Catena;
  update(valori: Record<string, unknown>): Catena;
}
const tabella = (admin: ClientLargo, nome: string) => admin.from(nome) as Tabella;

export type EsitoDellIban = 'tenuto' | 'cancellato' | 'niente-da-togliere' | 'senza-162' | 'errore';

/**
 * Dopo che un reso ha cambiato stato: se il suo bonifico non ci sara' piu',
 * l'IBAN (e il nome, se c'era) se ne vanno.
 *
 * Lo chiamano le rotte che chiudono un reso (`decide`, `avanza`). Non lancia
 * mai: un guasto qui finisce nei log e non disfa una decisione gia' presa — al
 * peggio l'IBAN resta fino al giro notturno delle potature, che lo riprende
 * (`potaLIbanDeiResiChiusi` in lib/privacy/potature-ritenzione.ts, terzo giro
 * del riesame), ma i soldi del cliente non si toccano. Senza la migrazione 162
 * non c'e' nessun IBAN da togliere.
 */
export async function dimenticaLIbanSeNonServe(
  admin: ClientLargo,
  returnId: string,
): Promise<{ esito: EsitoDellIban; errore?: string }> {
  try {
    const { data, error } = await tabella(admin, 'returns')
      .select('status, refund_id, refund_method, refund_bonifico_fatto_at, refund_iban, refund_intestatario')
      .eq('id', returnId)
      .maybeSingle();
    if (error) {
      if (colonnaNonTrovata(error)) return { esito: 'senza-162' };
      logger.error('[iban del rimborso] reso non letto: l IBAN resta per ora', { returnId, message: error.message });
      return { esito: 'errore', errore: error.message };
    }
    const riga = data as (RigaDelResoPerLIban & { refund_iban?: string | null; refund_intestatario?: string | null }) | null;
    if (!riga) return { esito: 'niente-da-togliere' };
    if (ilBonificoDelResoEAncoraDaFare(riga)) return { esito: 'tenuto' };
    if (!riga.refund_iban && !riga.refund_intestatario) return { esito: 'niente-da-togliere' };

    const { error: errScrittura } = await tabella(admin, 'returns')
      .update({ ...IBAN_DEL_RESO_CANCELLATO })
      .eq('id', returnId)
      .eq('status', String(riga.status));
    if (errScrittura) {
      if (colonnaNonTrovata(errScrittura)) return { esito: 'senza-162' };
      logger.error('[iban del rimborso] IBAN non cancellato', { returnId, message: errScrittura.message });
      return { esito: 'errore', errore: errScrittura.message };
    }
    return { esito: 'cancellato' };
  } catch (e) {
    const errore = e instanceof Error ? e.message : 'errore';
    logger.error('[iban del rimborso] IBAN non cancellato', { returnId, errore });
    return { esito: 'errore', errore };
  }
}

export type CustodiaDeiBonifici =
  | {
      ok: true;
      resiConIlNome: number;
      ibanCancellati: number;
      reclamiConIlNome: number;
      /** Riesame del 16/10, quarto giro: i bonifici da fare senza IBAN (fermano la cancellazione). */
      senzaIban: BonificiSenzaIban;
    }
  | { ok: false; errore: string };

/**
 * PRIMA DI CANCELLARE UN ACCOUNT: i bonifici che gli dobbiamo ancora.
 *
 * La cancellazione azzera il nome sugli ordini e stacca resi e bonifici dalla
 * persona. Qui, finche' il legame c'e' ancora:
 *
 *  · sui resi col bonifico ancora da fare si scrive il nome dell'intestatario,
 *    e l'IBAN resta: sono le uniche due cose che restano, fino al pagamento;
 *  · sui resi senza bonifico da fare, l'IBAN (se c'era) si cancella adesso:
 *    dopo, senza piu' il legame con la persona, non lo ritroverebbe nessuno;
 *  · sui bonifici dei reclami ancora da fare si scrive il nome.
 *
 * Se una lettura o una scrittura cade, la risposta e' «fermati»: la
 * cancellazione si rinvia e domani si riprova. Andare avanti lascerebbe un
 * debito senza nessun nome, o un conto in chiaro senza piu' un proprietario.
 */
export async function custodisciIBonificiDaFare(admin: ClientLargo, userId: string): Promise<CustodiaDeiBonifici> {
  const fermati = (perche: string): CustodiaDeiBonifici => {
    logger.error('[cancellazione] bonifici da fare non messi al sicuro', { userId, perche });
    return { ok: false, errore: perche };
  };

  try {
    // ① I resi della persona. Senza la 162 non c'e' nessun IBAN e nessun bonifico segnato.
    const resi = await tabella(admin, 'returns')
      .select('id, order_id, status, refund_id, refund_method, refund_bonifico_fatto_at, refund_iban, refund_bonifico_cents')
      .eq('buyer_id', userId);
    if (resi.error && !colonnaNonTrovata(resi.error)) return fermati(`resi: ${resi.error.message}`);
    const righeResi = (resi.error ? [] : ((resi.data ?? []) as Array<
      RigaDelResoPerLIban & {
        id: string;
        order_id: string;
        refund_iban?: string | null;
        refund_bonifico_cents?: number | null;
      }
    >));

    // ② I bonifici dei reclami ancora da fare, passando dai suoi reclami.
    let righeReclami: Array<{ dispute_id: string; order_id: string; importo_cents?: number | null; iban?: string | null }> = [];
    const reclami = await tabella(admin, 'disputes').select('id, order_id').eq('opener_id', userId);
    if (reclami.error) return fermati(`reclami: ${reclami.error.message}`);
    const idReclami = ((reclami.data ?? []) as Array<{ id: string }>).map((d) => d.id);
    if (idReclami.length > 0) {
      const bonifici = await tabella(admin, 'bonifici_dei_reclami')
        .select('dispute_id, order_id, importo_cents, iban')
        .in('dispute_id', idReclami)
        .is('fatto_at', null);
      if (bonifici.error && !tabellaDeiBonificiMancante(bonifici.error)) {
        return fermati(`bonifici dei reclami: ${bonifici.error.message}`);
      }
      righeReclami = (bonifici.error ? [] : (bonifici.data ?? [])) as typeof righeReclami;
    }

    // ③ Gli ordini della persona: il nome (letto prima che la pulizia degli ordini lo tolga), il
    // modo di pagare e l'elenco dei rimborsi registrati.
    //
    // Riesame del 16/10, quinto giro — due domande che qui avevano una risposta diversa da quella
    // di chi muove i soldi e di chi paga:
    //  · «nessuna scelta vuol dire bonifico» vale solo dove c'e' una parte pagata in contanti
    //    (`serveLaSceltaDelRimborso`, la stessa regola del modulo di reso). Un ordine «in contanti»
    //    coperto tutto col credito MyCity torna credito: il bonifico non ci sara' mai, e la
    //    cancellazione aspettava un IBAN per niente;
    //  · un reso senza il segno del rimborso, il cui bonifico sta gia' sull'ordine (la scrittura sul
    //    reso era caduta), e' un bonifico da fare con la sua cifra — come lo vede la lista dei
    //    bonifici (`registrazioneMancanteDelBonifico`). Qui contava «niente da pagare»: l'IBAN si
    //    cancellava e la cancellazione andava avanti, lasciando in lista 40 € senza conto ne' nome.
    const nomi = new Map<string, string | null>();
    const colBonificoSenzaScelta = new Set<string>();
    const ordinePer = new Map<string, { stripe_refund_id?: string | null }>();
    let nomeDelProfilo: string | null = null;
    if (righeResi.length > 0 || righeReclami.length > 0) {
      const ordini = await tabella(admin, 'orders')
        .select('id, delivery_full_name, payment_method, stripe_payment_intent, total_price, stripe_refund_id')
        .eq('user_id', userId);
      if (ordini.error) return fermati(`ordini: ${ordini.error.message}`);
      for (const o of (ordini.data ?? []) as Array<
        { id: string; delivery_full_name: string | null; stripe_refund_id?: string | null } & OrdineDaRimborsare
      >) {
        nomi.set(o.id, o.delivery_full_name);
        ordinePer.set(o.id, o);
        if (serveLaSceltaDelRimborso(o)) colBonificoSenzaScelta.add(o.id);
      }
    }

    const resiVisti = righeResi.map((r) => {
      const mancante = registrazioneMancanteDelBonifico(
        { id: r.id, status: r.status ?? null, refund_id: r.refund_id ?? null },
        ordinePer.get(r.order_id),
      );
      return mancante ? { ...r, ...mancante } : r;
    });
    const daFare = resiVisti.filter((r) => ilBonificoDelResoEAncoraDaFare(r, colBonificoSenzaScelta.has(r.order_id)));
    const daDimenticare = resiVisti.filter(
      (r) => !ilBonificoDelResoEAncoraDaFare(r, colBonificoSenzaScelta.has(r.order_id)) && r.refund_iban,
    );

    // Riesame del 16/10, quarto giro — i bonifici da fare senza IBAN: senza un conto, e senza piu'
    // l'email, il bonifico non si fa. Li conta chi chiama (`cancellaAccount`), che rinvia.
    const senzaIban: BonificiSenzaIban = { dovuti: 0, centesimiDovuti: 0, cifreCerte: true, resiInCorso: 0 };
    for (const r of daFare) {
      if (r.refund_iban) continue;
      if (r.status !== 'REFUNDED') {
        senzaIban.resiInCorso += 1;
        continue;
      }
      senzaIban.dovuti += 1;
      const cifra = cifraDelBonificoDelReso({ refund_bonifico_cents: r.refund_bonifico_cents, refund_id: r.refund_id ?? null });
      if (cifra == null) senzaIban.cifreCerte = false;
      else senzaIban.centesimiDovuti += cifra;
    }
    for (const b of righeReclami) {
      if (b.iban) continue;
      senzaIban.dovuti += 1;
      const cifra = Number(b.importo_cents ?? 0);
      if (cifra > 0) senzaIban.centesimiDovuti += Math.round(cifra);
      else senzaIban.cifreCerte = false;
    }

    // Riesame del 16/10, quinto giro — SE LA CANCELLAZIONE ASPETTA, QUI NON SI SCRIVE NIENTE. Il nome
    // dell'intestatario si scriveva prima di sapere se la cancellazione sarebbe andata avanti: col
    // rinvio l'account restava, e la lista dei bonifici mostrava il nome come quello di un cliente
    // gia' andato via. Finche' l'account c'e', il nome sta sull'ordine e l'IBAN dove era.
    if (rinvioPerIBonificiSenzaIban(senzaIban)) {
      return { ok: true, resiConIlNome: 0, ibanCancellati: 0, reclamiConIlNome: 0, senzaIban };
    }

    if (daFare.length > 0 || righeReclami.length > 0) {
      const profilo = await tabella(admin, 'profiles').select('full_name').eq('id', userId);
      if (profilo.error) return fermati(`profilo: ${profilo.error.message}`);
      nomeDelProfilo = ((profilo.data ?? []) as Array<{ full_name: string | null }>)[0]?.full_name ?? null;
    }
    const nomePer = (ordineId: string) => nomeDellIntestatario(nomi.get(ordineId), nomeDelProfilo);

    // Riesame del 16/10, terzo giro — IL NOME GIA' MESSO AL SICURO NON SI RISCRIVE. La
    // cancellazione puo' fermarsi dopo aver tolto il nome dagli ordini e ripartire la notte dopo:
    // a quel punto il nome dell'ordine e' vuoto, e riscrivere copriva «Maria Rossi» con niente.
    // Si scrive solo un nome che c'e', e solo dove un nome non c'e' ancora.
    let resiConIlNome = 0;
    for (const r of daFare) {
      const nome = nomePer(r.order_id);
      if (!nome) continue;
      const { error } = await tabella(admin, 'returns')
        .update({ refund_intestatario: nome })
        .eq('id', r.id)
        .is('refund_bonifico_fatto_at', null)
        .is('refund_intestatario', null);
      if (error) return fermati(`reso ${r.id}: ${error.message}`);
      resiConIlNome += 1;
    }
    for (const r of daDimenticare) {
      const { error } = await tabella(admin, 'returns').update({ ...IBAN_DEL_RESO_CANCELLATO }).eq('id', r.id);
      if (error) return fermati(`reso ${r.id}: ${error.message}`);
    }
    let reclamiConIlNome = 0;
    for (const b of righeReclami) {
      const nome = nomePer(b.order_id);
      if (!nome) continue;
      const { error } = await tabella(admin, 'bonifici_dei_reclami')
        .update({ intestatario: nome })
        .eq('dispute_id', b.dispute_id)
        .is('fatto_at', null)
        .is('intestatario', null);
      if (error) return fermati(`bonifico del reclamo ${b.dispute_id}: ${error.message}`);
      reclamiConIlNome += 1;
    }

    return {
      ok: true,
      resiConIlNome,
      ibanCancellati: daDimenticare.length,
      reclamiConIlNome,
      senzaIban,
    };
  } catch (e) {
    return fermati(e instanceof Error ? e.message : 'errore');
  }
}
