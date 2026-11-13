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
  'approval_status, approved_by, business_vat_number, kyc_id_doc_front_url, kyc_selfie_url, rider_license_url, rider_insurance_url, ' +
  'rider_license_expires_on, rider_insurance_expires_on, rider_vehicle_type';

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

/**
 * 12/11/2026 (R03-024) — I DOCUMENTI DEL FATTORINO DIPENDONO DAL MEZZO.
 *
 * Si chiedevano sempre documento, selfie, patente e polizza RC, qualunque fosse il mezzo: chi
 * consegna in bici (Nicola, un familiare, un ragazzo) senza patente non arrivava mai
 * all'approvazione, e senza un fattorino approvato nessuno prende un ordine pronto. La patente
 * serve per scooter e auto. La polizza RC della bici arriva dopo il lancio per scelta di Nicola
 * (registro dei fatti, rischi.scelti-al-lancio, 1/11/2026: «la polizza infortuni più la
 * responsabilità civile della bici arrivano DOPO»): quando c'è, si accende qui.
 * Un mezzo non dichiarato chiede tutto, come prima.
 */
export const RC_OBBLIGATORIA_PER_LA_BICI = false;

export type MezzoDelFattorino = 'BIKE' | 'EBIKE' | 'SCOOTER' | 'CAR';

const IN_BICI = (mezzo: string | null | undefined) => mezzo === 'BIKE' || mezzo === 'EBIKE';

/** I documenti obbligatori di un fattorino, per il mezzo dichiarato: la regola sta qui sola. */
export function documentiObbligatoriDelFattorino(
  mezzo: string | null | undefined,
): ReadonlyArray<{ colonna: ColonnaDocumento; nome: string }> {
  if (!IN_BICI(mezzo)) return DOCUMENTI_OBBLIGATORI.rider;
  return DOCUMENTI_OBBLIGATORI.rider.filter(
    (d) => d.colonna !== 'rider_license_url' && (d.colonna !== 'rider_insurance_url' || RC_OBBLIGATORIA_PER_LA_BICI),
  );
}

export type ProfiloDaApprovare = {
  role: string;
  rider_vehicle_type?: string | null;
  approval_status?: string | null;
  approved_by?: string | null;
  business_vat_number?: string | null;
  rider_license_expires_on?: string | null;
  rider_insurance_expires_on?: string | null;
} & Partial<Record<ColonnaDocumento, string | null>>;

/**
 * 5/11/2026 — Patente e polizza del fattorino devono avere una scadenza e non
 * essere scadute: prima il freno c'era solo nel pulsante del pannello, e una
 * richiesta che non passava dal pannello approvava una polizza già scaduta.
 * Stessa regola di lib/kyc/esame-rider.ts: senza data «non sappiamo quando scade».
 */
const SCADENZE_RIDER: ReadonlyArray<{ colonna: 'rider_license_expires_on' | 'rider_insurance_expires_on'; nome: string }> = [
  { colonna: 'rider_license_expires_on', nome: 'patente' },
  { colonna: 'rider_insurance_expires_on', nome: 'polizza RC' },
];

function scadenzeNonValide(p: ProfiloDaApprovare, oggi: string): string[] {
  const problemi: string[] = [];
  // R03-024 — Si guarda la scadenza dei documenti che il mezzo chiede, e di quelli caricati.
  const chiesti = new Set(documentiObbligatoriDelFattorino(p.rider_vehicle_type).map((d) => d.colonna));
  for (const d of SCADENZE_RIDER) {
    const documento = d.colonna === 'rider_license_expires_on' ? 'rider_license_url' : 'rider_insurance_url';
    if (!chiesti.has(documento) && !presente(p[documento])) continue;
    const v = p[d.colonna];
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) problemi.push(`${d.nome} senza data di scadenza`);
    else if (v.slice(0, 10) < oggi) problemi.push(`${d.nome} scaduta il ${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`);
  }
  return problemi;
}

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
export function motivoPerNonApprovare(
  p: ProfiloDaApprovare,
  azione: AzioneCheApprova = 'approve',
  oggi: string = new Date().toISOString().slice(0, 10),
): string | null {
  if (p.role !== 'seller' && p.role !== 'rider') return null;
  // 1/11/2026 (ricollaudo) — solo chi e' stato davvero approvato da un
  // amministratore (`approved_by` scritto) torna attivo senza rifare il
  // controllo. In produzione c'era un fattorino sospeso mai approvato e senza
  // nessun documento: un clic su «Riattiva» lo avrebbe mandato a consegnare.
  // 5/11/2026 — Patente e polizza: una data di scadenza e non scadute. Vale anche per
  // chi torna da sospeso: tornerebbe a consegnare con una polizza scaduta.
  const documentiDelMezzo = p.role === 'rider' ? documentiObbligatoriDelFattorino(p.rider_vehicle_type) : [];
  if (p.role === 'rider' && documentiDelMezzo.every((d) => presente(p[d.colonna]))) {
    const scadenze = scadenzeNonValide(p, oggi);
    if (scadenze.length > 0) {
      const v = azione === 'reactivate' ? 'Non si riattiva' : 'Non si approva';
      return `${v}: ${scadenze.join(', ')}. Chiedi di caricare il documento aggiornato con la sua scadenza.`;
    }
  }
  if (azione === 'reactivate' && p.approval_status === 'suspended' && presente(p.approved_by)) return null;

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

  const richiesti = p.role === 'rider' ? documentiDelMezzo : DOCUMENTI_OBBLIGATORI[p.role];
  const mancanti = richiesti.filter((d) => !presente(p[d.colonna])).map((d) => d.nome);
  if (mancanti.length > 0) {
    return `${verbo}: mancano i documenti obbligatori (${mancanti.join(', ')}). Chiedi di caricarli ${prima}.`;
  }
  return null;
}
