import { describe, it, expect } from 'vitest';
import { puoAvviareLavoro, testoStatoLavoro } from '@/lib/ai/statoLavoroCatalogo';

/**
 * Un invio rimasto senza risposta per 24 ore: lo stato chiude il lavoro come fallito col motivo
 * «chiedi all'assistenza prima di avviarne un altro» (app/api/ai/catalog-batch/status/route.ts).
 * La riga di stato non dice piu' «Puoi avviarne un altro», ma il pulsante «Avvia sul catalogo»
 * restava li' sopra: la stessa contraddizione, detta da un pulsante, con lo stesso rischio di un
 * lotto pagato due volte. Pulsante e riga seguono una regola sola.
 */

const MOTIVO_DELLO_STATO =
  "invio senza risposta da 24 ore: il lotto potrebbe essere partito ed essere stato pagato; chiedi all'assistenza prima di avviarne un altro";

describe('sotto un lavoro chiuso che dice di chiedere all assistenza, il pulsante «Avvia» non c e', () => {
  it('fallito col motivo dello stato: niente pulsante', () => {
    expect(puoAvviareLavoro({ status: 'failed', error: MOTIVO_DELLO_STATO })).toBe(false);
  });

  it('anche come «errore», e con l apostrofo tipografico', () => {
    expect(puoAvviareLavoro({ status: 'error', error: 'Chiedi all’assistenza prima di ripartire' })).toBe(false);
  });

  it('gli altri lavori chiusi lasciano ripartire, come prima', () => {
    expect(puoAvviareLavoro({ status: 'failed', error: null })).toBe(true);
    expect(puoAvviareLavoro({ status: 'failed' })).toBe(true);
    expect(
      puoAvviareLavoro({
        status: 'failed',
        error: "il lotto non e' finito entro 24 ore: chiuso. Se era partito, i risultati si recuperano con l'assistenza.",
      }),
    ).toBe(true);
    expect(puoAvviareLavoro({ status: 'canceled', error: null })).toBe(true);
    expect(puoAvviareLavoro({ status: 'applied' })).toBe(true);
    expect(puoAvviareLavoro(null)).toBe(true);
  });

  it('un lavoro aperto non ha il pulsante, come prima', () => {
    expect(puoAvviareLavoro({ status: 'submitting' })).toBe(false);
    expect(puoAvviareLavoro({ status: 'processing' })).toBe(false);
    expect(puoAvviareLavoro({ status: 'ready' })).toBe(false);
  });

  it('il pulsante c e solo quando la riga dice «Puoi avviarne un altro»: una regola sola', () => {
    const lavori = [
      { status: 'failed', total: 3, error: MOTIVO_DELLO_STATO },
      { status: 'error', total: 3, error: 'chiedi all’assistenza' },
      { status: 'failed', total: 3, error: 'invio non confermato' },
      { status: 'failed', total: 3, error: null },
      { status: 'canceled', total: 3, error: null },
    ];
    for (const lavoro of lavori) {
      const riga = testoStatoLavoro(lavoro) ?? '';
      expect(puoAvviareLavoro(lavoro), `${lavoro.status} · ${lavoro.error ?? 'senza motivo'}`).toBe(/Puoi avviarne un altro/.test(riga));
    }
  });
});
