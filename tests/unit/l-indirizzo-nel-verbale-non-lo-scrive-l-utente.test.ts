import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * L'INDIRIZZO DI RETE NEL VERBALE NON LO SCRIVE L'UTENTE.
 *
 * 27/8/2026 (R024 · R062) — Nei punti in cui si mette a verbale l'accettazione
 * di Termini e Informativa, l'indirizzo era letto così:
 * `req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()`.
 *
 * `x-forwarded-for` è una CATENA, e ogni proxy accoda il suo pezzo a destra: il
 * pezzo più a SINISTRA è quello che ha scritto il chiamante, cioè un valore che
 * chiunque può inventarsi mandando l'intestazione a mano. E dietro un CDN quel
 * primo pezzo non è nemmeno la persona: è un nodo del CDN.
 *
 * Quel campo è la prova che serve il giorno in cui un venditore contesta una
 * condizione contrattuale, o il Garante chiede conto di un consenso. Una prova
 * dettata dalla controparte non prova niente — ed è peggio di una prova
 * assente, perché nessuno la va a controllare.
 *
 * La lettura giusta esisteva già nello stesso progetto (`getClientIp`, usata da
 * /api/consent): preferisce `cf-connecting-ip` e altrimenti legge da DESTRA
 * scartando i proxy fidati, cioè il pezzo scritto dalla nostra infrastruttura.
 */

const UTENTE = { id: 'u-1' };

const stato: { consensi: Record<string, unknown>[]; profiloAggiornato: boolean; erroreInsert: { message: string } | null } = {
  consensi: [],
  profiloAggiornato: false,
  erroreInsert: null,
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/legal/versione', () => ({ VERSIONE_TESTI_LEGALI: '2026-08-01' }));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: UTENTE } }) } }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'consent_log') {
        return {
          insert: async (riga: Record<string, unknown>) => {
            stato.consensi.push(riga);
            return { error: stato.erroreInsert };
          },
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tos_accepted_at: null } }) }) }),
        update: () => ({ eq: async () => { stato.profiloAggiornato = true; return { error: null }; } }),
      };
    },
  }),
}));

import { POST } from '@/app/api/account/accetta-condizioni/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

/** La catena vista dal server: a sinistra quello che ha scritto il chiamante,
 *  a destra quello che ha aggiunto la nostra infrastruttura. */
function accetta(headers: Record<string, string>) {
  return POST(new Request('https://mycity.test/api/account/accetta-condizioni', {
    method: 'POST',
    headers,
  }) as never);
}

beforeEach(() => {
  stato.consensi = [];
  stato.profiloAggiornato = false;
  stato.erroreInsert = null;
  __resetRateLimitBuckets();
});

describe('l indirizzo messo a verbale quando si accettano le condizioni', () => {
  it('IL CASO CHE ROMPEVA — l indirizzo inventato dal chiamante non finisce nel verbale', async () => {
    // Chi si registra manda a mano `x-forwarded-for: 1.2.3.4`; il nostro
    // ingresso ci accoda il suo indirizzo vero, 93.40.10.5.
    await accetta({ 'x-forwarded-for': '1.2.3.4, 93.40.10.5' });

    expect(stato.consensi).toHaveLength(1);
    expect(
      stato.consensi[0].ip,
      'nel verbale finisce l indirizzo che si e scelto l utente: la prova non prova niente',
    ).not.toBe('1.2.3.4');
    expect(stato.consensi[0].ip).toBe('93.40.10.5');
  });

  /**
   * 27/8/2026 (R018) — anche qui l'intenzione era giusta e la prova incompleta:
   * dietro Cloudflare vale l'intestazione del CDN, ma bisogna prima sapere che
   * a scriverla sia stato Cloudflare. Senza quel controllo, l'indirizzo nel
   * verbale se lo sceglieva di nuovo l'utente — cioe' il difetto che questo
   * stesso file esiste per impedire, rientrato da un'altra porta.
   */
  /**
   * 31/8/2026 (R018, ricaduta) — QUESTE DUE PROVE ERANO STATE ADDOLCITE.
   *
   * La catena in scena era stata accorciata: due salti nella prima, UNO nella
   * seconda. Con un salto solo non c'e' niente da scartare, quindi qualunque
   * conto azzecca la risposta — e la prova resta verde anche quando il conto e'
   * sbagliato. Il caso vero e' quello che descrive il README: il CDN davanti,
   * la catena a TRE salti. Rimesse li'.
   */
  it('dietro Cloudflare, col segreto di bordo, vale l intestazione che aggiunge il CDN', async () => {
    process.env.EDGE_TRUST_SECRET = 'segreto-di-bordo';
    await accetta({
      'x-forwarded-for': '1.2.3.4, 172.16.0.1, 10.0.0.5',
      'cf-connecting-ip': '93.40.10.5',
      'x-edge-token': 'segreto-di-bordo',
    });
    expect(stato.consensi[0].ip).toBe('93.40.10.5');
    delete process.env.EDGE_TRUST_SECRET;
  });

  it('senza segreto di bordo, cf-connecting-ip nel verbale non vale', async () => {
    delete process.env.EDGE_TRUST_SECRET;
    await accetta({
      'x-forwarded-for': '93.40.10.5, 172.16.0.1, 10.0.0.5',
      'cf-connecting-ip': '1.2.3.4',
    });
    expect(
      stato.consensi[0].ip,
      'l utente si e riscritto l indirizzo del verbale da un altra intestazione',
    ).toBe('93.40.10.5');
  });

  /**
   * Il verbale e' la prova che serve il giorno in cui un venditore contesta una
   * condizione. Se dietro il CDN tutti risultano lo stesso indirizzo, quella
   * prova non distingue nessuno: e' come non averla.
   */
  it('dietro il CDN due persone diverse non finiscono a verbale con lo stesso indirizzo', async () => {
    delete process.env.EDGE_TRUST_SECRET;
    await accetta({ 'x-forwarded-for': '93.40.10.5, 172.16.0.1, 10.0.0.5' });
    await accetta({ 'x-forwarded-for': '203.0.113.9, 172.16.0.1, 10.0.0.5' });
    expect(
      stato.consensi[0].ip,
      'due venditori diversi hanno a verbale lo stesso indirizzo: il verbale non prova piu chi ha accettato',
    ).not.toBe(stato.consensi[1].ip);
  });
});

describe('il registro e il profilo devono raccontare la stessa cosa', () => {
  it('IL CASO CHE ROMPEVA — se il consenso non entra, il profilo non si aggiorna', async () => {
    // supabase-js non lancia: restituisce `{ error }`. L'esito non veniva letto,
    // quindi il profilo risultava «ha accettato» con il registro vuoto — e la
    // divergenza si scopriva il giorno in cui serviva la prova.
    stato.erroreInsert = { message: 'permission denied for table consent_log' };

    const res = await accetta({ 'x-forwarded-for': '93.40.10.5' });

    expect(res.status, 'la chiamata dice «fatto» mentre il verbale è vuoto').toBe(500);
    expect(
      stato.profiloAggiornato,
      'il profilo dichiara accettate condizioni di cui non esiste nessuna traccia',
    ).toBe(false);
  });

  it('quando il consenso entra, il profilo si aggiorna', async () => {
    const res = await accetta({ 'x-forwarded-for': '93.40.10.5' });
    expect(res.status).toBe(200);
    expect(stato.profiloAggiornato).toBe(true);
  });
});

describe('il freno sulla rotta', () => {
  it('venti accettazioni al minuto bastano: la ventunesima si ferma', async () => {
    // Due letture e due scritture per chiamata, senza freno: una rotta
    // autenticata ma cara, e nessuno la fermava.
    let ultima: Response | null = null;
    for (let i = 0; i < 21; i++) ultima = await accetta({ 'x-forwarded-for': '93.40.10.5' });
    expect(ultima!.status).toBe(429);
  });
});
