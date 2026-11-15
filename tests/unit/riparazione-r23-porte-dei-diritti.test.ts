/**
 * R23-002 (13/11/2026) — LE PORTE DEI DIRITTI SENZA CHIAVE: UNA RISPOSTA SOLA, NIENTE CATCH MORTI.
 *
 * Il gancio `seMancaLaChiave` di `withAuth` risponde lui quando manca la chiave di servizio:
 * dentro le porte il `try { getAdminSupabase() } catch` non scattava mai. E la risposta senza
 * chiave (`senzaChiave` + `sullaPorta`) stava copiata nella cancellazione e nell'esportazione:
 * le due copie si erano già separate, e la riga d'errore dell'esportazione non diceva chi aveva
 * chiesto né quale diritto — quando la chiave tornava, nessuno sapeva chi richiamare.
 *
 * Qui il controllo d'accesso è quello VERO: si finge solo Supabase (di chi è il gettone, e la
 * chiave che manca).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const MARIA = { id: 'u-1', email: 'maria@example.com' };

const { righe } = vi.hoisted(() => ({ righe: [] as Array<{ msg: string; ctx?: Record<string, unknown> }> }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    throw new Error('Service role Supabase non configurato (SUPABASE_SERVICE_ROLE_KEY).');
  },
  getCurrentUser: async () => null,
  getServerSupabase: async () => ({}),
}));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    auth: {
      getUser: async (gettone: string) =>
        gettone === 'gettone-di-maria'
          ? { data: { user: MARIA }, error: null }
          : { data: { user: null }, error: { message: 'invalid JWT' } },
    },
  }),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    error: (msg: unknown, ctx?: Record<string, unknown>) => { righe.push({ msg: String(msg), ctx }); },
    warn: () => {}, info: () => {}, debug: () => {}, spesa: () => {},
  },
}));

import {
  POST as chiediCancellazione,
  DELETE as annullaCancellazione,
  GET as statoCancellazione,
} from '@/app/api/account/delete/route';
import { GET as scaricaDati } from '@/app/api/account/export/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const CTX = { params: Promise.resolve({}) } as never;
type Porta = (req: never, ctx: never) => Promise<unknown>;

const PORTE: Array<[string, string, string, string, Porta]> = [
  ['Cancella account', 'POST', '/api/account/delete', "Cancellare l'account", chiediCancellazione as unknown as Porta],
  ['Annulla la cancellazione', 'DELETE', '/api/account/delete', 'Annullare la richiesta di cancellazione', annullaCancellazione as unknown as Porta],
  ['Stato della cancellazione', 'GET', '/api/account/delete', 'Vedere lo stato della cancellazione', statoCancellazione as unknown as Porta],
  ['Scarica i miei dati', 'GET', '/api/account/export', 'Scaricare i tuoi dati', scaricaDati as unknown as Porta],
];

const richiesta = (metodo: string, percorso: string) =>
  new Request('http://localhost' + percorso, {
    method: metodo,
    headers: { authorization: 'Bearer gettone-di-maria' },
  }) as never;

beforeEach(() => {
  righe.length = 0;
  process.env.NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY = 'privacy@pane-quotidiano.example';
  __resetRateLimitBuckets();
});

describe('senza la chiave di servizio, ogni porta dei diritti risponde allo stesso modo', () => {
  for (const [nome, metodo, percorso, diritto, porta] of PORTE) {
    it(`${nome}: 503 con la strada a mano, e la riga d'errore dice chi ha chiesto e quale diritto`, async () => {
      const res = (await porta(richiesta(metodo, percorso), CTX)) as Response;
      const corpo = (await res.json()) as { error: { code: string; message: string; details?: { recapito?: unknown } } };

      expect(res.status).toBe(503);
      expect(corpo.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(corpo.error.message).toContain('privacy@pane-quotidiano.example');
      expect(corpo.error.details?.recapito, 'il pulsante della strada a mano ha perso il collegamento').toBeTruthy();

      const riga = righe.find((r) => r.msg.includes('manca la chiave di servizio'));
      expect(riga, 'nessuna riga d errore per la porta spenta').toBeTruthy();
      expect(riga?.ctx, 'quando la chiave torna, nessuno sa chi richiamare').toMatchObject({ utente: MARIA.id, diritto });
    });
  }

  it('«Annulla» dice l urgenza: 7 giorni, non un mese', async () => {
    const res = (await annullaCancellazione(richiesta('DELETE', '/api/account/delete') as never, CTX)) as Response;
    const corpo = (await res.json()) as { error: { message: string; details: { recapito: { href: string } } } };
    expect(corpo.error.message).toContain('7 giorni');
    expect(corpo.error.message).not.toContain('entro un mese');
    expect(decodeURIComponent(corpo.error.details.recapito.href)).toContain('Fermate la cancellazione');
  });
});

describe('nelle rotte non restano copie della risposta né catch che non scattano mai', () => {
  const ROTTE = ['app/api/account/delete/route.ts', 'app/api/account/export/route.ts'];
  for (const rotta of ROTTE) {
    it(`${rotta}: una copia sola della risposta senza chiave, e nessun catch sulla chiave`, () => {
      const testo = readFileSync(rotta, 'utf8');
      const copiaPropria = /function\s+(senzaChiave|sullaPorta)\s*\(/.test(testo);
      const catchMorto = /try\s*\{\s*admin\s*=\s*getAdminSupabase\(\)\s*;?\s*\}\s*catch/.test(testo);
      expect(copiaPropria, 'la rotta ha ancora la sua copia di senzaChiave/sullaPorta').toBe(false);
      expect(catchMorto, 'la rotta prova ancora la chiave che withAuth ha già chiesto').toBe(false);
    });
  }
});
