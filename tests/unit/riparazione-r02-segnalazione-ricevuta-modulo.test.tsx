// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R02-010 — Il modulo «Segnala» mostra il numero della segnalazione e, se la rotta l'ha mandata,
 * dice che la ricevuta è partita per email. Prima diceva solo «Segnalazione ricevuta: la
 * esaminiamo.» e chi chiudeva la pagina restava senza numero.
 */

const successi = vi.hoisted(() => [] as string[]);
vi.mock('sonner', () => ({ toast: { success: (m: string) => successi.push(m), error: vi.fn() } }));

const ID = '5e9a1a2b-0000-4000-8000-000000000042';

describe('R02-010 — il modulo dice numero e ricevuta', () => {
  let root: Root | null = null;
  let box: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    successi.length = 0;
    box = document.createElement('div');
    document.body.appendChild(box);
  });
  afterEach(async () => { await act(async () => { root?.unmount(); }); box.remove(); vi.unstubAllGlobals(); });

  async function inviaCon(risposta: Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(risposta), { status: 201 })));
    const { Segnala } = await import('@/components/Segnala');
    root = createRoot(box);
    await act(async () => { root!.render(createElement(Segnala, { tipo: 'prodotto', oggettoId: '00000000-0000-4000-8000-000000000001' })); });
    const pulsante = [...box.querySelectorAll('button')].find((b) => b.textContent?.includes('Segnala questo contenuto'))!;
    await act(async () => { pulsante.click(); });
    const invia = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('Invia segnalazione'))!;
    await act(async () => { invia.click(); });
  }

  it('IL CASO CHE ROMPEVA — con la ricevuta partita, il numero e «conferma per email»', async () => {
    await inviaCon({ ok: true, id: ID, conferma: 'inviata' });
    expect(successi.at(-1)).toContain(ID);
    expect(successi.at(-1)).toMatch(/conferma per email/);
  });

  it('senza ricevuta partita non promette l\'email, ma il numero resta', async () => {
    await inviaCon({ ok: true, id: ID, conferma: 'nessun_recapito' });
    expect(successi.at(-1)).toContain(ID);
    expect(successi.at(-1)).not.toMatch(/email/);
  });
});
