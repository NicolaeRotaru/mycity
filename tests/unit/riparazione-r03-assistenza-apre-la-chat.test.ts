/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement, useState, type ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * R03-023 — Dopo aver scritto all'assistenza la chat si apre.
 *
 * SupportChatModal chiamava `useCloseOnBack(open, onClose)` e buttava via il riferimento che il
 * gancio restituisce. Dopo l'invio faceva `onClose()` e poi `router.push` verso la chat: alla
 * chiusura la pulizia del gancio trovava «non sto navigando» e chiamava `history.back()`, che
 * annullava la navigazione appena partita. Il cliente restava sulla pagina, senza conferma.
 *
 * Si monta la finestra vera dentro un involucro che la chiude davvero (onClose → open=false).
 */

const globali = globalThis as Record<string, unknown>;

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__NAVIGAZIONI__', '__UTENTE__', '__GETTONE__']) globali[k] = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('R03-023 — dopo «Invia» si apre la chat con l assistenza', () => {
  it('push verso /messages/c1 e nessun history.back che la annulli', async () => {
    globali.__NAVIGAZIONI__ = [];
    globali.__UTENTE__ = { id: 'cliente-1', email: 'c@test.it' };
    globali.__GETTONE__ = 'gettone';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ conversationId: 'c1', supportId: 's1' }), { status: 200 })));
    const indietro = vi.spyOn(window.history, 'back').mockImplementation(() => {});

    const Modale = (await monta('components/SupportChatModal.tsx')).default as ComponentType<Record<string, unknown>>;
    function Involucro() {
      const [open, setOpen] = useState(true);
      return createElement(Modale, { open, onClose: () => setOpen(false), role: 'buyer' });
    }
    const s = accendi(Involucro, {});
    await attendi();
    const argomento = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Dov'));
    expect(argomento, 'controprova: l argomento pronto si deve vedere').toBeTruthy();
    s.agisci(() => clicca(argomento!));
    for (let i = 0; i < 20; i++) await attendi();

    const navigazioni = globali.__NAVIGAZIONI__ as Array<{ tipo: string; dove: string }>;
    expect(navigazioni).toContainEqual({ tipo: 'push', dove: '/messages/c1' });
    expect(indietro, 'history.back() annulla la navigazione verso la chat').not.toHaveBeenCalled();
    s.smonta();
  }, 60000);
});
