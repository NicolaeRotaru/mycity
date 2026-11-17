// @vitest-environment jsdom
/**
 * R02-001 — Il registro della chat (aria-live) non deve leggere tutto il filo al primo
 * caricamento né dopo «Riprova»: è spento mentre il filo arriva, i messaggi caricati entrano
 * a registro spento, e solo dopo il registro diventa «polite» (per i messaggi nuovi dal vivo).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;
const CONVERSAZIONE = {
  id: 'c1', buyer_id: 'u1', seller_id: 'v1',
  buyer: { full_name: 'Marta Rossi', store_name: null },
  seller: { full_name: null, store_name: 'Pane Quotidiano' },
};
const TESTO = 'È pronto il pane?';
const MESSAGGI = [
  { id: 'm1', conversation_id: 'c1', sender_id: 'u1', body: TESTO, created_at: '2026-11-12T08:00:00Z' },
];
const eMessaggi = (o: { queryKey: unknown[] }) => o.queryKey.length === 2 && o.queryKey[0] === 'messages';

afterEach(() => {
  globali.__UTENTE__ = undefined; globali.__DATI_QUERY__ = undefined; globali.__ESITO_QUERY__ = undefined;
});

async function apri() {
  globali.__UTENTE__ = { id: 'u1' };
  globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (eMessaggi(o) ? MESSAGGI : CONVERSAZIONE);
  const mod = await monta('app/messages/[id]/page.tsx');
  const s = accendi(mod.default, { params: { id: 'c1' } });
  await attendi();
  return s;
}

describe('R02-001 · registro live della chat', () => {
  it('mentre il filo arriva (primo giro, o ricaricamento dopo «Riprova») non è una regione live attiva', async () => {
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      eMessaggi(o) ? { isSuccess: false, isPending: true, isLoading: true, data: undefined } : undefined;
    const s = await apri();
    const filo = s.radice.querySelector('[role="log"]')!;
    expect(filo).not.toBeNull();
    expect(filo.getAttribute('aria-live')).toBe('off');
    s.smonta();
  }, 60000);

  it('con la lettura caduta (il pulsante «Riprova» a video) resta spento', async () => {
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      eMessaggi(o) ? { isSuccess: false, isError: true, data: undefined } : undefined;
    const s = await apri();
    expect(s.radice.textContent).toContain('Riprova');
    expect(s.radice.querySelector('[role="log"]')!.getAttribute('aria-live')).toBe('off');
    s.smonta();
  }, 60000);

  it('il filo caricato entra a registro spento; poi il registro diventa polite', async () => {
    // Si annota ogni cambio del DOM: per sapere com'era il registro NEL MOMENTO in cui i
    // messaggi sono entrati, non solo alla fine.
    const annotati: MutationRecord[] = [];
    const osservatore = new MutationObserver((r) => { annotati.push(...r); });
    osservatore.observe(document.body, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['aria-live'], attributeOldValue: true,
    });
    const s = await apri();
    annotati.push(...osservatore.takeRecords());
    osservatore.disconnect();

    const filo = s.radice.querySelector('[role="log"]')!;
    expect(filo.textContent).toContain(TESTO);
    // A filo caricato il registro è acceso, per i messaggi che arrivano dopo.
    expect(filo.getAttribute('aria-live')).toBe('polite');

    // Il momento in cui il messaggio è entrato nella pagina: l'ULTIMA aggiunta di lui o di un suo
    // contenitore (il testo di un nodo si legge adesso, alla fine, non quando è entrato).
    const messaggio = Array.from(filo.querySelectorAll('p')).find((p) => (p.textContent ?? '').includes(TESTO))!;
    let entrata = -1;
    annotati.forEach((r, i) => {
      if (r.type === 'childList' && Array.from(r.addedNodes).some((n) => n.contains(messaggio))) entrata = i;
    });
    expect(entrata).toBeGreaterThanOrEqual(0);
    const cambioDopo = annotati.slice(entrata + 1).find((r) => r.type === 'attributes' && r.target === filo);
    const alMomentoDellEntrata = cambioDopo ? cambioDopo.oldValue : filo.getAttribute('aria-live');
    expect(alMomentoDellEntrata).toBe('off');
    s.smonta();
  }, 60000);
});
