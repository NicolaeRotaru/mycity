/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { eseguiPotature, type ClientePotature } from '@/lib/privacy/potature-ritenzione';

/**
 * R21-007 — CHI FA UNA SEGNALAZIONE LASCIAVA LA SUA EMAIL LI' PER SEMPRE.
 *
 * Chi segnala un prodotto o un negozio può lasciare un'email e un testo libero, anche senza account.
 * Nessun lavoro notturno toccava la tabella `segnalazioni`, e nell'informativa la parola
 * «segnalazione» non compariva: né come dato raccolto, né con una base giuridica, né con un tempo.
 *
 * La prova monta la pagina vera, legge quanti mesi promette, poi fa girare le potature della notte
 * a un'ora finta e guarda che cosa scrivono sulla tabella: email e testo azzerati, sulle righe
 * decise da più di quei mesi, e solo dove c'è ancora qualcosa da togliere.
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

/** Le celle della riga delle segnalazioni nella tabella «Finalità e conservazione». */
function rigaDelleSegnalazioni(): string[] | null {
  const s = accendi(Pagina);
  try {
    const righe = Array.from(s.radice.querySelectorAll('#finalita tbody tr'));
    expect(righe.length, 'la tabella non è comparsa: la prova non sta guardando niente').toBeGreaterThan(5);
    const riga = righe.find((r) => /segnalazion/i.test(testoVisibile(r.querySelector('td'))));
    return riga ? Array.from(riga.querySelectorAll('td')).map((c) => testoVisibile(c)) : null;
  } finally {
    s.smonta();
  }
}

describe('R21-007 · l email di chi segnala non resta per sempre', () => {
  it('l informativa ha la riga delle segnalazioni, con base giuridica e un tempo in mesi', () => {
    const celle = rigaDelleSegnalazioni();
    expect(celle, 'nessuna riga per le segnalazioni: email e testo senza tempo di conservazione').toBeTruthy();
    expect(celle![1]).toMatch(/2022\/2065|servizi digitali/);
    expect(celle![2]).toMatch(/^\d+ mesi dalla decisione/);
  }, 60000);

  it('fra i dati raccolti compaiono le segnalazioni, con l email facoltativa', () => {
    const s = accendi(Pagina);
    try {
      const voci = Array.from(s.radice.querySelectorAll('#dati li')).map((li) => testoVisibile(li));
      const voce = voci.find((t) => /segnalazion/i.test(t));
      expect(voce, 'le segnalazioni non compaiono fra i dati raccolti').toBeTruthy();
      expect(voce).toMatch(/email/);
    } finally {
      s.smonta();
    }
  }, 60000);

  it('IL CASO CHE ROMPEVA — la notte azzera email e testo delle segnalazioni decise da più dei mesi promessi', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T03:00:00Z'));
    const adesso = Date.now();

    const celle = rigaDelleSegnalazioni();
    const mesi = Number(/^(\d+) mesi/.exec(celle?.[2] ?? '')?.[1]);
    expect(Number.isFinite(mesi) && mesi > 0, `l informativa non dice quanti mesi: «${celle?.[2]}»`).toBe(true);

    const { admin, scritture } = fintoDatabase();
    const rapporto = await eseguiPotature(admin, muto, adesso);
    expect(rapporto.fallite).toBe(0);

    const sulleSegnalazioni = scritture.filter((s) => s.tabella === 'segnalazioni');
    expect(sulleSegnalazioni.length, 'nessuna potatura tocca le segnalazioni: l email resta per sempre').toBe(1);
    const [potatura] = sulleSegnalazioni;
    expect(potatura.valori).toEqual({ email_contatto: null, dettaglio: null });

    // La finestra parte dalla decisione, ed è quella scritta nella pagina (mesi da 30 giorni, come le altre).
    const soglia = new Date(adesso - mesi * 30 * 86_400_000).toISOString();
    expect(potatura.filtri).toContainEqual(['lt', 'deciso_at', soglia]);

    // Solo le righe con ancora qualcosa da togliere: la potatura si può ripetere ogni notte.
    const filtroPieni = potatura.filtri.find((f) => f[0] === 'or');
    expect(String(filtroPieni?.[1])).toMatch(/email_contatto\.not\.is\.null/);
    expect(String(filtroPieni?.[1])).toMatch(/dettaglio\.not\.is\.null/);
  }, 60000);
});
