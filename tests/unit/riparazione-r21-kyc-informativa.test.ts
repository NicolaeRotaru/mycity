/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import {
  eseguiPotature,
  GIORNI_DOCUMENTI_ISCRIZIONE_A_META,
  type ClientePotature,
} from '@/lib/privacy/potature-ritenzione';

/**
 * R21-009 — L'INFORMATIVA DICEVA CHE TENIAMO I DOCUMENTI D'IDENTITÀ PER L'ANTIRICICLAGGIO.
 *
 * La riga diceva «Verifica KYC e antiriciclaggio — Obbligo di legge — 10 anni dalla cessazione
 * rapporto». I dieci anni li aveva già tolti il 5/11; restavano «antiriciclaggio» e «Obbligo di
 * legge»: un marketplace non risulta fra i soggetti obbligati, e il sito i documenti li cancella
 * a 90 giorni (respinti), a {GIORNI_DOCUMENTI_ISCRIZIONE_A_META} (iscrizione a metà) e subito alla
 * cancellazione dell'account. Una base giuridica che non regge è una contestazione scritta da noi.
 *
 * La prova monta la pagina vera e legge la riga come la legge chi la apre. I giorni non li copia:
 * li chiede al codice, facendo girare le potature della notte e guardando che cosa passano.
 *
 * ⚪ Che la base giuridica sia giusta per la legge non lo dice una prova: lo dice il legale.
 */

let Pagina: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  Pagina = (await monta('app/privacy/page.tsx')).default as ComponentType<Record<string, unknown>>;
}, 60000);

function rigaDeiDocumenti(): string[] {
  const s = accendi(Pagina);
  try {
    const righe = Array.from(s.radice.querySelectorAll('#finalita tbody tr'));
    expect(righe.length, 'la tabella non è comparsa: la prova non sta guardando niente').toBeGreaterThan(5);
    const riga = righe.find((r) => /KYC|identit/i.test(testoVisibile(r.querySelector('td'))));
    expect(riga, 'nessuna riga per i documenti d identità').toBeTruthy();
    return Array.from(riga!.querySelectorAll('td')).map((c) => testoVisibile(c));
  } finally {
    s.smonta();
  }
}

/** I giorni che la notte passa davvero alla funzione che toglie i documenti dei respinti. */
async function giorniDeiRespinti(): Promise<unknown> {
  const chiamate: Array<{ nome: string; argomenti?: Record<string, unknown> }> = [];
  const catena: Record<string, unknown> = {
    then: (ok: (v: { error: null }) => unknown) => Promise.resolve(ok({ error: null })),
  };
  for (const f of ['eq', 'lt', 'is', 'not', 'or']) catena[f] = () => catena;
  const admin = {
    from: () => ({ update: () => catena, delete: () => catena }),
    rpc: async (nome: string, argomenti?: Record<string, unknown>) => {
      chiamate.push({ nome, argomenti });
      return { data: [], error: null };
    },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  } as unknown as ClientePotature;
  await eseguiPotature(admin, { info: () => {}, warn: () => {}, error: () => {} }, Date.parse('2026-11-13T03:00:00Z'));
  return chiamate.find((c) => c.nome === 'documenti_da_cancellare_respinti')?.argomenti?.p_giorni;
}

describe('R21-009 · la riga dei documenti d identità dice quello che il sito fa', () => {
  it('IL CASO CHE ROMPEVA — niente «antiriciclaggio» e niente «obbligo di legge» che non c è', () => {
    const [finalita, base] = rigaDeiDocumenti();
    expect(`${finalita} ${base}`).not.toMatch(/antiriciclaggio/i);
    expect(base).not.toMatch(/obbligo di legge/i);
    expect(base).toMatch(/6\.1\.b/);
    expect(base).toMatch(/6\.1\.f/);
  }, 60000);

  it('i tempi sono quelli del codice: respinti, iscrizione a metà e cancellazione dell account', async () => {
    const [, , conservazione] = rigaDeiDocumenti();
    const respinti = await giorniDeiRespinti();
    expect(typeof respinti, 'la notte non toglie più i documenti dei respinti').toBe('number');
    expect(conservazione).toContain(`respinta: ${respinti} giorni`);
    expect(conservazione).toContain(`${GIORNI_DOCUMENTI_ISCRIZIONE_A_META} giorni`);
    expect(conservazione).toMatch(/cancellazione dell.account/);
    expect(conservazione).not.toMatch(/10 anni/);
  }, 60000);
});
