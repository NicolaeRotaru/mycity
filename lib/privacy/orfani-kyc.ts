/**
 * LE COPIE ORFANE NEL SECCHIO DEI DOCUMENTI D'IDENTITA'.
 *
 * 1/11/2026 — Le potature notturne (potature-ritenzione.ts) tolgono dal secchio
 * `kyc-docs` solo i percorsi che il database restituisce: quelli ancora scritti
 * nel profilo quando scade la finestra. Un file che nel profilo non c'e' piu' —
 * una foto sostituita prima della correzione dello scambio, un profilo azzerato
 * mentre lo storage rifiutava la rimozione, una riga sparita — non lo restituisce
 * nessuna funzione. L'unico che elenca il secchio e' la cancellazione
 * dell'account, e solo per quella persona. Quindi quei documenti d'identita'
 * restavano per sempre (GDPR art. 5.1.e).
 *
 * Qui si fa il giro al contrario: si ELENCA il secchio, si leggono i percorsi
 * vivi nei profili, e si tolgono i file che nessuno indica piu'.
 *
 * ── LA PRUDENZA, PERCHE' QUI SI CANCELLANO CARTE D'IDENTITA' ──
 *  · L'ordine e' «prima elenco, poi riferimenti»: i riferimenti letti sono i
 *    piu' freschi, e un file caricato dopo l'elenco non entra nemmeno nel conto.
 *  · Un file piu' giovane della soglia (7 giorni) non si tocca: il caricamento
 *    scrive il file PRIMA di scrivere il profilo, e in quel buco e' orfano.
 *    Un file senza data leggibile non si tocca.
 *  · Se la lettura dei riferimenti fallisce, anche su una pagina sola, non si
 *    rimuove niente e il passo fallisce (la notte lo conta).
 *  · Se i riferimenti tornano vuoti ma il secchio ha file, non si rimuove niente
 *    e il passo fallisce: e' molto piu' probabile una lettura sbagliata (colonna
 *    rinominata, permessi) che «tutti i documenti sono orfani».
 *  · Un tetto di file rimossi per notte: il resto aspetta la notte dopo.
 *  · Prima di togliere, per ogni cartella `<uid>` si RILEGGE il profilo e si
 *    toglie solo cio' che nessuna delle sei colonne indica; se la rilettura
 *    fallisce, quella cartella non si tocca. Il secchio non e' nel backup: un
 *    documento vivo tolto per sbaglio non torna.
 */

import type { Registro } from './potature-ritenzione';

export const SECCHIO_DOCUMENTI = 'kyc-docs';

/** Le colonne del profilo che tengono il percorso di un file in `kyc-docs` (migrations/024, 135, 171). */
export const COLONNE_DOCUMENTI_KYC = [
  'kyc_id_doc_front_url',
  'kyc_id_doc_back_url',
  'kyc_selfie_url',
  'rider_license_url',
  'rider_insurance_url',
  'rider_haccp_url',
] as const;

/** Sotto questa eta' un file orfano puo' essere un caricamento a meta': non si tocca. */
export const GIORNI_DI_SICUREZZA_ORFANI = 7;
/** Quanti file al massimo si tolgono in una notte. */
export const TETTO_ORFANI_PER_NOTTE = 200;

type Errore = { message: string } | null;

/** Una voce dell'elenco dello storage: le cartelle hanno `id` nullo. */
export type VoceSecchio = {
  name: string;
  id: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/**
 * La lettura dei profili. Si pagina A CHIAVE (`gt('id', ultimo)` + `limit`) e non
 * con `range`: l'insieme filtrato cambia mentre si legge (un account cancellato,
 * una potatura che azzera le colonne), e con lo scostamento le righe scalano e
 * una salta — i suoi documenti vivi sembrerebbero orfani.
 */
type LetturaProfili = PromiseLike<{ data: Record<string, unknown>[] | null; error: Errore }> & {
  or(espressione: string): LetturaProfili;
  order(colonna: string, opzioni: { ascending: boolean }): LetturaProfili;
  gt(colonna: string, valore: string): LetturaProfili;
  eq(colonna: string, valore: string): LetturaProfili;
  limit(quante: number): LetturaProfili;
};

/** Il minimo che serve: elencare e togliere dal secchio, leggere i profili. */
export type ClienteOrfani = {
  from(tabella: string): { select(colonne: string): LetturaProfili };
  storage: {
    from(secchio: string): {
      list(
        prefisso: string,
        opzioni: { limit: number; offset: number; sortBy: { column: string; order: 'asc' | 'desc' } },
      ): PromiseLike<{ data: VoceSecchio[] | null; error: Errore }>;
      remove(percorsi: string[]): PromiseLike<{ error: Errore }>;
    };
  };
};

export type OpzioniOrfani = {
  giorniDiSicurezza?: number;
  tetto?: number;
  /** Quante voci per pagina, sia nell'elenco del secchio sia nella lettura dei profili. */
  pagina?: number;
  /**
   * 1/11/2026 — Solo conta: elenca, legge i profili e li rilegge (tutte letture),
   * ma non chiama MAI `remove`. Dice in `daTogliere` quanti file la notte toglierebbe.
   */
  soloConta?: boolean;
};

export type RiepilogoOrfani = {
  /** File elencati nel secchio. */
  listati: number;
  /** Percorsi vivi letti nei profili. */
  riferiti: number;
  /** File che nessun profilo indica (di qualunque eta'). */
  orfani: number;
  /** Orfani lasciati perche' troppo giovani o senza data. */
  recenti: number;
  /** Orfani tolti davvero (sempre 0 in «solo conta»). */
  rimossi: number;
  /** Orfani che hanno passato tutti i controlli: quelli che la notte toglie (o toglierebbe). */
  daTogliere: number;
  /** Orfani vecchi lasciati per il tetto: li prende la notte dopo. */
  rinviati: number;
  /** Sottocartelle dentro la cartella di una persona: non sono del caricamento, non si toccano. */
  cartelleSaltate: number;
  /** Orfani salvati all'ultimo controllo: il profilo, riletto, li indica (o non si e' potuto rileggere). */
  salvatiAllaRilettura: number;
};

/**
 * Dal valore della colonna al percorso nel secchio. I valori di prima del
 * passaggio a «percorso» sono URL firmate (`…/object/sign/kyc-docs/<percorso>?token=…`):
 * anche quelle indicano un file vivo, e trattarle da estranee lo farebbe sembrare orfano.
 */
export function percorsoDelRiferimento(valore: unknown): string | null {
  if (typeof valore !== 'string' || valore.trim() === '') return null;
  let percorso = valore.trim();
  if (/^https?:\/\//i.test(percorso)) {
    const segno = `/${SECCHIO_DOCUMENTI}/`;
    const i = percorso.indexOf(segno);
    if (i < 0) return null;
    percorso = percorso.slice(i + segno.length).split('?')[0];
    try {
      percorso = decodeURIComponent(percorso);
    } catch {
      /* resta com'e' */
    }
  }
  // Un valore scritto «/u1/x.jpg» o «kyc-docs/u1/x.jpg» indica lo stesso file
  // che l'elenco chiama «u1/x.jpg»: senza normalizzare sembrerebbe orfano.
  percorso = percorso.replace(/^\/+/, '');
  if (percorso.startsWith(`${SECCHIO_DOCUMENTI}/`)) percorso = percorso.slice(SECCHIO_DOCUMENTI.length + 1);
  percorso = percorso.replace(/^\/+/, '');
  return percorso || null;
}

async function elencaTutto(
  admin: ClienteOrfani,
  prefisso: string,
  pagina: number,
): Promise<VoceSecchio[]> {
  const voci: VoceSecchio[] = [];
  for (let offset = 0; ; offset += pagina) {
    const { data, error } = await admin.storage.from(SECCHIO_DOCUMENTI).list(prefisso, {
      limit: pagina,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`elenco del secchio ${SECCHIO_DOCUMENTI}/${prefisso} non letto: ${error.message}`);
    const lette = data ?? [];
    voci.push(...lette);
    if (lette.length < pagina) return voci;
  }
}

const COLONNE_LETTE = ['id', ...COLONNE_DOCUMENTI_KYC].join(', ');

function percorsiDellaRiga(riga: Record<string, unknown>, dove: Set<string>): void {
  for (const c of COLONNE_DOCUMENTI_KYC) {
    const p = percorsoDelRiferimento(riga[c]);
    if (p) dove.add(p);
  }
}

async function leggiRiferimenti(admin: ClienteOrfani, pagina: number): Promise<Set<string>> {
  const vivi = new Set<string>();
  const filtro = COLONNE_DOCUMENTI_KYC.map((c) => `${c}.not.is.null`).join(',');
  let ultimo: string | null = null;
  for (;;) {
    let q = admin.from('profiles').select(COLONNE_LETTE).or(filtro).order('id', { ascending: true });
    if (ultimo !== null) q = q.gt('id', ultimo);
    const { data, error } = await q.limit(pagina);
    if (error) throw new Error(`riferimenti ai documenti non letti: ${error.message}`);
    if (!Array.isArray(data)) throw new Error('riferimenti ai documenti non letti: il database non ha restituito righe');
    for (const riga of data) percorsiDellaRiga(riga, vivi);
    if (data.length < pagina) return vivi;
    const id = data[data.length - 1]?.id;
    if (typeof id !== 'string' || (ultimo !== null && id <= ultimo)) {
      throw new Error('riferimenti ai documenti non letti: la pagina non avanza');
    }
    ultimo = id;
  }
}

/**
 * L'ultimo controllo, cartella per cartella: rilegge il profilo della persona e
 * dice quali candidati sono ANCORA orfani. Se la rilettura fallisce, nessuno.
 */
async function ancoraOrfani(
  admin: ClienteOrfani,
  registro: Registro,
  uid: string,
  candidati: string[],
): Promise<string[]> {
  try {
    const { data, error } = await admin.from('profiles').select(COLONNE_LETTE).eq('id', uid);
    if (error || !Array.isArray(data)) {
      registro.warn('[cron-deletions] orfani kyc: profilo non riletto, non si tocca niente', {
        uid, err: error?.message ?? 'nessuna riga restituita',
      });
      return [];
    }
    const vivi = new Set<string>();
    for (const riga of data) percorsiDellaRiga(riga, vivi);
    return candidati.filter((p) => !vivi.has(p));
  } catch (e) {
    registro.warn('[cron-deletions] orfani kyc: profilo non riletto, non si tocca niente', {
      uid, err: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

function etaDelFile(voce: VoceSecchio): number | null {
  const tempi = [voce.created_at, voce.updated_at]
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter((t) => Number.isFinite(t));
  return tempi.length > 0 ? Math.max(...tempi) : null;
}

/**
 * Toglie dal secchio `kyc-docs` i file che nessun profilo indica piu' e che
 * hanno piu' della soglia di sicurezza. LANCIA se non puo' decidere con
 * certezza o se lo storage rifiuta: chi la chiama la conta come fallita.
 */
export async function potaOrfaniKyc(
  admin: ClienteOrfani,
  registro: Registro,
  adessoMs: number,
  opzioni: OpzioniOrfani = {},
): Promise<RiepilogoOrfani> {
  const giorni = opzioni.giorniDiSicurezza ?? GIORNI_DI_SICUREZZA_ORFANI;
  const tetto = opzioni.tetto ?? TETTO_ORFANI_PER_NOTTE;
  const pagina = opzioni.pagina ?? 100;
  const limite = adessoMs - giorni * 86_400_000;

  // ① L'elenco del secchio: cartelle per persona, file dentro.
  const file: Array<{ percorso: string; eta: number | null }> = [];
  let cartelleSaltate = 0;
  for (const voce of await elencaTutto(admin, '', pagina)) {
    if (voce.id !== null) {
      file.push({ percorso: voce.name, eta: etaDelFile(voce) });
      continue;
    }
    for (const dentro of await elencaTutto(admin, voce.name, pagina)) {
      if (dentro.id === null) { cartelleSaltate += 1; continue; }
      file.push({ percorso: `${voce.name}/${dentro.name}`, eta: etaDelFile(dentro) });
    }
  }

  // ② I riferimenti vivi, letti DOPO l'elenco.
  const vivi = await leggiRiferimenti(admin, pagina);
  if (vivi.size === 0 && file.length > 0) {
    throw new Error(
      `nessun riferimento ai documenti nei profili ma ${file.length} file nel secchio ${SECCHIO_DOCUMENTI}: ` +
        'potatura degli orfani ferma per prudenza',
    );
  }

  // ③ Gli orfani, e tra loro quelli abbastanza vecchi; i piu' vecchi per primi.
  const orfani = file.filter((f) => !vivi.has(f.percorso));
  const maturi = orfani
    .filter((f): f is { percorso: string; eta: number } => f.eta !== null && f.eta < limite)
    .sort((a, b) => a.eta - b.eta);
  const scelti = maturi.slice(0, tetto).map((f) => f.percorso);

  // ③-bis L'ultimo controllo prima di togliere: si rilegge il profilo della
  // cartella. Un file fuori da una cartella non ha un profilo da rileggere: resta.
  const perCartella = new Map<string, string[]>();
  for (const p of scelti) {
    const i = p.indexOf('/');
    if (i <= 0) continue;
    const uid = p.slice(0, i);
    perCartella.set(uid, [...(perCartella.get(uid) ?? []), p]);
  }
  const daTogliere: string[] = [];
  for (const [uid, candidati] of perCartella) {
    daTogliere.push(...(await ancoraOrfani(admin, registro, uid, candidati)));
  }

  // ④ La rimozione, a gruppi. In «solo conta» non si arriva a chiamare lo storage.
  let rimossi = 0;
  const rifiutati: string[] = [];
  for (let i = 0; !opzioni.soloConta && i < daTogliere.length; i += pagina) {
    const gruppo = daTogliere.slice(i, i + pagina);
    const { error } = await admin.storage.from(SECCHIO_DOCUMENTI).remove(gruppo);
    if (error) {
      registro.warn('[cron-deletions] orfani kyc non rimossi', { err: error.message, percorsi: gruppo });
      rifiutati.push(...gruppo);
      continue;
    }
    rimossi += gruppo.length;
  }

  const riepilogo: RiepilogoOrfani = {
    listati: file.length,
    riferiti: vivi.size,
    orfani: orfani.length,
    recenti: orfani.length - maturi.length,
    rimossi,
    daTogliere: daTogliere.length,
    rinviati: maturi.length - scelti.length,
    cartelleSaltate,
    salvatiAllaRilettura: scelti.length - daTogliere.length,
  };
  // 1/11/2026 — Se la rilettura ha salvato qualcosa, la lettura generale ha
  // mancato riferimenti vivi: senza l'ultimo controllo sarebbero spariti
  // documenti veri. Non e' una notizia, e' un campanello.
  if (riepilogo.salvatiAllaRilettura > 0) {
    registro.warn(
      '[cron-deletions] orfani kyc: la lettura dei profili ha mancato riferimenti vivi, salvati solo dalla rilettura',
      riepilogo,
    );
  } else {
    registro.info('[cron-deletions] orfani del secchio kyc-docs', riepilogo);
  }
  if (rifiutati.length > 0) {
    throw new Error(`${rifiutati.length} orfani non rimossi dal secchio ${SECCHIO_DOCUMENTI}`);
  }
  return riepilogo;
}
