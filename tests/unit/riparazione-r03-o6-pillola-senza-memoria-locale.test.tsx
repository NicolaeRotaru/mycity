/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

/**
 * 17/11/2026 (R03-009) — LA PILLOLA DELLA POSIZIONE E IL BROWSER CHE NON DÀ LA MEMORIA.
 *
 * In navigazione privata, o con i dati dei siti bloccati, il browser fa lanciare
 * `localStorage.getItem`. La pillola «Consegna a …» leggeva il fumetto già chiuso
 * senza protezione, in un effetto al montaggio: l'errore saliva fino in cima e la
 * barra in alto spariva (o la pagina andava in errore). Qui la memoria lancia su
 * lettura e scrittura, e la pillola deve restare in piedi e funzionare.
 */

function trovaPillola(radice: HTMLElement) {
  return [...radice.querySelectorAll('button')].find(
    (b) => b.getAttribute('title') === 'Cambia indirizzo di consegna',
  );
}

describe('R03-009 · la pillola della posizione con la memoria locale che lancia', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('si monta, resta in piedi, si apre e salva un CAP', async () => {
    const mod = await monta('components/LocationPill.tsx');

    const rifiuta = () => {
      throw new DOMException('La memoria del sito è bloccata', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(rifiuta);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(rifiuta);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();

    const errori: unknown[] = [];
    const suErrore = (e: ErrorEvent) => {
      errori.push(e.error ?? e.message);
      e.preventDefault();
    };
    window.addEventListener('error', suErrore);

    let s: ReturnType<typeof accendi> | undefined;
    try {
      // Non compatta: è la forma della testata del computer, quella che legge il fumetto.
      s = accendi(mod.default, {});
      s.agisci(() => {
        vi.advanceTimersByTime(2000);
      });
    } catch (e) {
      errori.push(e);
    }

    expect(errori, 'Montando la pillola con la memoria bloccata è partito un errore').toEqual([]);
    const pillola = s ? trovaPillola(s.radice) : undefined;
    expect(pillola, 'La pillola della posizione è sparita: la barra è andata in errore').toBeTruthy();

    // Si apre e salva un CAP anche se non lo può ricordare.
    s!.agisci(() => clicca(pillola!));
    const tendina = s!.radice.querySelector<HTMLElement>('[role="dialog"]');
    expect(tendina, 'La tendina del CAP non si apre').toBeTruthy();
    const campo = tendina!.querySelector('input') as HTMLInputElement;
    const imposta = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    s!.agisci(() => {
      imposta?.call(campo, '29122');
      campo.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const salva = [...tendina!.querySelectorAll('button')].find((b) =>
      /Aggiorna posizione/.test(b.textContent ?? ''),
    )!;
    s!.agisci(() => clicca(salva));

    expect(errori, 'Salvando il CAP con la memoria bloccata è partito un errore').toEqual([]);
    expect(s!.radice.querySelector('[role="dialog"]'), 'La tendina non si chiude dopo il salvataggio').toBeNull();
    expect(trovaPillola(s!.radice)?.getAttribute('aria-label')).toContain('29122');

    window.removeEventListener('error', suErrore);
    s!.smonta();
  }, 60000);
});
