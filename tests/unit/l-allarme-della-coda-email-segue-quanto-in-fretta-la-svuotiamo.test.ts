import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { NextRequest } from 'next/server';

/**
 * 31/8/2026 (R193) — TRE NUMERI CHE DECIDONO LA STESSA COSA E NON SI PARLAVANO.
 *
 * Quanti messaggi spedisce un giro (`p_max`, in app/api/cron/send-emails),
 * ogni quanto parte un giro (`vercel.json` → `crons`) e a quanti messaggi fermi
 * suona l'allarme (`EMAIL_BACKLOG`, in app/api/cron/operational-alerts) sono
 * scritti in tre posti diversi, ma insieme decidono una cosa sola: se quando
 * l'allarme suona c'e' davvero qualcosa da fare. Nessuno dei tre sapeva degli
 * altri, e chiunque poteva toccarne uno in buona fede — rendendo l'allarme
 * rumore da ignorare, o un avviso che arriva quando il ritardo e' di ore.
 *
 * Questa prova non cerca parole dentro i file. Fa girare le due rotte vere:
 * chiede a quella della coda quanti messaggi si prende davvero, e a quella
 * dell'allarme a quale numero comincia a suonare — cercandolo per tentativi,
 * come farebbe una persona. Poi ci mette accanto la cadenza scritta in
 * vercel.json e pretende che i tre numeri stiano insieme.
 *
 * La manovra da fare quando l'allarme suona: docs/runbook.md, §6-bis.
 */

/** Quello che le rotte vedono al posto del database, piu' cosa hanno chiesto. */
const stato = {
  /** Quanti messaggi risultano fermi da oltre la finestra dell'allarme. */
  messaggiFermi: 0,
  /** Da quanti minuti l'allarme li considera fermi: lo si legge da cosa chiede al database. */
  finestraDellAllarmeMin: null as number | null,
  /** Quanti messaggi il giro della coda si prende: lo si legge dalla chiamata vera. */
  presiDaUnGiro: null as number | null,
  /** Le righe che il giro della coda trova da spedire. */
  righeDaSpedire: [] as Array<{ id: string; user_id: string; template: string }>,
};

/**
 * Un finto costruttore di query: qualunque cosa gli si chieda risponde «niente
 * da segnalare», tranne il conteggio della coda email. Serve perche' il
 * sorvegliante fa quattordici controlli e uno solo ci interessa: gli altri
 * devono tacere, non fallire — se falliscono, la rotta risponde errore e non
 * arriva mai a dire se l'allarme suona.
 */
function fintaTabella(tabella: string): Record<string, unknown> {
  const catena: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
    get(_bersaglio, chiave) {
      if (chiave === 'then') {
        const risposta = tabella === 'email_queue'
          ? { data: [], error: null, count: stato.messaggiFermi }
          : { data: [], error: null };
        const promessa = Promise.resolve(risposta);
        return promessa.then.bind(promessa);
      }
      if (typeof chiave === 'symbol') return undefined;
      return (...argomenti: unknown[]) => {
        // «send_at piu' vecchio di X»: X e' la finestra dell'allarme, e questo
        // e' l'unico modo di sapere quale sia senza leggerla in un file.
        if (tabella === 'email_queue' && chiave === 'lte' && argomenti[0] === 'send_at') {
          const quando = new Date(String(argomenti[1])).getTime();
          stato.finestraDellAllarmeMin = Math.round((Date.now() - quando) / 60_000);
        }
        return catena;
      };
    },
  });
  return catena;
}

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (gestore: (req: unknown) => unknown) => (req: unknown) => gestore(req),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ from: (tabella: string) => fintaTabella(tabella) }),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async () => ({ ok: true, id: 'finta' })),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (nome: string, argomenti: Record<string, unknown>) => {
      if (nome === 'claim_pending_emails') stato.presiDaUnGiro = Number(argomenti.p_max);
      return Promise.resolve({ data: stato.righeDaSpedire, error: null });
    },
    from: (tabella: string) => fintaTabella(tabella),
    auth: { admin: { getUserById: async () => ({ data: null }) } },
  }),
}));

import { POST as sorvegliante } from '@/app/api/cron/operational-alerts/route';
import { GET as giroDellaCoda, EMAIL_PER_GIRO, sogliaAllarmeCoerente } from '@/app/api/cron/send-emails/route';
import { logger } from '@/lib/logger';

const bussata = (percorso: string) =>
  new Request(`https://mycity.test${percorso}`) as unknown as NextRequest;

/** Fa girare il sorvegliante con `quantiFermi` messaggi in ritardo e dice se l'allarme della coda suona. */
async function laAllarmeSuonaCon(quantiFermi: number): Promise<boolean> {
  stato.messaggiFermi = quantiFermi;
  const risposta = await sorvegliante(bussata('/api/cron/operational-alerts'));
  const corpo = (await risposta.json()) as { details?: Array<{ type: string }> };
  return (corpo.details ?? []).some((a) => a.type === 'EMAIL_BACKLOG');
}

/** Il numero piu' piccolo di messaggi fermi che fa suonare l'allarme, trovato per tentativi. */
async function cercaLaSogliaDellAllarme(): Promise<number> {
  const tetto = 400;
  if (!(await laAllarmeSuonaCon(tetto))) {
    throw new Error(`Nemmeno con ${tetto} messaggi fermi l'allarme della coda email suona.`);
  }
  let zitto = 0;
  let suona = tetto;
  while (suona - zitto > 1) {
    const mezzo = Math.floor((zitto + suona) / 2);
    if (await laAllarmeSuonaCon(mezzo)) suona = mezzo;
    else zitto = mezzo;
  }
  return suona;
}

/** Ogni quanti minuti parte davvero il giro, letto dal calendario dei lavori periodici. */
function minutiFraUnGiroELAltro(percorso: string): number {
  const configurazione = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'),
  ) as { crons?: Array<{ path: string; schedule: string }> };
  const voce = (configurazione.crons ?? []).find((c) => c.path === percorso);
  if (!voce) throw new Error(`In vercel.json non c'e' nessun lavoro periodico per ${percorso}.`);
  const ogniTotMinuti = /^\*\/(\d+) \* \* \* \*$/.exec(voce.schedule);
  if (!ogniTotMinuti) {
    throw new Error(`La cadenza di ${percorso} non e' piu' «ogni N minuti» ma «${voce.schedule}»: il conto qui sotto non vale piu'.`);
  }
  return Number(ogniTotMinuti[1]);
}

describe("l'allarme della coda email e la velocita' con cui la svuotiamo", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://finto.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'chiave-finta';
    process.env.SUPPORT_EMAIL = 'assistenza@mycity.test';
    stato.messaggiFermi = 0;
    stato.finestraDellAllarmeMin = null;
    stato.presiDaUnGiro = null;
    stato.righeDaSpedire = [];
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("suona quando la coda e' davvero piu' lunga di quanto riusciamo a smaltire", async () => {
    const soglia = await cercaLaSogliaDellAllarme();
    const finestra = stato.finestraDellAllarmeMin;

    await giroDellaCoda(bussata('/api/cron/send-emails'));
    const perGiro = stato.presiDaUnGiro;
    const cadenza = minutiFraUnGiroELAltro('/api/cron/send-emails');

    expect(finestra, "il sorvegliante non chiede piu' da quanto sono fermi i messaggi in coda").not.toBeNull();
    expect(perGiro, 'il giro della coda non dice piu quanti messaggi si prende').not.toBeNull();

    const esito = sogliaAllarmeCoerente({
      soglia,
      minutiDiRitardo: finestra as number,
      perGiro: perGiro as number,
      minutiFraUnGiroELAltro: cadenza,
    });
    expect(esito.coerente, esito.motivo).toBe(true);
  });

  it('quando il giro torna pieno lo scrive nel registro, invece di sembrare un giro qualsiasi', async () => {
    const avvisi = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const righe = (quante: number) =>
      Array.from({ length: quante }, (_, i) => ({
        id: `riga-${i}`,
        user_id: `persona-${i}`,
        // Un nome di messaggio che non esiste: la riga viene scartata e la
        // prova resta sul solo comportamento che le interessa, il giro pieno.
        template: 'questo_messaggio_non_esiste',
      }));

    stato.righeDaSpedire = righe(EMAIL_PER_GIRO - 1);
    await giroDellaCoda(bussata('/api/cron/send-emails'));
    expect(
      avvisi.mock.calls.some((c) => String(c[0]).includes('coda email piena')),
      "il giro ha spedito meno di quanto poteva — la coda era vuota dietro — e si e' lamentato lo stesso",
    ).toBe(false);

    stato.righeDaSpedire = righe(EMAIL_PER_GIRO);
    await giroDellaCoda(bussata('/api/cron/send-emails'));
    expect(
      avvisi.mock.calls.some((c) => String(c[0]).includes('coda email piena')),
      "il giro ha preso tutti i messaggi che poteva prendere, quindi altri sono rimasti in attesa, e nel registro non se ne vede traccia: chi guarda i log alle tre di notte legge lo stesso identico giro di una notte tranquilla",
    ).toBe(true);
  });
});
