/**
 * 1/11/2026 — COSA DEVE ESSERCI SUL PROFILO PRIMA CHE LO STAFF LO APPROVI.
 *
 * La rotta di moderazione approvava guardando solo ruolo ed età. Due buchi:
 *
 * ① Un negozio senza partita IVA passava: `approve` rispondeva 200 e il negozio
 *   andava in vetrina senza il dato che serve per fatturare e per il contratto.
 * ② Il controllo dei documenti c'era solo nel browser: il modulo del fattorino
 *   segna come obbligatori fronte del documento, selfie, patente e polizza RC,
 *   ma il server approvava anche un fattorino che non aveva caricato niente.
 *
 * Qui le regole sono dati, non codice sparso: chi legge sa in una riga cosa si
 * pretende per ogni ruolo. La lettura del profilo la fa la rotta, una volta
 * sola, dal database — mai da quello che manda il browser.
 */

/** Le colonne che la rotta deve leggere per poter decidere. */
export const COLONNE_PER_APPROVARE =
  'approval_status, business_vat_number, kyc_id_doc_front_url, kyc_selfie_url, rider_license_url, rider_insurance_url';

type ColonnaDocumento = 'kyc_id_doc_front_url' | 'kyc_selfie_url' | 'rider_license_url' | 'rider_insurance_url';

/**
 * I documenti obbligatori per ruolo, allineati a quelli segnati `required: true`
 * nel modulo del fattorino (app/rider/onboarding). Il retro del documento lì è
 * facoltativo (il passaporto non ce l'ha) e l'attestato HACCP serve solo a chi
 * porta alimenti: qui non si pretendono.
 *
 * ⚠️ Il negozio non ha documenti obbligatori: il modulo /sell non chiede di
 * caricarne e non esiste una pagina dove il negoziante possa farlo. Pretenderli
 * qui renderebbe impossibile approvare qualunque negozio. È una scelta aperta
 * per Nicola, non una dimenticanza.
 */
export const DOCUMENTI_OBBLIGATORI: Record<'seller' | 'rider', ReadonlyArray<{ colonna: ColonnaDocumento; nome: string }>> = {
  rider: [
    { colonna: 'kyc_id_doc_front_url', nome: "documento d'identità (fronte)" },
    { colonna: 'kyc_selfie_url', nome: 'selfie con il documento' },
    { colonna: 'rider_license_url', nome: 'patente' },
    { colonna: 'rider_insurance_url', nome: 'polizza RC' },
  ],
  seller: [],
};

export type ProfiloDaApprovare = {
  role: string;
  approval_status?: string | null;
  business_vat_number?: string | null;
} & Partial<Record<ColonnaDocumento, string | null>>;

/** Toglie spazi e il prefisso «IT», come fa il modulo di iscrizione del negozio. */
export function normalizzaPartitaIva(v: string): string {
  return v.replace(/\s+/g, '').toUpperCase().replace(/^IT/, '');
}

/**
 * Partita IVA italiana: 11 cifre, l'ultima è il carattere di controllo (stesso
 * calcolo di app/api/seller/apply). Il controllo prende gli errori di battitura.
 */
export function partitaIvaValida(grezza: string | null | undefined): boolean {
  if (typeof grezza !== 'string') return false;
  const piva = normalizzaPartitaIva(grezza);
  if (!/^[0-9]{11}$/.test(piva)) return false;
  // «00000000000» torna col calcolo (somma 0, controllo 0) ma non è una partita vera.
  if (/^0+$/.test(piva)) return false;
  let somma = 0;
  for (let i = 0; i < 10; i++) {
    let c = Number(piva[i]);
    if (i % 2 === 1) {
      c *= 2;
      if (c > 9) c -= 9;
    }
    somma += c;
  }
  return (10 - (somma % 10)) % 10 === Number(piva[10]);
}

const presente = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

export type AzioneCheApprova = 'approve' | 'reactivate';

/**
 * `null` se il profilo si può approvare (o riattivare); altrimenti il messaggio
 * per lo staff, che dice cosa manca e cosa fare.
 *
 * Riattivare un SOSPESO non è una nuova approvazione: il negozio era già stato
 * approvato, e un negozio storico senza partita IVA non ha nessuna pagina per
 * inserirla (/sell risponde «sei sospeso»). Ripetere il controllo lì lo terrebbe
 * sospeso per sempre. Il controllo resta per `approve` e per `reactivate` da
 * rifiutato o in attesa, che portano ad «approvato» chi non lo è mai stato.
 */
export function motivoPerNonApprovare(p: ProfiloDaApprovare, azione: AzioneCheApprova = 'approve'): string | null {
  if (p.role !== 'seller' && p.role !== 'rider') return null;
  if (azione === 'reactivate' && p.approval_status === 'suspended') return null;

  const verbo = azione === 'reactivate' ? 'Non si riattiva' : 'Non si approva';
  const prima = azione === 'reactivate' ? 'prima di riattivare' : 'prima di approvare';

  if (p.role === 'seller') {
    if (!presente(p.business_vat_number)) {
      return `${verbo}: il negozio non ha la partita IVA. Fatti mandare la partita IVA dal negoziante e falla inserire ${prima}.`;
    }
    if (!partitaIvaValida(p.business_vat_number)) {
      return `${verbo}: la partita IVA del negozio non è valida (servono 11 cifre con il carattere di controllo giusto). Falla correggere ${prima}.`;
    }
  }

  const mancanti = DOCUMENTI_OBBLIGATORI[p.role].filter((d) => !presente(p[d.colonna])).map((d) => d.nome);
  if (mancanti.length > 0) {
    return `${verbo}: mancano i documenti obbligatori (${mancanti.join(', ')}). Chiedi di caricarli ${prima}.`;
  }
  return null;
}
