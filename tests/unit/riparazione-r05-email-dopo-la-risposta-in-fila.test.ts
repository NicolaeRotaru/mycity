/**
 * R05-003 — LE EMAIL DOPO LA RISPOSTA PARTONO IN FILA, NON TUTTE INSIEME.
 *
 * Dopo la risposta Next fa partire insieme tutti i lavori registrati con `after()` (la sua coda non ha
 * tetto). Nel giro degli ordini scaduti vuol dire decine di email nello stesso istante: il limite
 * d'invio della posta ne respinge alcune, e il ritentativo unico riparte per tutte insieme.
 * Qui la posta finta accetta un invio alla volta, come un limite d'invio stretto: un'email che arriva
 * mentre un'altra è in volo cade. Nessuna rete vera.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const stato = vi.hoisted(() => ({
  registrati: [] as Array<() => unknown>,
  fuoriDaUnaRichiesta: false,
}));

vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    if (stato.fuoriDaUnaRichiesta) throw new Error('`after` was called outside a request scope');
    stato.registrati.push(fn);
  },
}));
const avvisi = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: avvisi }));

import { dopoLaRisposta } from '@/lib/api/dopo-la-risposta';

/** Come Next quando la risposta è partita: tutti i lavori registrati, avviati nello stesso istante. */
function rispostaPartita(): Promise<unknown[]> {
  return Promise.all(stato.registrati.splice(0).map((fn) => fn()));
}

const attesa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Una posta con un limite d'invio stretto: un invio alla volta, chi arriva mentre un altro è in volo cade. */
function postaConUnLimite() {
  let inVolo = 0;
  const arrivate: string[] = [];
  const cadute: string[] = [];
  const invia = async (a: string) => {
    if (inVolo > 0) {
      cadute.push(a);
      return;
    }
    inVolo++;
    await attesa(15);
    arrivate.push(a);
    inVolo--;
  };
  return { invia, arrivate, cadute };
}

afterEach(() => {
  stato.registrati.length = 0;
  stato.fuoriDaUnaRichiesta = false;
  vi.useRealTimers();
});

describe('R05-003 — le email dopo la risposta partono in fila', () => {
  it('IL CASO CHE ROMPEVA — sei email del giro degli scaduti: col limite d\'invio arrivano tutte, nessuna cade', async () => {
    const posta = postaConUnLimite();
    const destinatari = ['negozio-1', 'cliente-1', 'negozio-2', 'cliente-2', 'negozio-3', 'cliente-3'];
    for (const d of destinatari) dopoLaRisposta(() => posta.invia(d), `email a ${d}`);

    await rispostaPartita();

    expect(posta.cadute, 'nessuna email deve cadere sul limite d\'invio').toEqual([]);
    expect(posta.arrivate, 'arrivano tutte, nell\'ordine in cui sono state registrate').toEqual(destinatari);
  });

  it('un lavoro alla volta: il secondo parte solo quando il primo ha finito', async () => {
    const diario: string[] = [];
    const lavoro = (nome: string) => async () => {
      diario.push(`inizia ${nome}`);
      await attesa(5);
      diario.push(`finisce ${nome}`);
    };
    dopoLaRisposta(lavoro('a'), 'a');
    dopoLaRisposta(lavoro('b'), 'b');
    dopoLaRisposta(lavoro('c'), 'c');

    await rispostaPartita();

    expect(diario).toEqual(['inizia a', 'finisce a', 'inizia b', 'finisce b', 'inizia c', 'finisce c']);
  });

  it('un lavoro che cade non ferma la fila, e resta nel registro', async () => {
    const fatti: string[] = [];
    dopoLaRisposta(async () => { throw new Error('Resend 503'); }, 'email al negozio');
    dopoLaRisposta(async () => { fatti.push('cliente'); }, 'email al cliente');

    await rispostaPartita();

    expect(fatti).toEqual(['cliente']);
    expect(avvisi.warn).toHaveBeenCalledWith('[dopo-la-risposta] email al negozio non completato', { message: 'Resend 503' });
  });

  it('un lavoro appeso non ferma la fila per sempre: dopo il tetto del turno parte il successivo', async () => {
    vi.useFakeTimers();
    const fatti: string[] = [];
    dopoLaRisposta(() => new Promise<void>(() => { /* non finisce mai */ }), 'lavoro appeso');
    dopoLaRisposta(async () => { fatti.push('dopo'); }, 'lavoro dopo');

    void rispostaPartita();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fatti).toEqual(['dopo']);
  });

  it('una raffica di lavori lenti parte uno alla volta anche dopo i 10 s del tetto', async () => {
    // Giro di correzione: il tetto contato dall'ingresso in fila scadeva per tutti insieme a 10 s, e
    // i lavori rimasti partivano nello stesso istante (10 lavori da 3 s: 7 in volo insieme).
    vi.useFakeTimers();
    let inVolo = 0;
    let massimo = 0;
    const finiti: number[] = [];
    for (let i = 0; i < 10; i++) {
      dopoLaRisposta(async () => {
        inVolo++;
        massimo = Math.max(massimo, inVolo);
        await new Promise((r) => setTimeout(r, 3_000));
        inVolo--;
        finiti.push(i);
      }, `lavoro ${i}`);
    }

    void rispostaPartita();
    await vi.advanceTimersByTimeAsync(31_000);

    expect(massimo, 'più lavori in volo nello stesso momento').toBe(1);
    expect(finiti).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('il tetto conta da quando il lavoro parte, non da quando entra in fila', async () => {
    vi.useFakeTimers();
    const diario: string[] = [];
    dopoLaRisposta(async () => {
      await new Promise((r) => setTimeout(r, 8_000));
      diario.push('primo finito');
    }, 'primo');
    dopoLaRisposta(() => {
      diario.push('appeso parte');
      return new Promise<void>(() => { /* non finisce mai */ });
    }, 'appeso');
    dopoLaRisposta(async () => { diario.push('terzo parte'); }, 'terzo');

    void rispostaPartita();
    await vi.advanceTimersByTimeAsync(17_000);
    expect(diario, 'l appeso è partito a 8 s: a 17 s il suo tetto non è ancora scaduto').toEqual(['primo finito', 'appeso parte']);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(diario, 'a 18 s, 10 s dopo l inizio dell appeso, parte il terzo').toEqual(['primo finito', 'appeso parte', 'terzo parte']);
  });

  it('fuori da una richiesta il lavoro parte lo stesso, subito', async () => {
    stato.fuoriDaUnaRichiesta = true;
    const fatti: string[] = [];
    dopoLaRisposta(async () => { fatti.push('fatto'); }, 'script');
    await attesa(0);
    expect(fatti).toEqual(['fatto']);
  });
});
