/**
 * R01-002 — LE EMAIL DELLA NOTTE HANNO UN TEMPO LORO, E I LORO ALLARMI NON ASPETTANO LA FINE.
 *
 * Il giro della notte ha al massimo 300 secondi, contati dall'inizio. Il ciclo delle cancellazioni
 * non prende account nuovi dopo 150 secondi, ma un account preso può durare a lungo: con due
 * account lenti (140 secondi l'uno) il ciclo finisce a 280 secondi e le email alle persone in attesa
 * partivano lo stesso, a ridosso del limite, senza che nessuno lo sapesse. E l'allarme di un'email
 * ferma si scriveva solo dopo TUTTE le email: se la piattaforma fermava la funzione, si perdeva.
 *
 * Adesso: dopo il tetto delle email non se ne tenta una nuova, quelle rimaste si contano, c'è un
 * allarme (uno per stato, non uno a notte) e la notte è rossa; l'allarme di un'email ferma si
 * scrive subito, prima dell'email dopo. E l'allarme del tetto delle cancellazioni non si riscrive
 * ogni notte se gli account rimandati sono gli stessi.
 *
 * L'orologio è finto: ogni cancellazione «dura» quanto dice `mondo.durata`, ogni email `mondo.posta`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno, type Guasto } from './aiuti/finto-giro-notturno';
import { chiaveAvviso } from '@/lib/cron-cancellazioni';
import { identificativoAvviso } from '@/lib/privacy/avvisi-a-chi-aspetta';

const mondo = vi.hoisted(() => ({
  admin: null as unknown,
  durata: 140_000,
  posta: 10_000,
  rinvio: true,
  emailAlle: [] as number[],
  allarmiEmailFermaAlloInvio: [] as number[],
  notifiche: null as null | (() => Array<Record<string, unknown>>),
}));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async () => {
    mondo.emailAlle.push(Date.now());
    mondo.allarmiEmailFermaAlloInvio.push(
      (mondo.notifiche?.() ?? []).filter((n) => /non partita per email/.test(String(n.title))).length,
    );
    vi.setSystemTime(Date.now() + mondo.posta);
    return { ok: true };
  }),
}));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: vi.fn(async () => {
    vi.setSystemTime(Date.now() + mondo.durata);
    return mondo.rinvio
      ? { ok: false, motivo: 'cassa_da_versare', errore: 'contanti da versare', fileRimossi: 0, erroriFile: [] }
      : { ok: true, fileRimossi: 0, erroriFile: [] };
  }),
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const ADESSO = new Date('2026-11-21T04:00:00+01:00').getTime();
const GIORNO = 86_400_000;
const CHIESTA_IL = new Date(ADESSO - 8 * GIORNO).toISOString();
const utente = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scadute = (n: number) => Array.from({ length: n }, (_, i) => ({ user_id: utente(i + 1), deleted_at: CHIESTA_IL }));

/** Un'email che parte dopo questo punto, con la posta lenta (due volte dieci secondi), sfora i 300 secondi. */
const ULTIMO_INVIO_SICURO_MS = 300_000 - 2 * 20_000;

function laNotte(quante: number, guasti: Guasto[] = []) {
  const elenco = scadute(quante);
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [{ id: 'admin-1', role: 'admin' }],
      notifications: [],
      audit_logs: [],
      cron_heartbeats: [],
      cod_reconciliations: [],
    },
    rpc: { process_expired_deletions: { data: elenco, error: null } },
    indirizzi: Object.fromEntries(elenco.map((r) => [r.user_id, `${r.user_id.slice(-2)}@example.it`])),
    guasti,
  });
  mondo.admin = giro.admin;
  mondo.notifiche = giro.notifiche;
  return giro;
}

const unGiro = async () => {
  const r = await POST(
    new Request('http://localhost/api/cron/process-deletions?a_mano=1&cancella=1', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
};

const allarmiSenzaTempo = (giro: ReturnType<typeof laNotte>) =>
  giro.notifiche().filter((n) => /email/i.test(String(n.title)) && /tempo/.test(String(n.title)));
const allarmiDelTetto = (giro: ReturnType<typeof laNotte>) =>
  giro.notifiche().filter((n) => /Cancellazioni rimandate/.test(String(n.title)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  mondo.durata = 140_000;
  mondo.posta = 10_000;
  mondo.rinvio = true;
  mondo.emailAlle = [];
  mondo.allarmiEmailFermaAlloInvio = [];
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R01-002 · le email della notte hanno un tempo loro', () => {
  it('due account lenti ma non tagliati: nessuna email a ridosso dei 300 s, allarme e notte rossa', async () => {
    const giro = laNotte(2);
    const { status, corpo } = await unGiro();

    // Il ciclo non ha tagliato nessuno: i due account sono stati presi entrambi (a 0 e a 140 s).
    expect(corpo.rimandateAlGiroDopo).toBe(0);
    for (const t of mondo.emailAlle) {
      expect(t - ADESSO, 'un’email tentata a ridosso dei 300 s: se la funzione viene fermata, si perde tutto').toBeLessThan(
        ULTIMO_INVIO_SICURO_MS,
      );
    }
    expect(corpo.avvisiEmailSenzaTempo, 'le spiegazioni rimaste senza tempo non sono contate').toBe(2);
    const allarmi = allarmiSenzaTempo(giro);
    expect(allarmi, 'nessuno sa che stanotte delle spiegazioni non sono partite per email').toHaveLength(1);
    expect(String(allarmi[0].body)).toMatch(/2 spiegazioni/);
    expect(status, 'spiegazioni non partite per il tempo: la notte deve finire rossa').toBe(500);
    // La spiegazione nel pannello della persona c'è lo stesso: manca solo l'email, che si riprova.
    const nelPannello = giro.righe('notifications').filter((n) => n.user_id !== 'admin-1');
    expect(nelPannello.map((n) => n.user_id).sort()).toEqual([utente(1), utente(2)]);
  });

  it('la notte dopo, con le stesse spiegazioni senza tempo, l’allarme non si riscrive', async () => {
    const giro = laNotte(2);
    await unGiro();
    vi.setSystemTime(ADESSO + GIORNO);
    const { corpo } = await unGiro();
    expect(allarmiSenzaTempo(giro), 'un allarme per stato, non per notte').toHaveLength(1);
    expect(corpo.avvisiEmailSenzaTempo).toBe(2);
  });

  it('controprova: un ciclo veloce manda le email e non suona l’allarme del tempo', async () => {
    mondo.durata = 1_000;
    const giro = laNotte(2);
    const { status, corpo } = await unGiro();
    expect(mondo.emailAlle).toHaveLength(2);
    expect(corpo.avvisiEmailSenzaTempo ?? 0).toBe(0);
    expect(allarmiSenzaTempo(giro)).toHaveLength(0);
    expect(status).toBe(200);
  });

  it('l’allarme di un’email ferma si scrive subito, prima di tentare l’email dopo', async () => {
    mondo.durata = 1_000;
    const idPrimo = identificativoAvviso(chiaveAvviso(utente(1), CHIESTA_IL, 'rinviata'));
    laNotte(2, [{ tabella: 'audit_logs', azione: 'select', messaggio: 'registro giù', seFiltro: ['target_id', idPrimo] }]);
    const { corpo } = await unGiro();
    expect(corpo.avvisiEmailBloccate).toBe(1);
    expect(mondo.emailAlle, 'l’email della seconda persona doveva partire').toHaveLength(1);
    expect(
      mondo.allarmiEmailFermaAlloInvio[0],
      'l’allarme dell’email ferma aspettava la fine di tutte le email: se la funzione viene fermata, si perde',
    ).toBe(1);
  });
});

describe('R01-002 · l’allarme del tetto delle cancellazioni è uno per stato', () => {
  it('stessi account rimandati la notte dopo: nessun avviso nuovo; arretrato diverso: avviso nuovo', async () => {
    mondo.durata = 60_000;
    mondo.rinvio = false;
    const giro = laNotte(6);
    const prima = await unGiro();
    expect(prima.corpo.rimandateAlGiroDopo).toBe(3);
    expect(allarmiDelTetto(giro)).toHaveLength(1);

    vi.setSystemTime(ADESSO + GIORNO);
    await unGiro();
    expect(allarmiDelTetto(giro), 'stesso arretrato: l’avviso del tetto si riscrive ogni notte').toHaveLength(1);

    // Arriva una richiesta in più: gli account rimandati non sono più gli stessi, e l'avviso si rifà.
    vi.setSystemTime(ADESSO + 2 * GIORNO);
    (giro.admin as { rpc: unknown }).rpc = async () => ({ data: scadute(7), error: null });
    await unGiro();
    expect(allarmiDelTetto(giro)).toHaveLength(2);
  });
});
