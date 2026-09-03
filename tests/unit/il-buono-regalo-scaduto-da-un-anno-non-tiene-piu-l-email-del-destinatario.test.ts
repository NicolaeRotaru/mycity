/**
 * 3/9/2026 — CHI RICEVE UN BUONO REGALO NON È NOSTRO CLIENTE, E RESTAVA NEI
 * NOSTRI ARCHIVI PER SEMPRE.
 *
 * Quando compri un buono regalo per tua sorella, noi scriviamo il suo nome, la
 * sua email e il messaggio che le hai dedicato. Servono a recapitarle il
 * regalo: giusto averli. Ma lei non ha un account, non ha comprato niente e
 * spesso non sa nemmeno che esistiamo — e quei dati restavano lì anche dieci
 * anni dopo che il buono era stato speso o era scaduto.
 *
 * L'altra squadra ha chiuso metà del problema: adesso, se CHI HA COMPRATO il
 * buono (o chi lo ha riscattato) cancella il proprio account, i dati del
 * destinatario se ne vanno con lui. Ma quasi nessuno cancella l'account: nel
 * caso normale il buono resta lì per sempre.
 *
 * Qui si prova l'altra metà: il giro notturno pota i buoni FINITI — spesi o
 * scaduti da più di dodici mesi — e toglie nome, email e messaggio. Il credito e
 * il codice non si toccano mai: sono i soldi di qualcuno.
 *
 * IL FINTO DATABASE APPLICA I FILTRI DAVVERO. È il motivo per cui questa prova
 * vale qualcosa: se la potatura scegliesse le righe sbagliate — per esempio
 * ripulendo un buono ancora spendibile — una prova che si limita a guardare «è
 * stata chiamata la pulizia?» resterebbe verde lo stesso.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno, type Riga } from './aiuti/finto-giro-notturno';

const mondo: { attuale: ReturnType<typeof fintoGiroNotturno> } = {
  attuale: fintoGiroNotturno(),
};

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => mondo.attuale.admin,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();
const fraGiorni = (g: number) => new Date(Date.now() + g * 86_400_000).toISOString();

/** Un buono regalo con i dati di una persona che non è nostra cliente. */
function buono(codice: string, campi: Riga): Riga {
  return {
    code: codice,
    amount_cents: 5000,
    balance_cents: 5000,
    recipient_name: 'Anna Bianchi',
    recipient_email: 'anna@example.com',
    message: 'Buon compleanno, ci vediamo domenica',
    expires_at: fraGiorni(300),
    redeemed_at: null,
    ...campi,
  };
}

async function passaLaNotte(buoni: Riga[]) {
  mondo.attuale = fintoGiroNotturno({
    tabelle: { gift_cards: buoni },
    rpc: { process_expired_deletions: { data: [], error: null } },
  });
  const res = await POST(
    new Request('http://localhost/api/cron/process-deletions', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
  return { res, mondo: mondo.attuale };
}

const trova = (righe: Riga[], codice: string) => righe.find((r) => r.code === codice)!;

describe('la potatura notturna dei buoni regalo finiti', () => {
  const salvato = process.env.CRON_SECRET;
  beforeEach(() => { process.env.CRON_SECRET = 'segreto-dei-lavori'; });
  afterEach(() => { process.env.CRON_SECRET = salvato; });

  it('un buono scaduto da più di un anno perde nome, email e messaggio del destinatario', async () => {
    const { res, mondo } = await passaLaNotte([
      buono('VECCHIO', { expires_at: giorniFa(400) }),
    ]);
    expect(res.status).toBe(200);
    const riga = trova(mondo.righe('gift_cards'), 'VECCHIO');
    expect(
      riga.recipient_email,
      'il buono è finito da più di un anno e l email di una persona che non è nostra cliente è ancora qui',
    ).toBeNull();
    expect(riga.recipient_name).toBeNull();
    expect(
      riga.message,
      'il testo privato che una persona ha scritto a un altra resta nei nostri archivi',
    ).toBeNull();
  });

  it('il credito e il codice non si toccano: sono i soldi di qualcuno', async () => {
    const { mondo } = await passaLaNotte([buono('VECCHIO', { expires_at: giorniFa(400) })]);
    const riga = trova(mondo.righe('gift_cards'), 'VECCHIO');
    expect(riga.balance_cents, 'la pulizia ha azzerato anche il credito del buono').toBe(5000);
    expect(riga.code, 'senza il codice il buono non è più spendibile da nessuno').toBe('VECCHIO');
    // Nessuna delle due potature deve poter scrivere su altre colonne.
    const scritture = mondo.diario.filter((v) => v.op === 'update' && v.tabella === 'gift_cards');
    expect(scritture.length, 'le potature dei buoni regalo sono due: scaduti ed esauriti').toBe(2);
    for (const s of scritture) {
      expect(Object.keys((s as { valori: Riga }).valori).sort()).toEqual(
        ['message', 'recipient_email', 'recipient_name'],
      );
    }
  });

  it('un buono ancora valido non si tocca: quei dati servono a recapitare il regalo', async () => {
    const { mondo } = await passaLaNotte([
      buono('VIVO', { expires_at: fraGiorni(200) }),
      buono('RECENTE', { expires_at: giorniFa(30) }),
    ]);
    expect(
      trova(mondo.righe('gift_cards'), 'VIVO').recipient_email,
      'un buono ancora spendibile è stato ripulito: il destinatario non lo riceve più',
    ).toBe('anna@example.com');
    expect(
      trova(mondo.righe('gift_cards'), 'RECENTE').recipient_email,
      'scaduto da un mese non è «finito da un anno»: si cancella un dato ancora utile a un reclamo',
    ).toBe('anna@example.com');
  });

  it('un buono speso fino all ultimo centesimo si pota anche se la scadenza è lontana', async () => {
    const { mondo } = await passaLaNotte([
      buono('SPESO', { balance_cents: 0, redeemed_at: giorniFa(400), expires_at: fraGiorni(300) }),
      // Speso a metà: il credito è ancora suo, il regalo non è finito.
      buono('MEZZO', { balance_cents: 2500, redeemed_at: giorniFa(400), expires_at: fraGiorni(300) }),
    ]);
    expect(
      trova(mondo.righe('gift_cards'), 'SPESO').recipient_email,
      'il buono è stato speso più di un anno fa e teniamo ancora l email di chi l ha ricevuto',
    ).toBeNull();
    expect(
      trova(mondo.righe('gift_cards'), 'MEZZO').recipient_email,
      'ha ancora 25 euro da spendere e gli abbiamo tolto i dati per recapitarglielo',
    ).toBe('anna@example.com');
  });

  it('la notte dopo non riscrive le righe già pulite', async () => {
    // Un aggiornamento che ripassa ogni notte su milioni di righe già pulite è
    // lavoro inutile sul database, e su PostgREST diventa una scrittura vera.
    const gia = buono('GIA_PULITO', {
      expires_at: giorniFa(400),
      recipient_name: null,
      recipient_email: null,
      message: null,
    });
    const { mondo } = await passaLaNotte([gia]);
    const toccate = mondo.diario
      .filter((v) => v.op === 'update' && v.tabella === 'gift_cards')
      .reduce((n, v) => n + (v as { toccate: number }).toccate, 0);
    expect(toccate, 'la potatura riscrive ogni notte righe che sono già a posto').toBe(0);
  });

  it('se la potatura dei buoni viene rifiutata, la notte lo dice invece di passare per fatta', async () => {
    mondo.attuale = fintoGiroNotturno({
      tabelle: { gift_cards: [buono('VECCHIO', { expires_at: giorniFa(400) })] },
      rpc: { process_expired_deletions: { data: [], error: null } },
      errori: { gift_cards: 'permission denied for table gift_cards' },
    });
    const res = await POST(
      new Request('http://localhost/api/cron/process-deletions', {
        method: 'POST',
        headers: { authorization: 'Bearer segreto-dei-lavori' },
      }) as never,
    );
    const corpo = await res.json();
    expect(
      corpo.retentionFallite,
      'una pulizia rifiutata dai permessi passava per fatta: i dati restavano dov erano',
    ).toBeGreaterThanOrEqual(2);
  });
});
