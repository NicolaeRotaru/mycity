/**
 * CONTARE UNA VISITA A UNA SCHEDA PRODOTTO, NELL'ORDINE GIUSTO.
 *
 * 27/8/2026 (R175) — il freno («questa scheda l'ho già contata in questa sessione») veniva messo
 * PRIMA di scrivere la riga. Se la scrittura falliva, la visita restava segnata come contata per
 * tutta la sessione: persa, senza che nessuno potesse accorgersene. E l'evento verso i sistemi di
 * misura partiva comunque, quindi i due conti divergevano.
 *
 * Adesso l'ordine è: guarda il consenso · guarda se è già contata · scrivi · e solo se la scrittura
 * è andata bene segna il freno e annuncia. Un fallimento lascia le cose come stavano, e il
 * tentativo dopo ci riprova davvero.
 *
 * 🟢 Pura rispetto al mondo: sessione, rete e sistemi di misura arrivano da fuori, quindi una prova
 * la ESEGUE per intero, compreso il caso in cui la scrittura fallisce.
 */

export type EsitoVisita = 'senza-consenso' | 'gia-contata' | 'contata' | 'non-riuscita';

export interface DipendenzeVisita {
  /** Il consenso statistico, letto ADESSO (non quello di quando è stata aperta la pagina). */
  consenso: () => boolean;
  giaContata: (chiave: string) => boolean;
  segnaContata: (chiave: string) => void;
  /** L'evento verso i sistemi di misura (PostHog, GA4). */
  annuncia: () => void;
  /** La riga in `product_views` (più «visti di recente» per chi ha l'account). */
  registra: () => Promise<void>;
}

export const chiaveDellaVisita = (productId: string) => `mc_viewed_${productId}`;

export async function contaLaVisita(productId: string, d: DipendenzeVisita): Promise<EsitoVisita> {
  if (!d.consenso()) return 'senza-consenso';
  const chiave = chiaveDellaVisita(productId);
  if (d.giaContata(chiave)) return 'gia-contata';

  try {
    await d.registra();
  } catch {
    // Niente freno e niente annuncio: per il conteggio è come se non fosse successo, e alla
    // prossima occasione (un altro disegno, o l'arrivo del consenso) si riprova.
    return 'non-riuscita';
  }

  d.segnaContata(chiave);
  d.annuncia();
  return 'contata';
}

/**
 * 12/11/2026 (R02-015) — UNA SOLA DEFINIZIONE DI «VISITA»: UNA PER PERSONA, PER PRODOTTO, ALL'ORA.
 *
 * Il database (trigger product_views_dedup, migrazione 119) tiene una visita per utente — o per
 * impronta, se anonimo — per prodotto ogni ora. Il browser invece frenava per SCHEDA (sessionStorage):
 * lo stesso cliente che apriva il prodotto in due schede in dieci minuti dava 2 «product_viewed» a
 * PostHog e 1 riga nel database, e i due conti non potevano tornare. Adesso anche il browser usa
 * l'ora, in un archivio condiviso fra le schede (localStorage), e l'impronta degli anonimi vive
 * un'ora sola: dentro l'ora è la stessa in tutte le schede (come per il database), dopo cambia e
 * non segue nessuno.
 */
export const FINESTRA_DELLA_VISITA_MS = 60 * 60 * 1000;

/** Il minimo di Storage che serve: localStorage, o un finto in una prova. */
export type Archivio = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem' | 'key' | 'length'>>;

/**
 * R02-015 (dopo il qa) — Le chiavi scadute non restano nel browser: prima stavano in sessionStorage,
 * che si svuota chiudendo la scheda; in localStorage diventerebbero uno storico di cosa hai guardato.
 * A ogni visita contata si tolgono quelle oltre l'ora.
 */
function pulisciScadute(archivio: Archivio | null, adesso: number): void {
  try {
    if (!archivio?.key || !archivio.removeItem || typeof archivio.length !== 'number') return;
    const scadute: string[] = [];
    for (let i = 0; i < archivio.length; i++) {
      const k = archivio.key(i);
      if (!k || !k.startsWith('mc_viewed_')) continue;
      const quando = Number(archivio.getItem(k));
      if (!Number.isFinite(quando) || adesso - quando >= FINESTRA_DELLA_VISITA_MS) scadute.push(k);
    }
    for (const k of scadute) archivio.removeItem(k);
  } catch { /* archivio non disponibile */ }
}

function leggi(archivio: Archivio | null, chiave: string): string | null {
  try { return archivio?.getItem(chiave) ?? null; } catch { return null; }
}
function scrivi(archivio: Archivio | null, chiave: string, valore: string): void {
  try { archivio?.setItem(chiave, valore); } catch { /* archivio non disponibile */ }
}

/** Il freno «già contata»: vale un'ora dall'ultima visita contata, in tutte le schede. */
export function frenoOrario(
  archivio: Archivio | null,
  adesso: () => number = Date.now,
): Pick<DipendenzeVisita, 'giaContata' | 'segnaContata'> {
  return {
    giaContata: (chiave) => {
      const quando = Number(leggi(archivio, chiave));
      return Number.isFinite(quando) && quando > 0 && adesso() - quando < FINESTRA_DELLA_VISITA_MS;
    },
    segnaContata: (chiave) => {
      pulisciScadute(archivio, adesso());
      scrivi(archivio, chiave, String(adesso()));
    },
  };
}

/** L'impronta delle visite anonime: la stessa per un'ora in tutte le schede, poi una nuova. */
export function improntaOraria(
  archivio: Archivio | null,
  adesso: () => number = Date.now,
  nuova: () => string = () => crypto.randomUUID(),
): string {
  const CHIAVE = 'mc_impronta_visite';
  try {
    const gia = JSON.parse(leggi(archivio, CHIAVE) ?? 'null') as { id?: string; da?: number } | null;
    if (gia?.id && typeof gia.da === 'number' && adesso() - gia.da < FINESTRA_DELLA_VISITA_MS) return gia.id;
  } catch { /* valore rovinato: se ne fa uno nuovo */ }
  const id = nuova();
  scrivi(archivio, CHIAVE, JSON.stringify({ id, da: adesso() }));
  return id;
}
