/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { eseguiPotature, potatureNotturne, type ClientePotature } from '@/lib/privacy/potature-ritenzione';
import { leggiVistiDiRecente } from '@/lib/queries/fasce-prodotti';
import { CONSENT_STORAGE, CONSENT_VERSION } from '@/lib/consent';

/**
 * R21-012 — GLI «ULTIMI VISTI» RESTAVANO SALVATI PER SEMPRE E SI VEDEVANO ANCHE DOPO AVER TOLTO
 * IL CONSENSO.
 *
 * `recently_viewed` si scrive solo col consenso ai cookie statistici: è un dato di analitica, per
 * cui l'informativa promette 14 mesi. Nessuna potatura la toccava, e la lettura del carosello non
 * guardava il consenso di adesso. (La cancellazione alla revoca la fa il database quando registra
 * il «no»: tests/sql/rls/riparazione-r21-ultimi-visti.test.sql.)
 *
 * Qui: la pagina vera dell'informativa dice quanti mesi, la notte (a un'ora finta) cancella le
 * righe più vecchie di quei mesi, e il carosello senza consenso non chiede niente al database.
 */

type Scrittura = { tabella: string; valori: Record<string, unknown>; filtri: unknown[][] };

function fintoDatabase() {
  const scritture: Scrittura[] = [];
  const catena = (s: Scrittura) => {
    const q: Record<string, unknown> = {
      then: (ok: (v: { error: null }) => unknown) => Promise.resolve(ok({ error: null })),
    };
    for (const f of ['eq', 'lt', 'is', 'not', 'or']) {
      q[f] = (...argomenti: unknown[]) => {
        s.filtri.push([f, ...argomenti]);
        return q;
      };
    }
    return q;
  };
  const admin = {
    from: (tabella: string) => ({
      update: (valori: Record<string, unknown>) => {
        const s = { tabella, valori, filtri: [] };
        scritture.push(s);
        return catena(s);
      },
      delete: () => {
        const s = { tabella, valori: { cancella: true }, filtri: [] };
        scritture.push(s);
        return catena(s);
      },
    }),
    rpc: async () => ({ data: [], error: null }),
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  } as unknown as ClientePotature;
  return { admin, scritture };
}

const muto = { info: () => {}, warn: () => {}, error: () => {} };

let Pagina: ComponentType<Record<string, unknown>>;
beforeAll(async () => {
  Pagina = (await monta('app/privacy/page.tsx')).default as ComponentType<Record<string, unknown>>;
}, 60000);

afterEach(() => {
  vi.useRealTimers();
});

/** Le celle della riga degli «Ultimi visti» nella tabella «Finalità e conservazione». */
function rigaDegliUltimiVisti(): string[] | null {
  const s = accendi(Pagina);
  try {
    const righe = Array.from(s.radice.querySelectorAll('#finalita tbody tr'));
    expect(righe.length, 'la tabella non è comparsa: la prova non sta guardando niente').toBeGreaterThan(5);
    const riga = righe.find((r) => /ultimi visti/i.test(testoVisibile(r.querySelector('td'))));
    return riga ? Array.from(riga.querySelectorAll('td')).map((c) => testoVisibile(c)) : null;
  } finally {
    s.smonta();
  }
}

describe('R21-012 · gli «Ultimi visti» non restano per sempre', () => {
  it('l informativa ha la riga degli «Ultimi visti»: consenso, mesi, e cosa succede alla revoca', () => {
    const celle = rigaDegliUltimiVisti();
    expect(celle, 'nessuna riga per gli «Ultimi visti»: una cronologia legata all account senza tempo').toBeTruthy();
    expect(celle![1]).toMatch(/consenso/i);
    expect(celle![2]).toMatch(/^\d+ mesi dall.ultima volta/);
    expect(celle![2]).toMatch(/togli il consenso/);
  }, 60000);

  it('IL CASO CHE ROMPEVA — la notte cancella gli «Ultimi visti» più vecchi dei mesi promessi', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T04:00:00Z'));
    const adesso = Date.now();

    const celle = rigaDegliUltimiVisti();
    const mesi = Number(/^(\d+) mesi/.exec(celle?.[2] ?? '')?.[1]);
    expect(Number.isFinite(mesi) && mesi > 0, `l informativa non dice quanti mesi: «${celle?.[2]}»`).toBe(true);

    const { admin, scritture } = fintoDatabase();
    const rapporto = await eseguiPotature(admin, muto, adesso);
    expect(rapporto.fallite).toBe(0);

    const sugliUltimiVisti = scritture.filter((s) => s.tabella === 'recently_viewed');
    expect(sugliUltimiVisti.length, 'nessuna potatura tocca recently_viewed: la cronologia resta per sempre').toBe(1);
    const [potatura] = sugliUltimiVisti;
    expect(potatura.valori).toEqual({ cancella: true });
    // Dall'ultima visita (viewed_at), con i mesi scritti nella pagina (mesi da 30 giorni, come le altre).
    expect(potatura.filtri).toEqual([['lt', 'viewed_at', new Date(adesso - mesi * 30 * 86_400_000).toISOString()]]);
  }, 60000);

  it('la potatura è nel giro della notte vera (potatureNotturne, quello che chiama process-deletions)', () => {
    expect(potatureNotturne(Date.now()).map((p) => p.cosa)).toContain('recently_viewed');
  });
});

describe('R21-012 · il carosello si legge solo col consenso attivo', () => {
  const MARIA = 'maria-0000-4000-8000-000000000001';
  function dbCheConta() {
    const domande: string[] = [];
    const catena: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'in']) catena[m] = () => catena;
    catena.limit = async () => ({
      data: [{ viewed_at: '2026-11-12T10:00:00Z', product: { id: 'p1', name: 'Pane', price: 3, images: null, seller_id: 's1' } }],
      error: null,
    });
    catena.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: [{ id: 's1', is_approved: true, approval_status: 'approved', store_name: 'Forno' }], error: null }));
    const supa = { from: (t: string) => { domande.push(t); return catena; } };
    return { supa: supa as never, domande };
  }
  function consenso(analytics: boolean | null) {
    window.localStorage.clear();
    if (analytics === null) return;
    window.localStorage.setItem(
      CONSENT_STORAGE,
      JSON.stringify({ necessary: true, functional: false, analytics, marketing: false, ts: Date.now(), version: CONSENT_VERSION }),
    );
  }
  beforeEach(() => window.localStorage.clear());

  it('IL CASO CHE ROMPEVA — consenso tolto: niente lista e nessuna domanda al database', async () => {
    consenso(false);
    const { supa, domande } = dbCheConta();
    expect(await leggiVistiDiRecente(supa, { userId: MARIA })).toEqual([]);
    expect(domande, 'col consenso tolto il carosello rilegge la cronologia').not.toContain('recently_viewed');
  });

  it('nessuna scelta in questo browser (o consenso scaduto): non si legge', async () => {
    consenso(null);
    const { supa, domande } = dbCheConta();
    expect(await leggiVistiDiRecente(supa, { userId: MARIA })).toEqual([]);
    expect(domande).not.toContain('recently_viewed');
  });

  it('col consenso attivo la lista si legge come prima', async () => {
    consenso(true);
    const { supa, domande } = dbCheConta();
    await leggiVistiDiRecente(supa, { userId: MARIA });
    expect(domande).toContain('recently_viewed');
  });
});
