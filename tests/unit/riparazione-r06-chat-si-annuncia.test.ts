/**
 * @vitest-environment jsdom
 */
/**
 * R06-003 (12/11/2026) — NELLA CHAT I MESSAGGI NUOVI ARRIVAVANO IN SILENZIO.
 *
 * Il filo riceve i messaggi dal vivo, ma il contenitore non era un registro che
 * si annuncia: niente role="log", niente aria-live. Un cliente non vedente
 * chiedeva «è pronto il pane?» e la risposta compariva senza che il lettore di
 * schermo dicesse niente. Ogni bolla dice anche chi l'ha scritta.
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
const MESSAGGI = [
  { id: 'm1', conversation_id: 'c1', sender_id: 'u1', body: 'È pronto il pane?', created_at: '2026-11-12T08:00:00Z' },
  { id: 'm2', conversation_id: 'c1', sender_id: 'v1', body: 'Sì, tra dieci minuti', created_at: '2026-11-12T08:01:00Z' },
];

afterEach(() => { globali.__UTENTE__ = undefined; globali.__DATI_QUERY__ = undefined; });

describe('R06-003 · la chat col negozio e il lettore di schermo', () => {
  it('il filo e\' un registro che annuncia i messaggi nuovi, e ogni bolla dice chi scrive', async () => {
    globali.__UTENTE__ = { id: 'u1' };
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
      o.queryKey.length === 2 && o.queryKey[0] === 'messages' ? MESSAGGI : CONVERSAZIONE;
    const mod = await monta('app/messages/[id]/page.tsx');
    const s = accendi(mod.default, { params: { id: 'c1' } });
    await attendi();

    const filo = s.radice.querySelector('[role="log"]');
    expect(filo, 'Il filo dei messaggi non e\' un registro: i messaggi nuovi arrivano in silenzio').not.toBeNull();
    expect(filo!.getAttribute('aria-live')).toBe('polite');
    expect(filo!.getAttribute('aria-relevant')).toBe('additions');
    expect(filo!.getAttribute('aria-label')).toBe('Messaggi della conversazione');
    const testo = filo!.textContent ?? '';
    expect(testo).toContain('Tu: È pronto il pane?');
    expect(testo).toContain('Pane Quotidiano: Sì, tra dieci minuti');
    s.smonta();
  }, 60000);
});
