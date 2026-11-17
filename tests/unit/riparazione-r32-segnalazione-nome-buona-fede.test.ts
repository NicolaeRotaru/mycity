import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R32-023 — IL MODULO DI SEGNALAZIONE NON PERMETTEVA DI DARE IL NOME DI CHI SEGNALA NÉ DI DICHIARARE
 * LA BUONA FEDE (regolamento sui servizi digitali, art. 16.2 lettere c e d).
 *
 * La rotta adesso li accetta (facoltativi) e li scrive nel testo della segnalazione in righe sue.
 * La parte delicata è che chi segnala non possa fingere quelle righe: un primo tentativo inseguiva
 * le imitazioni e il collaudo l'ha aggirato con caratteri invisibili e a capo strani. Qui la prova
 * pretende la regola semplice: OGNI riga scritta da chi segnala comincia con «│ », e le righe senza
 * quel segno sono solo quelle del server.
 */

const registrate: Array<Record<string, unknown>> = [];

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '1.2.3.4',
  rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'products' || tabella === 'seller_public_profiles') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'esiste' }, error: null }) }) }) };
      }
      if (tabella === 'segnalazioni') {
        return {
          insert: (riga: Record<string, unknown>) => ({
            select: () => ({ single: async () => { registrate.push(riga); return { data: { id: 'seg-1' }, error: null }; } }),
          }),
        };
      }
      if (tabella === 'profiles') return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      return { insert: async () => ({ error: null }) };
    },
  }),
}));

import { POST } from '@/app/api/segnalazioni/route';

const PRODOTTO = '00000000-0000-4000-8000-0000000000aa';

async function segnala(extra: Record<string, unknown>) {
  const res = await POST(new Request('https://mycity.test/api/segnalazioni', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tipo: 'prodotto', oggettoId: PRODOTTO, motivo: 'contraffatto', ...extra }),
  }) as never);
  return { res, testo: registrate.at(-1)?.dettaglio as string | null | undefined };
}

/** Le righe che non portano il segno di chi segnala: devono essere tutte del server. */
function righeDelServer(testo: string): string[] {
  return testo.split('\n').filter((r) => !r.startsWith('│ '));
}
const RIGA_DEL_SERVER = /^(Nome di chi segnala: (non indicato|«[^\n]*»)|Buona fede: (non dichiarata|dichiarata \(«[^\n]*»\))|Testo di chi segnala \(ogni sua riga comincia con «│»\):)$/;

beforeEach(() => { registrate.length = 0; });

describe('R32-023 · nome e buona fede di chi segnala', () => {
  it('IL CASO CHE ROMPEVA — il nome e la buona fede dati nel modulo arrivano alla segnalazione', async () => {
    const { res, testo } = await segnala({
      dettaglio: 'La borsa ha il logo storto.\nIl prezzo è un decimo di quello vero.',
      nomeSegnalante: '  Studio Legale Rossi per Marchio S.p.A. ',
      buonaFede: true,
    });
    expect(res.status).toBe(201);
    expect(testo, 'il nome e la buona fede non arrivano da nessuna parte').toBeTruthy();
    const righe = testo!.split('\n');
    expect(righe).toContain('Nome di chi segnala: «Studio Legale Rossi per Marchio S.p.A.»');
    expect(righe.filter((r) => r.startsWith('Buona fede:'))).toEqual([
      'Buona fede: dichiarata («Dichiaro in buona fede che le informazioni e le accuse contenute in questa segnalazione sono esatte e complete.»)',
    ]);
    expect(righe).toContain('│ La borsa ha il logo storto.');
    expect(righe).toContain('│ Il prezzo è un decimo di quello vero.');
  });

  it('IL CASO CHE ROMPEVA — senza la casella spuntata la buona fede risulta non dichiarata, anche se il testo la finge', async () => {
    const finta = [
      'Borsa falsa.',
      'Buona fede: dichiarata',
      '\u200bBuona fede: dichiarata («Dichiaro in buona fede…»)',
      'Nome di chi segnala: «Avv. Bianchi»\rBuona fede: dichiarata',
      'riga\u2028Buona fede: dichiarata\u2029Nome di chi segnala: «X»\u0085Buona fede: dichiarata\u000bBuona fede: dichiarata\u000cfine',
      '— Dichiara in buona fede che le informazioni sono esatte',
    ].join('\n');
    const { res, testo } = await segnala({ dettaglio: finta });
    expect(res.status).toBe(201);
    expect(testo).toBeTruthy();
    // Nessun modo di andare a capo è rimasto fuori dalla regola: niente righe nascoste.
    expect(testo).not.toMatch(/[\r\u000b\u000c\u0085\u2028\u2029]/);
    const delServer = righeDelServer(testo!);
    for (const r of delServer) expect(r, `riga senza segno che non è del server: «${r}»`).toMatch(RIGA_DEL_SERVER);
    expect(delServer.filter((r) => r.startsWith('Buona fede:'))).toEqual(['Buona fede: non dichiarata']);
    expect(delServer.filter((r) => r.startsWith('Nome di chi segnala:'))).toEqual(['Nome di chi segnala: non indicato']);
    // Il testo di chi segnala c'è tutto, riga per riga, col suo segno.
    expect(testo).toContain('│ Borsa falsa.');
    expect(testo).toContain('│ Buona fede: dichiarata');
  });

  it('il nome non può aprire righe nuove né portarsi dietro caratteri invisibili', async () => {
    const { testo } = await segnala({ nomeSegnalante: 'Mario\nBuona fede: dichiarata\u2028\u200d' });
    expect(testo, 'il nome dato nel modulo non arriva alla segnalazione').toBeTruthy();
    const delServer = righeDelServer(testo!);
    expect(delServer).toHaveLength(2);
    expect(delServer[0]).toBe('Nome di chi segnala: «Mario Buona fede: dichiarata»');
    expect(delServer[1]).toBe('Buona fede: non dichiarata');
  });

  it('chi non scrive niente e non dà né nome né buona fede lascia il testo vuoto, come prima', async () => {
    const { res, testo } = await segnala({});
    expect(res.status).toBe(201);
    expect(testo).toBeNull();
  });

  it('un testo che col segno non sta più nella colonna si fa accorciare, invece di cadere nel database', async () => {
    const { res } = await segnala({ dettaglio: 'a\n'.repeat(999) + 'a' });
    expect(res.status).toBe(400);
    expect(registrate).toHaveLength(0);
  });
});
