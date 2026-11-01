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

type LetturaProfili = {
  or(espressione: string): LetturaProfili;
  order(colonna: string, opzioni: { ascending: boolean }): LetturaProfili;
  range(da: number, a: number): PromiseLike<{ data: Record<string, unknown>[] | null; error: Errore }>;
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
  /** Orfani tolti davvero. */
  rimossi: number;
  /** Orfani vecchi lasciati per il tetto: li prende la notte dopo. */
  rinviati: number;
  /** Sottocartelle dentro la cartella di una persona: non sono del caricamento, non si toccano. */
  cartelleSaltate: number;
};

/**
 * Dal valore della colonna al percorso nel secchio. I valori di prima del
 * passaggio a «percorso» sono URL firmate (`…/object/sign/kyc-docs/<percorso>?token=…`):
 * anche quelle indicano un file vivo, e trattarle da estranee lo farebbe sembrare orfano.
 */
export function percorsoDelRiferimento(valore: unknown): string | null {
  if (typeof valore !== 'string' || valore.trim() === '') return null;
  if (!/^https?:\/\//i.test(valore)) return valore;
  const segno = `/${SECCHIO_DOCUMENTI}/`;
  const i = valore.indexOf(segno);
  if (i < 0) return null;
  const resto = valore.slice(i + segno.length).split('?')[0];
  try {
    return decodeURIComponent(resto) || null;
  } catch {
    return resto || null;
  }
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

async function leggiRiferimenti(admin: ClienteOrfani, pagina: number): Promise<Set<string>> {
  const vivi = new Set<string>();
  const filtro = COLONNE_DOCUMENTI_KYC.map((c) => `${c}.not.is.null`).join(',');
  for (let da = 0; ; da += pagina) {
    const { data, error } = await admin
      .from('profiles')
      .select(['id', ...COLONNE_DOCUMENTI_KYC].join(', '))
      .or(filtro)
      .order('id', { ascending: true })
      .range(da, da + pagina - 1);
    if (error) throw new Error(`riferimenti ai documenti non letti: ${error.message}`);
    if (!Array.isArray(data)) throw new Error('riferimenti ai documenti non letti: il database non ha restituito righe');
    for (const riga of data) {
      for (const c of COLONNE_DOCUMENTI_KYC) {
        const p = percorsoDelRiferimento(riga[c]);
        if (p) vivi.add(p);
      }
    }
    if (data.length < pagina) return vivi;
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
  const daTogliere = maturi.slice(0, tetto).map((f) => f.percorso);

  // ④ La rimozione, a gruppi.
  let rimossi = 0;
  const rifiutati: string[] = [];
  for (let i = 0; i < daTogliere.length; i += pagina) {
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
    rinviati: maturi.length - daTogliere.length,
    cartelleSaltate,
  };
  registro.info('[cron-deletions] orfani del secchio kyc-docs', riepilogo);
  if (rifiutati.length > 0) {
    throw new Error(`${rifiutati.length} orfani non rimossi dal secchio ${SECCHIO_DOCUMENTI}`);
  }
  return riepilogo;
}
