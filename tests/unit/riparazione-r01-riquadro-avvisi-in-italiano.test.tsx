/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import ToastProvider from '@/components/providers/ToastProvider';

/**
 * R01-003 — Il riquadro degli avvisi si presentava al lettore di schermo come «Notifications
 * alt+T»: è il nome di fabbrica della regione di sonner (1.7.4), con la scorciatoia attaccata.
 * Qui gira il sonner vero: la prova legge il nome della regione che il lettore di schermo
 * annuncia, prima e dopo che arriva un avviso, e controlla che la scorciatoia porti davvero lì.
 */
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let radice: Root | null = null;
let div: HTMLDivElement | null = null;

async function montaAvvisi() {
  div = document.createElement('div');
  document.body.appendChild(div);
  radice = createRoot(div);
  await act(async () => { radice!.render(createElement(ToastProvider)); });
}
const attesa = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
/** La regione viva di sonner: quella che il lettore di schermo presenta col suo nome. */
const regione = () => document.querySelector<HTMLElement>('section[aria-live]');

afterEach(async () => {
  await act(async () => { toast.dismiss(); });
  await attesa(250);
  act(() => radice?.unmount());
  div?.remove();
});

describe('R01-003 — il riquadro degli avvisi parla italiano', () => {
  it('si chiama «Avvisi», con la scorciatoia, e non più «Notifications»', async () => {
    await montaAvvisi();
    const r = regione();
    expect(r, 'controprova: la regione degli avvisi di sonner deve essere nella pagina').toBeTruthy();
    const nome = r!.getAttribute('aria-label') ?? '';
    expect(nome).not.toMatch(/notifications/i);
    expect(nome).toBe('Avvisi, scorciatoia alt+T');
  });

  it('il nome resta italiano anche con un avviso a video, e alt+T porta il fuoco sugli avvisi', async () => {
    await montaAvvisi();
    await act(async () => { toast.info('Hai raggiunto il massimo per questo articolo.'); });
    await attesa();
    const r = regione()!;
    expect(r.querySelector('[data-sonner-toast]'), 'controprova: l\'avviso deve essere a video').toBeTruthy();
    expect(r.getAttribute('aria-label')).toBe('Avvisi, scorciatoia alt+T');

    // La scorciatoia annunciata è quella vera: Alt+T porta il fuoco sull'elenco degli avvisi.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'KeyT', key: 't', bubbles: true }));
    });
    expect(r.contains(document.activeElement), 'alt+T deve portare il fuoco dentro il riquadro degli avvisi').toBe(true);
  });
});
