/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { AZIONI_AUDIT, ETICHETTE_AZIONI_AUDIT } from '@/lib/audit-azioni';

/**
 * 16/10/2026 — LA REGISTRAZIONE DEI CONTANTI FATTA DALL'AMMINISTRATORE NON SI
 * RITROVAVA NEL REGISTRO.
 *
 * Il lotto R33 ha aggiunto 'order.cash_declared': l'amministratore registra i
 * contanti al posto del fattorino, e il perche' (chi li ha dichiarati, quando)
 * vive solo nella riga del registro. La pagina «Audit log» aveva una lista di
 * etichette scritta a mano che non la conosceva, il menu «Filtra per azione»
 * nasceva da quella lista, e la pagina legge solo le ultime 200 righe: due
 * giornate di modifiche ai prodotti ('product.update', anche lei fuori lista)
 * e la riga spariva, senza un filtro per ritrovarla.
 *
 * Qui la pagina vera viene MONTATA e si guarda il menu che vede l'amministratore.
 */

let Pagina: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  const modulo = await monta('app/admin/audit/page.tsx');
  Pagina = modulo.default as ComponentType<Record<string, unknown>>;
}, 60000);

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__DATI_QUERY__;
  document.body.innerHTML = '';
});

function scelteDelFiltro(radice: HTMLElement): Map<string, string> {
  const menu = radice.querySelector('select');
  expect(menu, 'la pagina non ha piu il menu per filtrare le azioni').not.toBeNull();
  return new Map(Array.from(menu!.querySelectorAll('option')).map((o) => [o.value, (o.textContent ?? '').trim()]));
}

describe('il filtro del registro delle azioni', () => {
  it('offre «contanti registrati al posto del fattorino»', () => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = [];
    const s = accendi(Pagina);
    const scelte = scelteDelFiltro(s.radice);
    expect(
      scelte.has('order.cash_declared'),
      `il filtro non offre la registrazione dei contanti fatta dall amministratore. Scelte: ${[...scelte.values()].join(' · ')}`,
    ).toBe(true);
    expect(scelte.get('order.cash_declared')).toBe('Contanti registrati al posto del fattorino');
    s.smonta();
  });

  it('offre ogni azione che il registro puo contenere, ognuna col suo nome', () => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = [];
    const s = accendi(Pagina);
    const scelte = scelteDelFiltro(s.radice);
    const mancanti = AZIONI_AUDIT.filter((a) => !scelte.has(a));
    expect(mancanti, 'azioni che si scrivono nel registro ma non si possono filtrare').toEqual([]);
    const senzaNome = AZIONI_AUDIT.filter((a) => !ETICHETTE_AZIONI_AUDIT[a] || scelte.get(a) === a);
    expect(senzaNome, 'azioni offerte col codice grezzo invece che con un nome').toEqual([]);
    s.smonta();
  });

  it('la riga della registrazione dei contanti si legge col suo nome', () => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = [{
      id: 'a1',
      actor_id: 'amministratore-1',
      action: 'order.cash_declared',
      target_table: 'orders',
      target_id: '33333333-3333-4333-8333-333333333333',
      metadata: { nota: 'Luca al telefono, 14/10 ore 18', incassato_cents: 3800 },
      ip: null,
      created_at: '2026-10-15T09:00:00Z',
      actor: { full_name: 'Nicola', email: null },
    }];
    const s = accendi(Pagina);
    expect(testoVisibile(s.radice)).toContain('Contanti registrati al posto del fattorino');
    s.smonta();
  });
});
