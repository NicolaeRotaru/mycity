/**
 * L'esame di un fattorino, come lo vede l'amministratore prima di approvarlo.
 *
 * Il difetto (ondata 3). In produzione non c'e' un servizio di verifica
 * automatica: `ManualReviewKycProvider` lascia tutto «PENDING», quindi l'unico
 * controllo vero e' l'occhio di chi approva. Ma il pannello «Esamina» era
 * quello dei negozi: Vetrina, Azienda, P.IVA, PEC — per un fattorino tutte
 * «—». Patente, polizza, documento ed eta' non si vedevano, e «Approva»
 * restava cliccabile anche con la polizza scaduta.
 *
 * Qui sta la regola, in un posto solo: quali documenti servono, quando uno
 * conta come scaduto, quanti anni ha la persona e se si puo' approvare.
 * Il pannello la chiede; non riconta niente per conto suo.
 */
import { anniCompiuti, ETA_MINIMA_RIDER } from '@/lib/maggiore-eta';

/** Quanti giorni prima della scadenza un documento si segnala «in scadenza». */
export const GIORNI_PREAVVISO_SCADENZA = 30;

export type ChiaveDocumentoRider = 'documento_fronte' | 'documento_retro' | 'selfie' | 'patente' | 'polizza';

/** Un documento come arriva dalla rotta admin: il link firmato e la sua scadenza, se ne ha una. */
export type DocumentoRider = {
  chiave: ChiaveDocumentoRider;
  etichetta: string;
  /** URL firmato a vita breve, o null se il file non c'e'. */
  url: string | null;
  /** AAAA-MM-GG, solo per patente e polizza. */
  scade_il: string | null;
};

export type DatiEsameRider = {
  legal_birth_date: string | null;
  documenti: DocumentoRider[];
};

export type StatoDocumento = 'ok' | 'mancante' | 'scaduto' | 'in_scadenza' | 'senza_scadenza';

export type DocumentoEsaminato = DocumentoRider & {
  obbligatorio: boolean;
  stato: StatoDocumento;
};

export type EsitoEsameRider = {
  eta: number | null;
  maggiorenne: boolean;
  documenti: DocumentoEsaminato[];
  puoApprovare: boolean;
  /** Perche' «Approva» e' spento, in parole semplici. Vuoto se si puo' approvare. */
  motivi: string[];
};

/** I documenti che un fattorino deve avere, con l'etichetta che vede l'amministratore. */
export const DOCUMENTI_RIDER: ReadonlyArray<{ chiave: ChiaveDocumentoRider; etichetta: string; obbligatorio: boolean; scade: boolean }> = [
  { chiave: 'documento_fronte', etichetta: "Documento d'identità (fronte)", obbligatorio: true, scade: false },
  { chiave: 'documento_retro', etichetta: "Documento d'identità (retro)", obbligatorio: false, scade: false },
  { chiave: 'selfie', etichetta: 'Selfie', obbligatorio: true, scade: false },
  { chiave: 'patente', etichetta: 'Patente', obbligatorio: true, scade: true },
  { chiave: 'polizza', etichetta: 'Polizza RC', obbligatorio: true, scade: true },
];

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Giorni fra due date AAAA-MM-GG (b - a), calcolati a mezzogiorno UTC per non cadere sull'ora legale. */
function giorniFra(a: string, b: string): number {
  const t = (s: string) => Date.parse(`${s.slice(0, 10)}T12:00:00Z`);
  return Math.round((t(b) - t(a)) / 86_400_000);
}

export function esameRider(dati: DatiEsameRider | null | undefined, giornoDiOggi: string): EsitoEsameRider {
  const nascita = dati?.legal_birth_date ?? null;
  const eta = nascita ? anniCompiuti(nascita, giornoDiOggi) : null;
  const maggiorenne = eta !== null && eta >= ETA_MINIMA_RIDER;

  const motivi: string[] = [];
  if (eta === null) motivi.push('Manca la data di nascita.');
  else if (!maggiorenne) motivi.push(`Ha ${eta} anni: per consegnare ne servono ${ETA_MINIMA_RIDER}.`);

  const documenti: DocumentoEsaminato[] = DOCUMENTI_RIDER.map((d) => {
    const arrivato = dati?.documenti.find((x) => x.chiave === d.chiave);
    const url = arrivato?.url ?? null;
    const scade_il = arrivato?.scade_il ?? null;
    let stato: StatoDocumento;
    if (!url) stato = 'mancante';
    else if (!d.scade) stato = 'ok';
    else if (!scade_il || !DATA.test(scade_il.slice(0, 10))) stato = 'senza_scadenza';
    else {
      const mancano = giorniFra(giornoDiOggi, scade_il);
      stato = mancano < 0 ? 'scaduto' : mancano <= GIORNI_PREAVVISO_SCADENZA ? 'in_scadenza' : 'ok';
    }

    if (d.obbligatorio) {
      if (stato === 'mancante') motivi.push(`Manca: ${d.etichetta}.`);
      else if (stato === 'scaduto') motivi.push(`Scaduto: ${d.etichetta}.`);
      else if (stato === 'senza_scadenza') motivi.push(`Non sappiamo quando scade: ${d.etichetta}.`);
    }
    return { chiave: d.chiave, etichetta: d.etichetta, url, scade_il, obbligatorio: d.obbligatorio, stato };
  });

  return { eta, maggiorenne, documenti, puoApprovare: motivi.length === 0, motivi };
}
