/**
 * 3/9/2026 — CHI HA CHIESTO DI SPARIRE E NON È SPARITO NON LO GUARDAVA NESSUNO.
 *
 * Chi chiede di cancellare il proprio account aspetta sette giorni — il periodo
 * di ripensamento, scritto nella pagina del suo account — e poi il giro notturno
 * lo cancella. Se quel giro non gira, o gira e fallisce, la persona resta nel
 * database e non se ne accorge nessuno: è una richiesta fatta per legge che non
 * abbiamo onorato, e si scopre in un controllo.
 *
 * IL CONTROLLO SI FA SULLO STATO, NON SULL'EVENTO. Si guarda chi è ancora qui,
 * non chi ha risposto male stanotte. È l'unica forma che regge anche nel caso
 * peggiore — il lavoro notturno che non parte affatto — perché un allarme
 * scritto DENTRO quel lavoro, quella notte, non partirebbe nemmeno lui.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

type Riga = Record<string, unknown>;

const stato = {
  /** Le persone che hanno chiesto di sparire e sono ancora qui. */
  inSospeso: [] as Riga[],
  /** La lettura di quelle righe fallisce (permessi, tabella irraggiungibile). */
  erroreLettura: null as { message: string } | null,
  /** Le notifiche finite nel pannello degli amministratori. */
  notifiche: [] as Riga[],
  /** Da quanti giorni il sorvegliante considera «in sospeso» una richiesta. */
  finestraGiorni: null as number | null,
};

/**
 * Un finto costruttore di query: a tutto risponde «niente da segnalare», tranne
 * alle due domande che qui contano. Il sorvegliante fa quindici controlli e uno
 * solo ci interessa: gli altri devono TACERE, non fallire — se falliscono, la
 * rotta esce in errore prima di dire se l'allarme suona.
 */
function fintaTabella(tabella: string): Record<string, unknown> {
  const chiamate: Array<{ metodo: string; argomenti: unknown[] }> = [];
  let scritte: Riga[] = [];

  const catena: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
    get(_bersaglio, chiave) {
      if (chiave === 'then') {
        const cerca = (m: string, primo?: unknown) =>
          chiamate.some((c) => c.metodo === m && (primo === undefined || c.argomenti[0] === primo));

        let risposta: { data: Riga[] | null; error: unknown; count?: number } = { data: [], error: null };
        if (tabella === 'profiles' && cerca('not', 'deletion_requested_at')) {
          // Il filtro si applica DAVVERO: una prova che restituisce le righe
          // qualunque cosa la rotta abbia chiesto non sa dire se la finestra
          // scelta e' quella giusta, ed e' proprio la finestra il cuore di
          // questo allarme.
          const soglia = chiamate.find(
            (c) => c.metodo === 'lt' && c.argomenti[0] === 'deletion_requested_at',
          )?.argomenti[1];
          const righe = stato.inSospeso.filter(
            (r) => r.deletion_requested_at != null
              && (soglia === undefined || String(r.deletion_requested_at) < String(soglia)),
          );
          risposta = stato.erroreLettura
            ? { data: null, error: stato.erroreLettura }
            : { data: righe, error: null };
        } else if (
          tabella === 'profiles'
          && chiamate.some((c) => c.metodo === 'eq' && c.argomenti[0] === 'role' && c.argomenti[1] === 'admin')
        ) {
          // Solo la domanda «chi sono gli amministratori?». Se rispondessi
          // anche a quella sui negozianti in attesa di verifica, questo finto
          // database farebbe suonare un ALTRO allarme e la prova diventerebbe
          // verde per il motivo sbagliato.
          risposta = { data: [{ id: 'admin-1' }], error: null };
        } else if (tabella === 'notifications' && scritte.length > 0) {
          stato.notifiche.push(...scritte);
          risposta = { data: scritte, error: null };
        }
        const promessa = Promise.resolve(risposta);
        return promessa.then.bind(promessa);
      }
      if (typeof chiave === 'symbol') return undefined;
      return (...argomenti: unknown[]) => {
        chiamate.push({ metodo: String(chiave), argomenti });
        if (chiave === 'insert' || chiave === 'upsert') {
          scritte = Array.isArray(argomenti[0]) ? (argomenti[0] as Riga[]) : [argomenti[0] as Riga];
        }
        // «deletion_requested_at più vecchio di X»: X è la finestra del
        // sorvegliante, e questo è l'unico modo di saperla senza leggerla in un file.
        if (tabella === 'profiles' && chiave === 'lt' && argomenti[0] === 'deletion_requested_at') {
          const quando = new Date(String(argomenti[1])).getTime();
          stato.finestraGiorni = Math.round((Date.now() - quando) / 86_400_000);
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
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

import { POST as sorvegliante } from '@/app/api/cron/operational-alerts/route';

const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();

async function faiUnGiro() {
  const res = await sorvegliante({
    url: 'http://localhost/api/cron/operational-alerts',
    headers: new Headers(),
  } as unknown as NextRequest);
  return { http: res.status, corpo: await res.json() };
}

type Avviso = { type: string; detail: string; url?: string };
const cancellazioni = (corpo: { details?: Avviso[] }) =>
  (corpo.details ?? []).filter((a) => a.type === 'CANCELLAZIONE_NON_ESEGUITA');

describe('il sorvegliante e le richieste di cancellazione rimaste in sospeso', () => {
  const salvato = { ...process.env };

  beforeEach(() => {
    stato.inSospeso = [];
    stato.erroreLettura = null;
    stato.notifiche = [];
    stato.finestraGiorni = null;
    process.env.SUPPORT_EMAIL = 'aiuto@mycity.test';
    process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.test';
  });

  afterEach(() => { process.env = { ...salvato }; });

  it('IL CASO CHE ROMPEVA — una persona che aspetta da venti giorni fa suonare l allarme', async () => {
    stato.inSospeso = [{ deletion_requested_at: giorniFa(20) }];
    const { http, corpo } = await faiUnGiro();
    expect(http).toBe(200);
    const avvisi = cancellazioni(corpo);
    expect(
      avvisi.length,
      'una richiesta di cancellazione non eseguita da venti giorni non fa suonare niente',
    ).toBe(1);
    expect(avvisi[0].detail).toContain('20 giorni');
    expect(avvisi[0].url, 'l avviso non dice dove andare a guardare').toBe('/admin/users');
  });

  it('e la notizia arriva davvero a un amministratore, nel pannello', async () => {
    stato.inSospeso = [{ deletion_requested_at: giorniFa(20) }];
    await faiUnGiro();
    expect(stato.notifiche.length, 'nessuna notifica scritta: l allarme resta dentro la risposta').toBe(1);
    expect(stato.notifiche[0].user_id).toBe('admin-1');
    expect(String(stato.notifiche[0].body)).toContain('chiesto di cancellare l account');
  });

  it('chi ha chiesto tre giorni fa sta solo aspettando il suo turno: nessun allarme', async () => {
    // Il ripensamento dura sette giorni: prima di allora non c'è niente di
    // rotto, e un allarme qui sarebbe rumore ogni volta che qualcuno se ne va.
    stato.inSospeso = [{ deletion_requested_at: giorniFa(3) }];
    const { corpo } = await faiUnGiro();
    expect(
      cancellazioni(corpo).length,
      'suona mentre il periodo di ripensamento sta ancora scorrendo: rumore a ogni cancellazione',
    ).toBe(0);
    expect(
      stato.finestraGiorni,
      'la finestra non lascia al giro notturno nemmeno una notte per riprovare',
    ).toBeGreaterThanOrEqual(8);
  });

  it('e chi ha chiesto otto giorni fa nemmeno: al giro notturno resta una notte per riprovare', async () => {
    stato.inSospeso = [{ deletion_requested_at: giorniFa(8) }];
    const { corpo } = await faiUnGiro();
    expect(cancellazioni(corpo).length).toBe(0);
  });

  it('se quelle righe non si leggono, il giro NON si dichiara sano', async () => {
    stato.erroreLettura = { message: 'permission denied for table profiles' };
    const { http, corpo } = await faiUnGiro();
    expect(http, 'un controllo che non ha potuto guardare passava per «tutto a posto»').toBe(500);
    expect(String(corpo.controlliSaltati)).toContain('cancellazione');
  });
});
