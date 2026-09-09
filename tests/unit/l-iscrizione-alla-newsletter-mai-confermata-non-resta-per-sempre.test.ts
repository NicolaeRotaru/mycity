/**
 * 6/9/2026 — CHI NON HA MAI DETTO DI SÌ RESTAVA NEI NOSTRI ARCHIVI PER SEMPRE.
 *
 * Il modulo della newsletter è pubblico: chiunque può scriverci l'indirizzo di
 * un altro, e a quell'altro parte l'email «confermi l'iscrizione?». Il doppio
 * consenso funziona — finché non clicca, non riceve niente. Ma la riga restava:
 * la sua email, l'indirizzo di rete di chi l'ha scritta e il gettone di
 * conferma, in piedi a tempo indeterminato. L'unica cancellazione di quella
 * tabella era per l'email di chi cancella il proprio account, cioè quasi mai.
 *
 * Qui si prova che il giro notturno pota i tentativi vecchi di più di trenta
 * giorni, E CHE NON PORTA VIA NIENT'ALTRO. La seconda metà è quella che conta:
 * le iscrizioni più vecchie della migrazione 115 hanno `confirmed_at` vuoto
 * perché quella colonna non esisteva ancora, e sono iscritti veri. Una potatura
 * scritta con un filtro solo avrebbe cancellato metà della lista, in silenzio,
 * la prima notte.
 *
 * IL FINTO DATABASE APPLICA I FILTRI DAVVERO: è il motivo per cui questa prova
 * vale qualcosa. Una prova che guarda «è stata chiamata la pulizia?» resterebbe
 * verde anche se la pulizia scegliesse le righe sbagliate.
 *
 * Nella seconda parte si prova l'altra metà del difetto, sullo stesso giro: una
 * pulizia rifiutata dal database adesso sveglia un amministratore e rende rossa
 * la notte, invece di finire in un numero dentro una risposta che non legge
 * nessuno.
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

/** Un'iscrizione in attesa di conferma, come la scrive il modulo pubblico. */
function iscrizione(email: string, campi: Riga = {}): Riga {
  return {
    id: email,
    email,
    active: false,
    confirmed_at: null,
    unsubscribed_at: null,
    confirm_token: 'gettone-' + email,
    consent_ip: '203.0.113.7',
    consent_source: 'form-web',
    created_at: giorniFa(40),
    ...campi,
  };
}

async function passaLaNotte(scenario: Parameters<typeof fintoGiroNotturno>[0] = {}) {
  mondo.attuale = fintoGiroNotturno({
    rpc: { process_expired_deletions: { data: [], error: null } },
    ...scenario,
  });
  const res = await POST(
    new Request('http://localhost/api/cron/process-deletions', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
  return { res, corpo: await res.json(), mondo: mondo.attuale };
}

const emailRimaste = (m: ReturnType<typeof fintoGiroNotturno>) =>
  m.righe('newsletter_subscribers').map((r) => r.email);

describe('la potatura notturna delle iscrizioni mai confermate', () => {
  const salvato = process.env.CRON_SECRET;
  beforeEach(() => { process.env.CRON_SECRET = 'segreto-dei-lavori'; });
  afterEach(() => { process.env.CRON_SECRET = salvato; });

  it('IL CASO CHE ROMPEVA — un tentativo di quaranta giorni fa sparisce', async () => {
    const { mondo } = await passaLaNotte({
      tabelle: { newsletter_subscribers: [iscrizione('estraneo@example.com')] },
    });
    expect(
      emailRimaste(mondo),
      'nessuno ha mai confermato e teniamo ancora email, indirizzo di rete e gettone: a tempo indeterminato',
    ).toEqual([]);
  });

  it('un tentativo di ieri resta: la persona può ancora cliccare', async () => {
    const { mondo } = await passaLaNotte({
      tabelle: {
        newsletter_subscribers: [iscrizione('appena@example.com', { created_at: giorniFa(1) })],
      },
    });
    expect(
      emailRimaste(mondo),
      'la conferma è partita ieri e il collegamento è già stato buttato via',
    ).toEqual(['appena@example.com']);
  });

  it('LA TRAPPOLA — l iscritto di prima della migrazione 115 non si tocca', async () => {
    // Ha detto di sì quando la colonna della conferma non esisteva ancora:
    // `confirmed_at` vuoto e `active` vero. È un iscritto vero, ed è la metà
    // della lista.
    const { mondo } = await passaLaNotte({
      tabelle: {
        newsletter_subscribers: [
          iscrizione('vecchio@example.com', {
            active: true,
            confirm_token: null,
            created_at: giorniFa(700),
          }),
        ],
      },
    });
    expect(
      emailRimaste(mondo),
      'la potatura ha cancellato un iscritto vero: la lista si svuota da sola e nessuno se ne accorge',
    ).toEqual(['vecchio@example.com']);
  });

  it('chi si è cancellato dalla lista tiene la sua riga: è la prova che non ci vuole', async () => {
    const { mondo } = await passaLaNotte({
      tabelle: {
        newsletter_subscribers: [
          iscrizione('via@example.com', {
            active: false,
            unsubscribed_at: giorniFa(100),
            created_at: giorniFa(400),
          }),
        ],
      },
    });
    expect(
      emailRimaste(mondo),
      'senza la riga della disiscrizione, il prossimo invio rischia di ripartire proprio verso di lui',
    ).toEqual(['via@example.com']);
  });

  it('chi ha confermato resta, anche se si è iscritto due anni fa', async () => {
    const { mondo } = await passaLaNotte({
      tabelle: {
        newsletter_subscribers: [
          iscrizione('iscritta@example.com', {
            active: true,
            confirmed_at: giorniFa(690),
            confirm_token: null,
            created_at: giorniFa(700),
          }),
        ],
      },
    });
    expect(emailRimaste(mondo), 'una iscritta confermata è stata cancellata dalla lista').toEqual([
      'iscritta@example.com',
    ]);
  });
});

describe('la notte in cui una pulizia dei dati vecchi viene rifiutata', () => {
  const salvato = process.env.CRON_SECRET;
  beforeEach(() => { process.env.CRON_SECRET = 'segreto-dei-lavori'; });
  afterEach(() => { process.env.CRON_SECRET = salvato; });

  const conUnRifiuto = () => passaLaNotte({
    tabelle: { profiles: [{ id: 'admin-1', role: 'admin' }], notifications: [], cron_heartbeats: [] },
    errori: { activity_events: 'permission denied for table activity_events' },
  });

  it('IL CASO CHE ROMPEVA — sveglia un amministratore invece di contarsi da sola', async () => {
    const { corpo, mondo } = await conUnRifiuto();
    expect(corpo.retentionFallite, 'il conto delle pulizie rifiutate non torna').toBeGreaterThan(0);
    const avvisi = mondo.notifiche();
    expect(
      avvisi.length,
      'i dati oltre la finestra restano dove sono e il numero muore dentro una risposta HTTP',
    ).toBe(1);
    expect(avvisi[0].user_id).toBe('admin-1');
    expect(String(avvisi[0].body)).toContain('pulizie dei dati vecchi');
    expect(
      String(avvisi[0].body),
      'la frase dell avviso è scritta per un tecnico, non per chi la legge di notte',
    ).not.toMatch(/GDPR|art\.|HTTP|null|retention/);
    expect(avvisi[0].category, 'un allarme di sistema non si spegne con gli interruttori del marketing').toBe('system');
  });

  it('e la notte finisce rossa — ma il battito si scrive lo stesso: dice «sono passato», non «e andato bene»', async () => {
    const { res, mondo } = await conUnRifiuto();
    expect(
      res.status,
      'la notte con niente da cancellare rispondeva sempre «riuscita», ed è la notte più frequente',
    ).toBe(500);
    // 8/9/2026 — QUI PRIMA SI PRETENDEVA IL CONTRARIO, ED ERA LA DECISIONE
    // SBAGLIATA. Un permesso negato non si aggiusta da solo: la notte dopo
    // fallisce di nuovo, e dopo 26 ore senza battito il sorvegliante annuncia
    // «process-deletions fermo: scheduler o deploy down?» mentre il lavoro
    // parte puntuale ogni notte. Peggio: da quel momento il battito resta
    // vecchio PER SEMPRE, quindi il giorno in cui il lavoro si ferma davvero il
    // segnale è identico a quello di ieri. Che il giro abbia trovato un
    // problema lo dicono il 500 e l'avviso agli amministratori (provati qui
    // sopra); che il giro sia AVVENUTO lo può dire solo il battito.
    expect(
      mondo.battitoScritto(),
      'il giro è passato e il battito manca: il sorvegliante dirà che è fermo un lavoro che gira',
    ).toBe(true);
  });

  it('la notte in cui tutto va bene resta verde e non sveglia nessuno', async () => {
    const { res, corpo, mondo } = await passaLaNotte({
      tabelle: {
        profiles: [{ id: 'admin-1', role: 'admin' }],
        notifications: [],
        cron_heartbeats: [],
        newsletter_subscribers: [iscrizione('estraneo@example.com')],
      },
    });
    expect(res.status).toBe(200);
    expect(corpo.retentionFallite).toBe(0);
    expect(mondo.notifiche().length, 'grida al lupo su una notte perfetta').toBe(0);
    expect(mondo.battitoScritto()).toBe(true);
  });
});
