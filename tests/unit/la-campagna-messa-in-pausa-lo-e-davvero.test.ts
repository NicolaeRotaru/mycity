import { describe, it, expect } from 'vitest';
import {
  cambiaStatoCampagna,
  eliminaCampagna,
  chiaveDelleCampagne,
  TABELLA_CAMPAGNE,
  type DbCampagne,
} from '@/lib/admin/scritture-delle-campagne';
import { queryKeys } from '@/lib/queries/keys';
import type { RispostaScrittura } from '@/lib/esito-scrittura';

/**
 * 8/9/2026 — «AGGIORNATO» IN VERDE MENTRE LA CAMPAGNA CONTINUAVA A SPENDERE.
 *
 * `/admin/sponsored` metteva in pausa così:
 *
 *     const { error } = await supabase.from('sponsored_listings').update({ status }).eq('id', id);
 *     if (error) throw error;                     // → onSuccess: toast.success('Aggiornato')
 *
 * L'errore lo guardava. Le righe toccate no. Con le regole di riga attive una scrittura senza
 * permesso non è un errore: è un comando che non trova niente da cambiare, e il database risponde
 * «ok, zero righe». L'amministratore leggeva «Aggiornato», chiudeva la pagina, e la campagna
 * continuava a bruciare il budget del venditore — soldi veri di qualcun altro.
 *
 * Terza cosa, sulla stessa riga: dopo la scrittura la pagina svuotava
 * `queryKeys.admin.sponsored()`, che vale `['admin','sponsored','all']`. Ma con un filtro acceso
 * l'elenco a schermo sta sotto `['admin','sponsored','paused']`: non si ricaricava, e la riga
 * restava esattamente come prima sotto un messaggio verde.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────
 * ① ESEGUE le due scritture con un database finto e pretende che chiedano indietro le righe.
 * ② ESEGUE il caso silenzioso — nessun errore, zero righe — e pretende che LANCI: è l'unico modo
 *    perché React Query non faccia partire il verde.
 * ③ Pretende che la chiave da svuotare sia il RAMO, cioè che copra la lista filtrata che
 *    l'amministratore sta guardando.
 *
 * ⚪ Da qui non parlo col database vero: verifico la decisione, non il viaggio in rete.
 */

const CAMPAGNA = {
  id: 'c1',
  product: { name: 'Focaccia' },
  seller: { store_name: 'Pane Quotidiano' },
};

type Chiamata = { tabella: string; verbo: 'update' | 'delete'; valori?: Record<string, unknown>; colonna?: string; valore?: string; select?: string };

/** Un database finto che registra cosa gli è stato chiesto e risponde quello che gli dici. */
function dbFinto(risposta: RispostaScrittura) {
  const chiamate: Chiamata[] = [];
  const db: DbCampagne = {
    from(tabella: string) {
      const filtro = (verbo: 'update' | 'delete', valori?: Record<string, unknown>) => ({
        eq(colonna: string, valore: string) {
          return {
            select(select: string) {
              chiamate.push({ tabella, verbo, valori, colonna, valore, select });
              return Promise.resolve(risposta);
            },
          };
        },
      });
      return {
        update: (valori: Record<string, unknown>) => filtro('update', valori),
        delete: () => filtro('delete'),
      };
    },
  };
  return { db, chiamate };
}

const UNA_RIGA: RispostaScrittura = { data: [{ id: 'c1' }], error: null, count: 1, status: 200 };
/** Il caso silenzioso: il database dice «ok» e non ha toccato niente. */
const ZERO_RIGHE: RispostaScrittura = { data: [], error: null, count: 0, status: 200 };

describe('mettere in pausa una campagna', () => {
  it('scrive dove deve, sulla riga giusta, e chiede indietro le righe toccate', async () => {
    const { db, chiamate } = dbFinto(UNA_RIGA);
    const esito = await cambiaStatoCampagna(db, CAMPAGNA, 'paused');
    expect(esito.riuscita).toBe(true);
    expect(chiamate).toEqual([
      { tabella: TABELLA_CAMPAGNE, verbo: 'update', valori: { status: 'paused' }, colonna: 'id', valore: 'c1', select: 'id' },
    ]);
  });

  it('IL CASO CHE COSTA: nessun errore e zero righe → lancia, quindi niente verde', async () => {
    const { db } = dbFinto(ZERO_RIGHE);
    await expect(cambiaStatoCampagna(db, CAMPAGNA, 'paused')).rejects.toThrow(/ancora come prima/i);
  });

  it('il messaggio nomina la campagna, non un identificativo', async () => {
    const { db } = dbFinto(ZERO_RIGHE);
    await expect(cambiaStatoCampagna(db, CAMPAGNA, 'paused')).rejects.toThrow(/Focaccia/);
  });

  it('quando il database dice di no, l’errore arriva intero a chi lo sa tradurre', async () => {
    const errore = { code: '42501', message: 'permission denied' };
    const { db } = dbFinto({ data: null, error: errore, status: 403 });
    await expect(cambiaStatoCampagna(db, CAMPAGNA, 'active')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('eliminare una campagna', () => {
  it('cancella la riga giusta e chiede indietro la prova', async () => {
    const { db, chiamate } = dbFinto(UNA_RIGA);
    await eliminaCampagna(db, CAMPAGNA);
    expect(chiamate[0]).toMatchObject({ verbo: 'delete', colonna: 'id', valore: 'c1', select: 'id' });
  });

  it('zero righe cancellate → lancia: la campagna è ancora viva', async () => {
    const { db } = dbFinto(ZERO_RIGHE);
    await expect(eliminaCampagna(db, CAMPAGNA)).rejects.toThrow(/ancora come prima/i);
  });
});

describe('dopo la scrittura si ricarica la lista che si sta guardando', () => {
  it('la chiave è il ramo: copre ogni filtro, non solo «Tutti»', () => {
    const ramo = chiaveDelleCampagne();
    for (const filtro of ['all', 'active', 'paused', 'ended'] as const) {
      const foglia = queryKeys.admin.sponsored(filtro) as readonly string[];
      expect(foglia.slice(0, ramo.length)).toEqual([...ramo]);
    }
  });

  it('la chiave vecchia NON copriva la lista filtrata — ed è il difetto, scritto', () => {
    const vecchia = queryKeys.admin.sponsored() as readonly string[];
    const guardata = queryKeys.admin.sponsored('paused') as readonly string[];
    expect(guardata.slice(0, vecchia.length)).not.toEqual([...vecchia]);
  });
});
