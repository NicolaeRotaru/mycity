import { describe, it, expect, vi } from 'vitest';
import { eseguiPotature, type ClientePotature } from '@/lib/privacy/potature-ritenzione';
import { dimenticaLIbanSeNonServe, ilBonificoDelResoEAncoraDaFare } from '@/lib/rimborsi/iban-del-rimborso';

/**
 * Riesame del 16/10, terzo giro — SE LA PULIZIA DELL'IBAN CADEVA UNA VOLTA, L'IBAN RESTAVA PER SEMPRE.
 *
 * L'informativa dice: «quando la richiesta si chiude senza bonifico, l'IBAN si cancella». A
 * cancellarlo era solo `dimenticaLIbanSeNonServe`, chiamata una volta dalla rotta che chiude il
 * reso. Il caso: il negozio respinge il reso di Marco, che aveva scritto il suo IBAN; in quel
 * momento il database va in timeout; la funzione scrive l'errore nel registro e torna «errore».
 * Il commento diceva «al peggio l'IBAN resta fino al prossimo giro» — ma nessun giro lo riprendeva:
 * l'IBAN restava sul reso respinto finche' Marco non cancellava l'account.
 *
 * La prova esegue la funzione vera con il guasto, poi il giro notturno VERO delle potature su un
 * finto database che applica davvero i filtri (uguale, non vuoto, non «bonifico:%», oppure).
 */

type Riga = Record<string, unknown>;
type Filtro = (r: Riga) => boolean;

/** I filtri di PostgREST che usano le potature, applicati davvero alle righe. */
function fintoDatabase(resi: Riga[], guasto: { code?: string; message: string } | null = null) {
  const scritture: Array<{ tabella: string; valori: Riga; toccate: string[] }> = [];
  const catena = (tabella: string, valori: Riga | null) => {
    const filtri: Filtro[] = [];
    const q: Record<string, unknown> = {
      eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return q; },
      lt: () => q,
      is: (c: string, v: unknown) => { filtri.push((r) => (r[c] ?? null) === v); return q; },
      not: (c: string, op: string, v: unknown) => {
        if (op === 'is' && v === null) filtri.push((r) => r[c] != null);
        else if (op === 'like') {
          const re = new RegExp(`^${String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`);
          filtri.push((r) => r[c] != null && !re.test(String(r[c])));
        } else throw new Error(`finto database: not(${op}) non lo so fare`);
        return q;
      },
      or: (espressione: string) => {
        const parti = espressione.split(',').map((p) => {
          const [c, ...resto] = p.split('.');
          if (resto.join('.') !== 'not.is.null') throw new Error(`finto database: or(${p}) non lo so fare`);
          return (r: Riga) => r[c] != null;
        });
        filtri.push((r) => parti.some((f) => f(r)));
        return q;
      },
      then: (ok: (v: { error: unknown }) => unknown) => {
        if (tabella === 'returns' && valori) {
          if (guasto) return Promise.resolve({ error: guasto }).then(ok);
          const toccate = resi.filter((r) => filtri.every((f) => f(r)));
          for (const r of toccate) Object.assign(r, valori);
          scritture.push({ tabella, valori, toccate: toccate.map((r) => String(r.id)) });
        }
        return Promise.resolve({ error: null }).then(ok);
      },
    };
    return q;
  };
  const admin = {
    from: (tabella: string) => ({ update: (v: Riga) => catena(tabella, v), delete: () => catena(tabella, null) }),
    rpc: async () => ({ data: [], error: null }),
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  } as unknown as ClientePotature;
  return { admin, scritture };
}

const registro = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const IBAN = 'IT60X0542811101000000123456';

/** Un reso per ogni caso della regola, tutti con l'IBAN ancora scritto. */
function iResi(): Riga[] {
  return [
    { id: 'respinto', status: 'REJECTED', refund_id: null, refund_method: 'BONIFICO', refund_iban: IBAN },
    { id: 'annullato', status: 'CANCELED', refund_id: null, refund_method: 'BONIFICO', refund_iban: IBAN },
    { id: 'col-credito', status: 'REFUNDED', refund_id: 'wallet:return_x', refund_method: 'BONIFICO', refund_iban: IBAN },
    { id: 'sulla-carta', status: 'REFUNDED', refund_id: 're_123', refund_method: 'BONIFICO', refund_iban: IBAN },
    { id: 'nome-rimasto', status: 'CANCELED', refund_id: null, refund_method: null, refund_iban: null, refund_intestatario: 'Marco Neri' },
    // Questi l'IBAN lo devono tenere.
    { id: 'bonifico-da-fare', status: 'REFUNDED', refund_id: 'bonifico:4000:return_y', refund_method: 'BONIFICO', refund_iban: IBAN },
    { id: 'aperto', status: 'RECEIVED', refund_id: null, refund_method: 'BONIFICO', refund_iban: IBAN },
    { id: 'rimborso-non-registrato', status: 'REFUNDED', refund_id: null, refund_method: 'BONIFICO', refund_iban: IBAN },
  ];
}

const DA_TOGLIERE = ['respinto', 'annullato', 'col-credito', 'sulla-carta', 'nome-rimasto'];

describe('l IBAN di un reso chiuso senza bonifico se ne va anche se la pulizia della rotta cade', () => {
  it('IL CASO CHE ROMPEVA — la rotta non riesce a toglierlo, la notte si', async () => {
    const marco: Riga = { id: 'reso-di-marco', status: 'REJECTED', refund_id: null, refund_method: 'BONIFICO', refund_iban: IBAN };

    // La rotta che respinge chiama la pulizia: il database e' in timeout.
    const caduta = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) }) }),
      }),
    };
    const esito = await dimenticaLIbanSeNonServe(caduta, 'reso-di-marco');
    expect(esito.esito, 'la pulizia non e caduta: la prova non misura niente').toBe('errore');
    expect(marco.refund_iban).toBe(IBAN);

    // La notte dopo.
    const { admin } = fintoDatabase([marco]);
    const rapporto = await eseguiPotature(admin, registro, Date.now());
    expect(rapporto.esiti.find((e) => e.cosa === 'returns.iban-senza-bonifico'), 'nessun giro riprende la pulizia').toMatchObject({ ok: true });
    expect(marco.refund_iban, 'l IBAN del reso respinto resta finche Marco non cancella l account').toBeNull();
  });

  it('toglie IBAN e nome da tutti e solo i resi in cui il bonifico non ci sara piu: la stessa regola della rotta', async () => {
    const resi = iResi();
    const { admin } = fintoDatabase(resi);
    await eseguiPotature(admin, registro, Date.now());

    const ripuliti = resi.filter((r) => r.refund_iban == null && r.refund_intestatario == null).map((r) => r.id);
    expect(ripuliti.sort()).toEqual([...DA_TOGLIERE].sort());
    // La regola della rotta dice la stessa cosa di ogni reso chiuso, tranne quello rimborsato senza
    // nessun segno: li' il rimborso e' partito ma il reso non l'ha registrato, e l'IBAN serve.
    for (const r of iResi().filter((x) => x.status !== 'RECEIVED' && x.refund_id != null)) {
      expect(DA_TOGLIERE.includes(String(r.id)), `potatura e regola non dicono la stessa cosa sul reso ${r.id}`).toBe(
        !ilBonificoDelResoEAncoraDaFare(r as never),
      );
    }
  });

  it('senza la migrazione 162 non c e niente da togliere, e la notte non diventa rossa', async () => {
    const { admin } = fintoDatabase(iResi(), { code: '42703', message: 'column returns.refund_iban does not exist' });
    const rapporto = await eseguiPotature(admin, registro, Date.now());
    expect(rapporto.esiti.find((e) => e.cosa === 'returns.iban-senza-bonifico')).toMatchObject({ ok: true });
  });

  it('se il database cade anche di notte, la potatura si conta fra le fallite: la notte lo dice', async () => {
    const { admin } = fintoDatabase(iResi(), { code: '57014', message: 'canceling statement due to statement timeout' });
    const rapporto = await eseguiPotature(admin, registro, Date.now());
    expect(rapporto.esiti.find((e) => e.cosa === 'returns.iban-senza-bonifico')).toMatchObject({ ok: false });
  });
});
