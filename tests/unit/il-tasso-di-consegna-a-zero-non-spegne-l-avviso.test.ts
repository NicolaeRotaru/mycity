/**
 * @vitest-environment jsdom
 */
/**
 * 8/9/2026 — L'AVVISO SPARIVA PROPRIO NEL GIORNO PEGGIORE.
 *
 * La Panoramica dell'amministratore accendeva l'avviso rosso «verifica gli
 * ordini bloccati» così:
 *
 *     const fulfillmentRate = closedOrders > 0 ? (delivered / closedOrders) * 100 : 0;
 *     const fulfillmentLow  = fulfillmentRate > 0 && fulfillmentRate < 95;
 *
 * Quel `> 0` serviva a non gridare quando non c'erano ancora dati. Ma «non ho
 * dati» e «non è stato consegnato niente» fanno zero tutti e due, e sullo zero
 * l'avviso taceva. Al 94% compariva, al 9,1% compariva, allo 0% no.
 *
 * Il giorno peggiore possibile — dieci ordini lavorati e nessuno consegnato,
 * per esempio perché nessun fattorino sta prendendo i giri — la pagina mostrava
 * un riquadro «0,0%» e nient'altro. Chi apriva il pannello vedeva una pagina
 * tranquilla.
 *
 * Qui la decisione viene ESEGUITA (`verdettoConsegne`), e poi la Panoramica
 * viene montata per davvero, con React e il DOM, per dimostrare che la pagina
 * quella decisione la USA invece di essersi rifatta il suo ramo per conto suo.
 *
 * Quello che questa prova NON copre, e va detto: il dato arriva già pronto
 * (`__DATI_QUERY__`), quindi non passa dalla lettura vera del database. Che
 * `admin_kpi` risponda con quei campi lo tiene la migrazione, non questa prova.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { NON_LETTO } from '@/lib/letture-cruscotto';
import { rapporto, verdettoConsegne, percentualeATesto } from '@/lib/salute-marketplace';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

describe('un rapporto senza denominatore non vale zero', () => {
  it('senza niente da contare risponde «non lo so», non zero', () => {
    expect(rapporto(0, 0), 'zero vorrebbe dire «ho guardato e non è arrivato niente»').toBeNull();
    expect(rapporto(7, 0)).toBeNull();
  });

  it('con il denominatore risponde il conto', () => {
    expect(rapporto(94, 100)).toBe(0.94);
  });

  it('«non lo so» si scrive col trattino, non con «0,0%»', () => {
    expect(percentualeATesto(null)).toBe(NON_LETTO);
    expect(percentualeATesto(0)).toBe('0,0%');
  });
});

describe('il tasso di consegna e il suo avviso', () => {
  it('dieci ordini lavorati e nessuno consegnato: l\'avviso c\'è, ed è il caso che prima taceva', () => {
    const v = verdettoConsegne({ letto: true, consegnati: 0, chiusi: 10 });

    expect(v.valore).toBe('0,0%');
    expect(v.avviso, 'e` il giorno peggiore: e` proprio qui che l\'avviso deve esserci').not.toBeNull();
    expect(v.avviso).toContain('Nessuno dei 10 ordini lavorati');
  });

  it('con un ordine solo, non consegnato, lo dice al singolare', () => {
    const v = verdettoConsegne({ letto: true, consegnati: 0, chiusi: 1 });
    expect(v.avviso).toBe('L\'unico ordine lavorato non risulta consegnato');
  });

  it('a un ordine su undici l\'avviso c\'era gia\', e resta', () => {
    // 9,1%: il caso che passava anche prima. Non deve essersi rotto.
    const v = verdettoConsegne({ letto: true, consegnati: 1, chiusi: 11 });
    expect(v.valore).toBe('9,1%');
    expect(v.avviso).toBe('Il tasso di consegna è sotto l\'obiettivo');
  });

  it('al 94% l\'avviso c\'è, al 96% no', () => {
    expect(verdettoConsegne({ letto: true, consegnati: 94, chiusi: 100 }).avviso).not.toBeNull();
    expect(verdettoConsegne({ letto: true, consegnati: 96, chiusi: 100 }).avviso).toBeNull();
  });

  it('a obiettivo esatto non si grida', () => {
    expect(verdettoConsegne({ letto: true, consegnati: 95, chiusi: 100 }).avviso).toBeNull();
  });

  it('senza ordini lavorati non è «0,0%»: è «—», e non si grida', () => {
    // Il primo giorno del marketplace non e` un guasto delle consegne. Un
    // avviso che grida sempre si impara a ignorare.
    const v = verdettoConsegne({ letto: true, consegnati: 0, chiusi: 0 });

    expect(v.tasso, 'non e` zero per cento: e` «non lo so»').toBeNull();
    expect(v.valore).toBe(NON_LETTO);
    expect(v.nota).toBe('nessun ordine ancora lavorato');
    expect(v.avviso).toBeNull();
  });

  it('sulla lettura fallita ammette il guasto, e non inventa una percentuale', () => {
    const v = verdettoConsegne({ letto: true, errore: { message: 'boom' }, consegnati: 0, chiusi: 10 });

    expect(v.valore).toBe(NON_LETTO);
    expect(v.guasto).toBe(true);
    expect(v.avviso, 'una lettura caduta non e` un guasto delle consegne').toBeNull();
  });

  it('prima di aver letto non dice niente sul mondo', () => {
    const v = verdettoConsegne({ letto: false, consegnati: 0, chiusi: 0 });
    expect(v.valore).toBe(NON_LETTO);
    expect(v.avviso).toBeNull();
  });
});

/**
 * E ADESSO SULLO SCHERMO VERO.
 */
type Ordini = { total: number; byStatus: Record<string, number> };

/** La risposta finta della lettura `['admin','stats']`, nella forma che legge la pagina. */
function apriLaPanoramica(ordini: Ordini): void {
  const statistiche = {
    users: { total: 12, buyers: 8, sellers: 3, riders: 1, admins: 1 },
    orders: { total: ordini.total, recent: 3, byStatus: ordini.byStatus, revenue: 0 },
    products: { total: 40, available: 31 },
    commissioniReali: 0,
  };
  (globalThis as Record<string, unknown>).__DATI_QUERY__ = (o: { queryKey?: readonly unknown[] }) =>
    Array.isArray(o?.queryKey) && o.queryKey[0] === 'admin' && o.queryKey[1] === 'stats'
      ? statistiche
      : undefined;
}

function chiudiLaPanoramica(): void {
  document.body.innerHTML = '';
  delete (globalThis as Record<string, unknown>).__DATI_QUERY__;
}

async function testoDellaPanoramica(): Promise<string> {
  const mod = await monta('app/admin/page.tsx');
  const s = accendi(mod.default as ComponentType);
  const testo = s.radice.textContent ?? '';
  s.smonta();
  return testo;
}

describe('e sulla Panoramica vera l\'avviso si vede', () => {
  afterEach(chiudiLaPanoramica);

  it('dieci ordini lavorati, zero consegnati: la pagina manda a guardare gli ordini bloccati', async () => {
    // READY = preparati e fermi li`: nessun fattorino li sta prendendo.
    apriLaPanoramica({ total: 12, byStatus: { NEW: 1, ACCEPTED: 1, READY: 10, DELIVERED: 0 } });
    const testo = await testoDellaPanoramica();

    expect(testo).toContain('0,0%');
    expect(
      testo,
      'il riquadro dice «0,0%» e la pagina resta tranquilla: e` il difetto',
    ).toContain('verifica gli ordini bloccati');
    expect(testo).toContain('Nessuno dei 10 ordini lavorati');
  }, 120000);

  it('col marketplace sano non dice niente', async () => {
    apriLaPanoramica({ total: 100, byStatus: { DELIVERED: 98, CANCELED: 2 } });
    const testo = await testoDellaPanoramica();

    expect(testo).toContain('98,0%');
    expect(testo).not.toContain('verifica gli ordini bloccati');
  }, 120000);

  it('senza ordini lavorati il riquadro ammette che non c\'è niente da contare', async () => {
    apriLaPanoramica({ total: 4, byStatus: { NEW: 3, ACCEPTED: 1 } });
    const testo = await testoDellaPanoramica();

    expect(testo).toContain('nessun ordine ancora lavorato');
    expect(testo, 'nessun ordine lavorato non e` un guasto delle consegne').not.toContain(
      'verifica gli ordini bloccati',
    );
  }, 120000);
});
