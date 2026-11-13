/**
 * @vitest-environment jsdom
 */
/**
 * R06-012 (12/11/2026) — LA PERCENTUALE DEI PAGAMENTI CON CARTA SI CALCOLAVA SU
 * MILLE TENTATIVI QUALSIASI.
 *
 * La Panoramica chiedeva `.limit(5000)` senza ordine: il database ne consegna al
 * massimo mille per richiesta, e la percentuale si presentava come quella dei
 * trenta giorni. Qui la lettura vera della pagina gira contro un finto database
 * col tetto di mille righe e 1.500 tentativi: 1.000 riusciti e 500 rifiutati.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { creaPostgrestColTetto, type Riga } from './aiuti/riparazione-r06-postgrest-col-tetto';

type Lettura = { queryKey?: unknown[]; queryFn?: () => Promise<Record<string, unknown>> };
const globale = globalThis as Record<string, unknown>;

afterEach(() => {
  delete globale.__DATI_QUERY__;
  delete globale.__CLIENT_SUPABASE__;
});

describe('R06-012 · il tasso dei pagamenti con carta', () => {
  it('si calcola su tutti i tentativi dei trenta giorni, non sui primi mille', async () => {
    const letture: Lettura[] = [];
    globale.__DATI_QUERY__ = (opzioni: Lettura) => { letture.push(opzioni); return undefined; };
    const mod = await monta('app/admin/page.tsx');
    const s = accendi(mod.default as ComponentType);
    s.smonta();
    const lettura = letture.find((l) => JSON.stringify(l.queryKey ?? []).includes('tasso-autorizzazione'));
    expect(lettura, 'la Panoramica non ha la lettura del tasso di autorizzazione').toBeTruthy();

    const adesso = Date.now();
    const tentativi: Riga[] = [];
    for (let i = 0; i < 1500; i++) {
      tentativi.push({
        id: `t-${String(i).padStart(4, '0')}`,
        created_at: new Date(adesso - (i + 1) * 60_000).toISOString(),
        // I primi mille della tabella sono tutti riusciti: chi legge solo quelli vede 100%.
        status: i < 1000 ? 'succeeded' : 'failed',
        decline_code: i < 1000 ? null : 'insufficient_funds',
        error_code: null,
      });
    }
    globale.__CLIENT_SUPABASE__ = creaPostgrestColTetto({ payment_attempts: tentativi }).client;
    const esito = await lettura!.queryFn!();

    expect(esito.tentativi, 'Il tasso si e\' fermato ai primi mille tentativi che il database consegna').toBe(1500);
    expect(esito.falliti).toBe(500);
  }, 60000);
});
