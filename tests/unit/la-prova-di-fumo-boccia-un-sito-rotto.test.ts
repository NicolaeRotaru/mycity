import { describe, it, expect } from 'vitest';
import { provaDiFumo, esitoDellaProva, provaUnControllo, CONTROLLI } from '@/scripts/prova-di-fumo.mjs';

/**
 * IL COLLAUDO DEL COLLAUDO.
 *
 * Radiografia del 27/8/2026 (R178): dopo il rilascio in produzione non si
 * guardava niente. Adesso si guarda — ma una verifica che dice sempre «va
 * bene» e' peggio di nessuna verifica, perche' aggiunge fiducia senza
 * aggiungere controllo. Qui la verifica viene messa alle strette: se non
 * boccia un sito rotto, queste righe diventano rosse.
 *
 * Niente rete vera: la `fetch` la passiamo noi, cosi' il caso «il sito
 * risponde 500» si puo' costruire davvero invece di descriverlo.
 */

/** Una `fetch` finta che risponde come le diciamo, indirizzo per indirizzo. */
function fetchFinta(risposte: Record<string, { status: number; body?: unknown }>) {
  const chiamate: string[] = [];
  const impl = async (url: string) => {
    chiamate.push(url);
    const percorso = new URL(url).pathname;
    const r = risposte[percorso] ?? { status: 404 };
    const res = {
      status: r.status,
      clone: () => ({
        json: async () => {
          if (r.body === undefined) throw new Error('non e JSON');
          return r.body;
        },
      }),
    };
    return res as unknown as Response;
  };
  return { impl, chiamate };
}

const SANO = {
  '/api/health': { status: 200, body: { status: 'ok' } },
  '/api/health/ready': { status: 200, body: { status: 'ok' } },
  '/': { status: 200 },
};

// Senza attese vere: la prova non deve durare mezzo minuto per i tentativi.
const SUBITO = { tentativi: 2, attesaMs: 0, dormi: async () => {} };

describe('la prova di fumo dopo il rilascio', () => {
  it('promuove un sito sano', async () => {
    const { impl } = fetchFinta(SANO);
    const esito = await provaDiFumo('https://mycity.test', { ...SUBITO, fetchImpl: impl });
    expect(esito.passata, esito.riassunto).toBe(true);
  });

  it('boccia il sito che risponde 500 sulla home', async () => {
    const { impl } = fetchFinta({ ...SANO, '/': { status: 500 } });
    const esito = await provaDiFumo('https://mycity.test', { ...SUBITO, fetchImpl: impl });
    expect(esito.passata).toBe(false);
    expect(esito.riassunto).toContain('la home si disegna');
  });

  /**
   * Il caso subdolo: il processo risponde 200 ma si sta dichiarando morto nel
   * corpo. Guardare solo il codice di risposta lo lascerebbe passare.
   */
  it('boccia il processo che risponde 200 ma si dichiara unhealthy', async () => {
    const { impl } = fetchFinta({ ...SANO, '/api/health': { status: 200, body: { status: 'unhealthy' } } });
    const esito = await provaDiFumo('https://mycity.test', { ...SUBITO, fetchImpl: impl });
    expect(esito.passata).toBe(false);
    expect(esito.riassunto).toContain('il processo e vivo');
  });

  /**
   * `degraded` NON deve far tornare indietro un rilascio: vuol dire in piedi
   * con qualcosa da guardare — un database lento, una variabile secondaria che
   * manca. Tornare indietro per questo vorrebbe dire non pubblicare mai piu'.
   */
  it('lascia passare un rilascio degradato: non e un buon motivo per tornare indietro', async () => {
    const { impl } = fetchFinta({ ...SANO, '/api/health': { status: 200, body: { status: 'degraded' } } });
    const esito = await provaDiFumo('https://mycity.test', { ...SUBITO, fetchImpl: impl });
    expect(esito.passata, esito.riassunto).toBe(true);
  });

  it('boccia il sito che non risponde affatto', async () => {
    const impl = async () => {
      throw new Error('connessione rifiutata');
    };
    const esito = await provaDiFumo('https://mycity.test', { ...SUBITO, fetchImpl: impl });
    expect(esito.passata).toBe(false);
    expect(esito.falliti).toHaveLength(CONTROLLI.length);
  });

  it('riprova prima di dare la colpa: la funzione fredda al primo colpo non e un guasto', async () => {
    let n = 0;
    const impl = async () => {
      n++;
      // Il primo tentativo cade, il secondo va: e' la partenza a freddo.
      if (n === 1) throw new Error('connessione rifiutata');
      return { status: 200, clone: () => ({ json: async () => ({ status: 'ok' }) }) } as unknown as Response;
    };
    const esito = await provaUnControllo('https://mycity.test', CONTROLLI[0], { ...SUBITO, fetchImpl: impl });
    expect(esito.ok, esito.dettaglio).toBe(true);
    expect(n).toBe(2);
  });

  it('la sentenza elenca ogni controllo caduto', () => {
    const esito = esitoDellaProva([
      { nome: 'uno', ok: true, dettaglio: 'HTTP 200' },
      { nome: 'due', ok: false, dettaglio: 'HTTP 503' },
    ]);
    expect(esito.passata).toBe(false);
    expect(esito.riassunto).toContain('due');
    expect(esito.riassunto).toContain('HTTP 503');
  });
});
