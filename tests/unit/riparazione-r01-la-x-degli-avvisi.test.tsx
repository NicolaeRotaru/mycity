/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import ToastProvider from '@/components/providers/ToastProvider';

/**
 * R01-001 — La X degli avvisi diceva «Close toast» in inglese a chi usa il lettore di schermo, e
 * sugli avvisi di caricamento («Cerco il prodotto dal codice EAN…») c'era ma non chiudeva niente:
 * sonner (1.7.4) non chiude mai un avviso di tipo «loading», e non lascia cambiare l'etichetta
 * dal Toaster. Ora la X si chiama «Chiudi avviso» e sui caricamenti non si mostra; quando il
 * caricamento diventa un esito, la X torna e chiude davvero.
 * Qui gira il sonner vero: la prova guarda i pulsanti che il lettore di schermo trova.
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
const avvisi = () => [...document.querySelectorAll<HTMLElement>('[data-sonner-toast]')];
const laX = (avviso: HTMLElement) => avviso.querySelector<HTMLButtonElement>('button[data-close-button]');
/** Una X che il negoziante può vedere e premere: c'è e non è nascosta. */
const xVisibile = (avviso: HTMLElement) => {
  const x = laX(avviso);
  return !!x && x.style.display !== 'none' && getComputedStyle(x).display !== 'none' && !x.hidden;
};

afterEach(async () => {
  await act(async () => { toast.dismiss(); });
  await attesa(250);
  act(() => radice?.unmount());
  div?.remove();
});

describe('R01-001 — la X degli avvisi', () => {
  it('si chiama «Chiudi avviso», in italiano', async () => {
    await montaAvvisi();
    await act(async () => { toast.error('Non sono riuscito a salvare il prodotto.'); });
    await attesa();
    const [avviso] = avvisi();
    expect(avviso, 'controprova: l\'avviso deve essere a video').toBeTruthy();
    const x = laX(avviso);
    expect(x, 'controprova: l\'avviso deve avere la X').toBeTruthy();
    expect(x!.getAttribute('aria-label')).toBe('Chiudi avviso');
  });

  it('su un caricamento la X non si mostra; quando il caricamento diventa un esito torna e chiude', async () => {
    await montaAvvisi();
    let id: string | number = '';
    await act(async () => { id = toast.loading('Cerco il prodotto dal codice EAN…'); });
    await attesa();
    const [caricamento] = avvisi();
    expect(caricamento?.getAttribute('data-type'), 'controprova: l\'avviso di caricamento deve essere a video').toBe('loading');
    expect(xVisibile(caricamento), 'sul caricamento c\'è una X che non chiude niente').toBe(false);

    await act(async () => { toast.success('Compilato dal codice EAN', { id }); });
    await attesa();
    const [esito] = avvisi();
    expect(esito.getAttribute('data-type')).toBe('success');
    expect(xVisibile(esito), 'l\'esito deve avere la sua X').toBe(true);
    expect(laX(esito)!.getAttribute('aria-label')).toBe('Chiudi avviso');
    await act(async () => { laX(esito)!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await attesa(300);
    expect(avvisi(), 'la X dell\'esito deve chiudere l\'avviso').toHaveLength(0);
  });
});
