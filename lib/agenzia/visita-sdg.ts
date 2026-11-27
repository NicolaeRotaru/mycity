/**
 * IL GIORNO IN CUI SDG PASSA DAL TITOLARE — 27/11/2026.
 *
 * Nicola, 27/11 verso le 17:40: nella pagina del link dove il titolare conferma l'abbonamento e l'email
 * «deve esserci anche il calendario in cui deve selezionare il giorno e l'ora in cui deve passare il team
 * creativo», per scrivere il piano editoriale e fare subito foto e video.
 *
 * Qui stanno i giorni e le ore che il titolare può scegliere, calcolati dal server sull'ora di Piacenza:
 *  · i giorni partono da dopodomani (a SDG serve un giorno per prepararsi) e arrivano a due settimane;
 *  · la domenica no;
 *  · quattro orari al giorno, lontani dalle ore di punta di bar e ristoranti (colazione, pranzo, aperitivo).
 * Giorni e orari sono una scelta dell'AD, da confermare con Nicola e SDG: si cambiano in queste costanti.
 *
 * Il browser manda solo l'identificativo di un orario (l'istante in UTC, ISO); il server lo accetta solo
 * se è ancora fra quelli che calcola adesso. Due attività non possono prendere la stessa ora: lo vieta
 * l'indice unico della migrazione 999b su preventivi_con_codice.visita_il.
 */

export const FUSO_PIACENZA = 'Europe/Rome';

/** Gli orari di inizio della visita, ora di Piacenza. */
export const ORARI_VISITA = ['10:00', '11:30', '15:00', '16:30'] as const;
/** Il primo giorno che si può scegliere, contato da oggi (2 = dopodomani). */
export const GIORNI_DI_PREAVVISO = 2;
/** L'ultimo giorno che si può scegliere, contato da oggi. */
export const GIORNI_AVANTI = 14;
/** Quanto dura la visita, detto al titolare. */
export const DURATA_VISITA = 'circa un’ora e mezza';

export type OrarioVisita = { id: string; ora: string; libero: boolean };
export type GiornoVisita = { giorno: string; breve: string; lungo: string; orari: OrarioVisita[] };

type Parti = { anno: number; mese: number; giorno: number; ore: number; minuti: number; settimana: number };

const SETTIMANA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Le parti di un istante sull'orologio di Piacenza. */
function partiAPiacenza(istante: Date): Parti {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSO_PIACENZA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(istante)) p[x.type] = x.value;
  return {
    anno: Number(p.year),
    mese: Number(p.month),
    giorno: Number(p.day),
    ore: Number(p.hour),
    minuti: Number(p.minute),
    settimana: SETTIMANA[p.weekday] ?? 0,
  };
}

/** L'istante in cui l'orologio di Piacenza segna quella data e quell'ora (ora legale compresa). */
export function istanteAPiacenza(anno: number, mese: number, giorno: number, ore: number, minuti: number): Date {
  const voluto = Date.UTC(anno, mese - 1, giorno, ore, minuti);
  let stima = voluto;
  // Due passi bastano: lo scarto fra UTC e Piacenza è di una o due ore.
  for (let i = 0; i < 2; i++) {
    const p = partiAPiacenza(new Date(stima));
    const letto = Date.UTC(p.anno, p.mese - 1, p.giorno, p.ore, p.minuti);
    stima += voluto - letto;
  }
  return new Date(stima);
}

const BREVE = new Intl.DateTimeFormat('it-IT', { timeZone: FUSO_PIACENZA, weekday: 'short', day: 'numeric', month: 'short' });
const LUNGO = new Intl.DateTimeFormat('it-IT', { timeZone: FUSO_PIACENZA, weekday: 'long', day: 'numeric', month: 'long' });
const ORA = new Intl.DateTimeFormat('it-IT', { timeZone: FUSO_PIACENZA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** «giovedì 3 dicembre alle 10:00», sull'ora di Piacenza. */
export function scriviVisita(istante: Date | string): string {
  const d = typeof istante === 'string' ? new Date(istante) : istante;
  return `${LUNGO.format(d)} alle ${ORA.format(d)}`;
}

/**
 * I giorni che il titolare può scegliere adesso, con gli orari. `presi` sono gli orari già fissati da
 * altre attività (gli istanti ISO letti dal database): restano nella lista ma non liberi. Un giorno con
 * tutti gli orari presi non compare.
 */
export function giorniDellaVisita(adesso: Date, presi: Iterable<string> = []): GiornoVisita[] {
  const occupati = new Set<number>();
  for (const p of presi) {
    const t = new Date(p).getTime();
    if (Number.isFinite(t)) occupati.add(t);
  }
  const oggi = partiAPiacenza(adesso);
  const giorni: GiornoVisita[] = [];
  for (let avanti = GIORNI_DI_PREAVVISO; avanti <= GIORNI_AVANTI; avanti++) {
    // Mezzogiorno di quel giorno: lontano dai cambi d'ora, per leggere data e giorno della settimana.
    const mezzogiorno = istanteAPiacenza(oggi.anno, oggi.mese, oggi.giorno + avanti, 12, 0);
    const g = partiAPiacenza(mezzogiorno);
    if (g.settimana === 0) continue;
    const orari = ORARI_VISITA.map((ora) => {
      const [h, m] = ora.split(':').map(Number);
      const istante = istanteAPiacenza(g.anno, g.mese, g.giorno, h, m);
      return { id: istante.toISOString(), ora, libero: !occupati.has(istante.getTime()) };
    });
    if (!orari.some((o) => o.libero)) continue;
    giorni.push({
      giorno: `${g.anno}-${String(g.mese).padStart(2, '0')}-${String(g.giorno).padStart(2, '0')}`,
      breve: BREVE.format(mezzogiorno),
      lungo: LUNGO.format(mezzogiorno),
      orari,
    });
  }
  return giorni;
}

/** Vero se `id` è, adesso, uno degli orari che il titolare può scegliere (presi o no). */
export function orarioDellaVisitaValido(id: string, adesso: Date): boolean {
  return giorniDellaVisita(adesso).some((g) => g.orari.some((o) => o.id === id));
}
