import { describe, it, expect, vi, afterEach } from 'vitest';

// Per la copia nella casella: la rotta dei Contatti VERA, con il database e la posta finti.
const posta = vi.hoisted(() => ({ mandate: [] as Array<{ to: string; html: string }> }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
  getCurrentUser: async () => null,
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string; html: string }) => {
    posta.mandate.push(m);
    return { ok: true };
  },
}));

import { eseguiPotature, type ClientePotature } from '@/lib/privacy/potature-ritenzione';
import { DOVE_CHIEDIAMO_L_IBAN, QUANTO_TENIAMO_L_IBAN, durataDetta } from '@/lib/privacy/iban-per-email';
import { POST as scriviAiContatti } from '@/app/api/contact/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

/**
 * Riesame del 16/10, terzo giro — LA TABELLA DICEVA CHE L'IBAN SI CANCELLA COL BONIFICO, ANCHE QUELLO
 * MANDATO DAI CONTATTI.
 *
 * Ogni reclamo su un ordine in contanti chiuso a favore del cliente passava dai Contatti: l'email del
 * rimborso chiedeva l'IBAN, il cliente lo mandava con un messaggio, e il messaggio restava fra i
 * messaggi dell'assistenza fino alla potatura notturna, cioe' due anni. La tabella delle
 * conservazioni (l'articolo 13.2.a del GDPR vuole il tempo proprio li') non lo diceva.
 *
 * 17/10/2026 — Dalla semplificazione l'IBAN arriva rispondendo all'email del rimborso, e le parole
 * dicono di non scriverlo nei Contatti. Ma chi lo scrive li' lo stesso lascia un messaggio che resta
 * due anni: la frase deve continuare a dirlo, con il numero vero della potatura.
 *
 * La prova non cerca una parola nel file: esegue la potatura VERA dei messaggi dei Contatti, misura
 * la finestra che applica davvero, e pretende che la riga dell'IBAN la dica. Se domani la potatura
 * cambia finestra e la frase no, diventa rossa.
 *
 * Collaudo del 17/10, primo giro — LA COPIA NELLA CASELLA. La rotta dei Contatti manda il messaggio
 * intero, IBAN compreso, anche per email alla casella del supporto, e la potatura dei due anni non
 * la tocca. Le frasi l'avevano persa: promettevano «al massimo 2 anni» per un IBAN che nella casella
 * resta senza limite. La prova manda un messaggio vero dalla rotta, guarda dove arriva, e pretende
 * che le due frasi dicano della copia e che non le diano un tempo che nessun codice applica.
 *
 * ⚪ Quanto tiene la casella email dell'assistenza non lo dice nessun codice: lo decide Nicola col legale.
 */

const registro = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** La finestra, in mesi, che la potatura notturna applica davvero ai messaggi dei Contatti. */
async function mesiCheTieneLaPotatura(): Promise<number> {
  const adesso = Date.parse('2026-10-16T04:00:00Z');
  let soglia: string | null = null;
  const admin = {
    from: (tabella: string) => {
      const q: Record<string, unknown> = { then: (r: (v: { error: null }) => unknown) => Promise.resolve(r({ error: null })) };
      for (const f of ['eq', 'is', 'not', 'or']) q[f] = () => q;
      q.lt = (_c: string, v: string) => { if (tabella === 'contact_messages') soglia = v; return q; };
      return { update: () => q, delete: () => q };
    },
    rpc: async () => ({ data: [], error: null }),
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  } as unknown as ClientePotature;
  await eseguiPotature(admin, registro, adesso);
  expect(soglia, 'la potatura dei messaggi dei Contatti non e partita: la prova non misura niente').not.toBeNull();
  return Math.round((adesso - Date.parse(soglia!)) / (30 * 86_400_000));
}

describe('la riga dell IBAN dice quanto resta la copia mandata dai Contatti', () => {
  it('IL CASO CHE ROMPEVA — la tabella dice il tempo che la potatura applica ai messaggi', async () => {
    const mesi = await mesiCheTieneLaPotatura();
    expect(mesi).toBe(24);
    const frase = QUANTO_TENIAMO_L_IBAN.slice(QUANTO_TENIAMO_L_IBAN.indexOf('pagina Contatti'));
    expect(frase, 'la tabella non dice niente dell IBAN mandato dai Contatti').not.toBe(QUANTO_TENIAMO_L_IBAN.slice(-1));
    expect(frase, 'la tabella promette la cancellazione col bonifico anche per la copia nei messaggi').toContain(
      `al massimo ${durataDetta(mesi)}`,
    );
  });

  it('e la voce dei dati raccolti dice lo stesso tempo', async () => {
    expect(DOVE_CHIEDIAMO_L_IBAN).toContain(`al massimo ${durataDetta(await mesiCheTieneLaPotatura())}`);
  });

  it('i mesi detti come li direbbe una persona', () => {
    expect(durataDetta(24)).toBe('2 anni');
    expect(durataDetta(12)).toBe('1 anno');
    expect(durataDetta(18)).toBe('18 mesi');
  });
});

describe('la copia del messaggio che arriva per email nella casella dell assistenza', () => {
  const IBAN = 'IT60X0542811101000000123456';
  const prima = process.env.SUPPORT_EMAIL;
  afterEach(() => {
    if (prima === undefined) delete process.env.SUPPORT_EMAIL;
    else process.env.SUPPORT_EMAIL = prima;
    posta.mandate = [];
  });

  it('IL CASO CHE ROMPEVA — la copia con l IBAN parte davvero, e le due frasi la dicono senza darle un tempo', async () => {
    __resetRateLimitBuckets();
    process.env.SUPPORT_EMAIL = 'assistenza@example.it';
    const risposta = await scriviAiContatti(
      new Request('http://localhost/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '7.7.7.7' },
        body: JSON.stringify({
          name: 'Giulia Bianchi',
          email: 'giulia.bianchi@example.it',
          subject: 'Rimborso',
          message: `Ecco il mio IBAN per il rimborso: ${IBAN}`,
        }),
      }),
    );
    expect(risposta.status).toBe(200);
    await new Promise((fatto) => setTimeout(fatto, 0));

    // Il comportamento: il messaggio intero, IBAN compreso, va per email alla casella del supporto.
    const copie = posta.mandate.filter((m) => m.to === 'assistenza@example.it' && m.html.includes(IBAN));
    expect(copie, 'la rotta non manda piu la copia nella casella: allora la frase sulla copia va tolta').toHaveLength(1);

    // Le parole: la parte sui Contatti di ognuna delle due frasi dice della copia nella casella, e per
    // quella copia non promette nessun tempo (nessuna potatura la tocca).
    for (const [nome, frase] of [['dati raccolti', DOVE_CHIEDIAMO_L_IBAN], ['conservazione', QUANTO_TENIAMO_L_IBAN]] as const) {
      const contatti = frase.slice(frase.search(/Contatti/));
      const copia = contatti.slice(contatti.search(/copia/));
      expect(contatti, `${nome}: la frase sui Contatti non dice che una copia arriva nella casella dell assistenza`).toMatch(
        /copia arriva anche per email nella casella dell'assistenza/,
      );
      expect(copia, `${nome}: alla copia nella casella si promette un tempo che nessun codice applica`).not.toMatch(
        /al massimo|\d+ (anni|anno|mesi)/,
      );
      expect(copia).toMatch(/finché non la cancelliamo/);
    }
  });
});
