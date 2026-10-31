/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';
import * as interruttori from '@/lib/funzioni-al-lancio';

/**
 * 31/10/2026 — CON L'AI PER I NEGOZI SPENTA, L'ASSISTENZA NON OFFRE AL NEGOZIANTE
 * «MODIFICA UN PRODOTTO CON L'AI».
 *
 * Carta #209, firmata da Nicola: al lancio l'AI per i negozi è spenta
 * (lib/funzioni-al-lancio.ts) e in produzione ANTHROPIC_API_KEY non c'è. Il caso
 * vero: il negoziante di Pane Quotidiano tocca il pulsante tondo «Assistenza»
 * (montato in app/layout.tsx per chiunque abbia fatto l'accesso) e la prima
 * scelta della finestra era «Modifica un prodotto con l'AI». Quella voce apre
 * l'assistente prodotti, che chiama /api/ai/catalog-chat e risponde «Servizio AI
 * non configurato»: una porta chiusa messa davanti alle domande vere.
 *
 * Si monta la finestra vera e il pulsante vero, con l'interruttore vero: se Nicola
 * riaccende l'AI, la prova salta (skipIf) e va riscritta con la riaccensione.
 */

const globali = globalThis as Record<string, unknown>;

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__PROFILO__', '__PERCORSO_FINTO__']) globali[k] = undefined;
});

const AI = /Modifica un prodotto con l.AI|trovo il prodotto e lo aggiorno/i;

describe.skipIf(interruttori.AI_NEGOZI_ACCESA)('AI per i negozi spenta: l\'assistenza del negozio', () => {
  it('la finestra aperta da un negoziante non offre «Modifica un prodotto con l\'AI»', async () => {
    const mod = await monta('components/SupportChatModal.tsx');
    const s = accendi(mod.default as never, { open: true, onClose: () => {}, role: 'seller' });
    await attendi();
    const testo = testoVisibile(s.radice);
    expect(testo, 'controprova: le domande del negozio si devono vedere').toContain('Non ricevo i pagamenti');
    expect(testo, 'la prima scelta porta a /api/ai/catalog-chat, che risponde «Servizio AI non configurato»').not.toMatch(AI);
    s.smonta();
  }, 60000);

  it('il pulsante «Assistenza» del sito, toccato da un negoziante, non apre l\'AI', async () => {
    globali.__PROFILO__ = { isAuthenticated: true, isSeller: true, profile: { id: 'negozio-1', store_name: 'Pane Quotidiano' } };
    globali.__PERCORSO_FINTO__ = '/seller/orders';
    const mod = await monta('components/SupportChatButton.tsx');
    const s = accendi(mod.default, {});
    const pulsante = s.radice.querySelector<HTMLButtonElement>('button[aria-label="Assistenza"]');
    expect(pulsante, 'controprova: il pulsante dell\'assistenza si deve vedere').toBeTruthy();
    s.agisci(() => clicca(pulsante!));
    for (let i = 0; i < 40 && !testoVisibile(s.radice).includes('Non ricevo i pagamenti'); i += 1) await attendi();
    const testo = testoVisibile(s.radice);
    expect(testo, 'controprova: la finestra del negozio si deve aprire').toContain('Non ricevo i pagamenti');
    expect(testo, 'il pulsante Assistenza offre al negoziante un\'AI che non risponde').not.toMatch(AI);
    s.smonta();
  }, 60000);
});
