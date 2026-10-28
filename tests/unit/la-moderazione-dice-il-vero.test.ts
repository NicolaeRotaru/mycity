import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 28/10/2026 — TRE DIFETTI DELLA ROTTA DI MODERAZIONE (ondata 10 del sito).
 *
 * ① Il rifiuto non scriveva `approved_at`. La potatura dei documenti dei
 *   respinti (migrations/135, `documenti_da_cancellare_respinti`) conta i 90
 *   giorni da quel campo e salta chi ce l'ha vuoto: nel caso normale — iscritto,
 *   mai approvato, rifiutato — i documenti non scadevano mai. E per chi era stato
 *   approvato anni prima l'orologio contava dall'approvazione: i file sparivano
 *   la notte stessa. Il rifiuto deve far ripartire l'orologio da adesso.
 * ② Si poteva moderare sé stessi, o un ruolo che non si approva (cliente,
 *   amministratore), ricevendo i testi del negozio e un `{ok:true}` che per un
 *   amministratore non toglie niente (l'involucro admin non guarda `is_approved`).
 * ③ La notifica si inseriva senza guardare l'esito: «ok» anche se il respinto il
 *   motivo non l'ha mai ricevuto.
 */

const ADMIN = { id: 'admin-1', email: 'a@x.com' };
let idBersaglio = 'rider-1';

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: { req: Request; user: typeof ADMIN; params: { id: string } }) => unknown) =>
    (req: Request) =>
      h({ req, user: ADMIN, params: { id: idBersaglio } }),
}));

let profiloBersaglio: Record<string, unknown> | null = null;
let aggiornamenti: Record<string, unknown>[] = [];
let notifiche: Record<string, unknown>[] = [];
let erroreNotifica: { message: string } | null = null;

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) =>
      tabella === 'profiles'
        ? {
            select: () => ({
              eq: () => ({ single: () => Promise.resolve({ data: profiloBersaglio, error: null }) }),
            }),
            update: (patch: Record<string, unknown>) => {
              aggiornamenti.push(patch);
              return { eq: () => Promise.resolve({ error: null }) };
            },
          }
        : {
            insert: (riga: Record<string, unknown>) => {
              notifiche.push(riga);
              return Promise.resolve({ error: erroreNotifica });
            },
          },
  }),
}));

vi.mock('@/lib/audit', () => ({ writeAudit: () => Promise.resolve() }));

import { POST as MODERA } from '@/app/api/admin/users/[id]/moderate/route';

function richiesta(action: string, reason?: string): never {
  return new Request('http://localhost/api/admin/users/x/moderate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reason ? { action, reason } : { action }),
  }) as never;
}

beforeEach(() => {
  aggiornamenti = [];
  notifiche = [];
  erroreNotifica = null;
  idBersaglio = 'rider-1';
  profiloBersaglio = { id: 'rider-1', role: 'rider', store_name: null, full_name: 'Luca', legal_birth_date: null };
});

describe('il rifiuto fa partire l orologio dei 90 giorni', () => {
  it('scrive approved_at = adesso, così la potatura dei documenti si attiva', async () => {
    const prima = Date.now();
    const r = await MODERA(richiesta('reject', 'documento illeggibile'));
    expect(r.status).toBe(200);
    const patch = aggiornamenti[0];
    expect(patch.approval_status).toBe('rejected');
    expect(patch.approved_at, 'il rifiuto non scrive approved_at: i documenti del respinto non scadono mai').toBeTruthy();
    expect(Date.parse(String(patch.approved_at))).toBeGreaterThanOrEqual(prima - 1000);
  });
});

describe('il bersaglio si controlla', () => {
  it('non si modera sé stessi', async () => {
    idBersaglio = ADMIN.id;
    profiloBersaglio = { id: ADMIN.id, role: 'admin', store_name: null, full_name: 'Io', legal_birth_date: null };
    const r = await MODERA(richiesta('suspend'));
    expect(r.status, 'l amministratore ha sospeso sé stesso').toBeGreaterThanOrEqual(400);
    expect(aggiornamenti).toEqual([]);
  });

  it('un altro amministratore non si sospende da qui: la rotta non dice «fatto» per un effetto che non c è', async () => {
    idBersaglio = 'admin-2';
    profiloBersaglio = { id: 'admin-2', role: 'admin', store_name: null, full_name: 'Altro', legal_birth_date: null };
    const r = await MODERA(richiesta('suspend'));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(aggiornamenti).toEqual([]);
  });

  it('un cliente non riceve «Il tuo negozio è stato approvato»', async () => {
    idBersaglio = 'buyer-1';
    profiloBersaglio = { id: 'buyer-1', role: 'buyer', store_name: null, full_name: 'Anna', legal_birth_date: null };
    const r = await MODERA(richiesta('approve'));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(aggiornamenti).toEqual([]);
    expect(notifiche).toEqual([]);
  });

  it('negozi e fattorini si moderano come prima', async () => {
    const r = await MODERA(richiesta('approve'));
    expect(r.status).toBe(200);
    idBersaglio = 'seller-1';
    profiloBersaglio = { id: 'seller-1', role: 'seller', store_name: 'Pane', full_name: null, legal_birth_date: null };
    const r2 = await MODERA(richiesta('suspend'));
    expect(r2.status).toBe(200);
    expect(aggiornamenti).toHaveLength(2);
  });
});

describe('la notifica che non parte si dice', () => {
  it('se l inserimento fallisce la risposta lo segnala invece di un ok pieno', async () => {
    erroreNotifica = { message: 'guasto' };
    const r = await MODERA(richiesta('reject', 'documento scaduto'));
    const corpo = await r.json();
    expect(aggiornamenti).toHaveLength(1);
    expect(corpo.notifica_inviata, 'la notifica è fallita e la rotta risponde ok come niente fosse').toBe(false);
  });

  it('se parte, lo dice', async () => {
    const r = await MODERA(richiesta('approve'));
    expect((await r.json()).notifica_inviata).toBe(true);
  });
});
