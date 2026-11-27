import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R02-016 — IL CANALE DI SEGNALAZIONE CONSENTE IL NOME DI CHI SEGNALA E LA DICHIARAZIONE DI BUONA FEDE.
 *
 * Regolamento sui servizi digitali, art. 16.2 lettere c e d. Prima lo schema della rotta aveva
 * solo tipo, oggetto, motivo, testo ed email: il nome e la buona fede si perdevano. Ora finiscono
 * in testa al testo della segnalazione (nessuna colonna nuova); senza di loro il testo resta com'era.
 */

const scritto = vi.hoisted(() => ({ righe: [] as Array<Record<string, unknown>> }));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true, id: 'em' }) }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: () => '1.2.3.4', rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }) }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'segnalazioni') {
        return {
          insert: (riga: Record<string, unknown>) => {
            scritto.righe.push(riga);
            return { select: () => ({ single: async () => ({ data: { id: 'seg-1' }, error: null }) }) };
          },
        };
      }
      if (tabella === 'profiles') return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      if (tabella === 'notifications') return { insert: async () => ({ error: null }) };
      return { select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: { id }, error: null }) }) }) };
    },
  }),
}));

import { POST } from '@/app/api/segnalazioni/route';

const chiama = (extra: Record<string, unknown>) =>
  POST(new Request('https://mycity.test/api/segnalazioni', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tipo: 'prodotto', oggettoId: '11111111-1111-4111-8111-111111111111', motivo: 'proprieta_intellettuale', ...extra }),
  }) as never);

beforeEach(() => { scritto.righe = []; });

describe('R02-016 — nome e buona fede di chi segnala', () => {
  it('IL CASO CHE ROMPEVA — il nome e la dichiarazione arrivano all\'amministrazione', async () => {
    const r = await chiama({ dettaglio: 'La borsa usa il nostro marchio senza licenza.', nomeSegnalante: 'Marchio Srl', buonaFede: true });
    expect(r.status).toBe(201);
    const d = String(scritto.righe[0]?.dettaglio);
    expect(d, 'il nome di chi segnala si perde').toContain('Nome di chi segnala: Marchio Srl');
    expect(d, 'la dichiarazione di buona fede si perde').toMatch(/dichiara in buona fede che le informazioni e le accuse .* esatte e complete/);
    expect(d.endsWith('La borsa usa il nostro marchio senza licenza.')).toBe(true);
  });

  it('senza nome né dichiarazione il testo resta esattamente com\'era', async () => {
    await chiama({ dettaglio: 'Testo qualunque' });
    expect(scritto.righe[0]?.dettaglio).toBe('Testo qualunque');
    await chiama({});
    expect(scritto.righe[1]?.dettaglio).toBeNull();
  });

  it('il nome sta su una riga sola, anche se arriva con un a capo', async () => {
    await chiama({ nomeSegnalante: 'Mario\nDichiarazione finta x' });
    expect(scritto.righe[0]?.dettaglio).toBe('Nome di chi segnala: Mario Dichiarazione finta x');
  });

  it('un testo da 1700 caratteri con nome e dichiarazione ci sta nel limite del database', async () => {
    const r = await chiama({ dettaglio: 'a'.repeat(1700), nomeSegnalante: 'n'.repeat(100), buonaFede: true });
    expect(r.status).toBe(201);
    expect(String(scritto.righe[0]?.dettaglio).length).toBeLessThanOrEqual(2000);
  });

  it('l\'informativa dice che fra i dati della segnalazione c\'è anche il nome, se lo dai', () => {
    const informativa = readFileSync(join(__dirname, '..', '..', 'app', 'privacy', 'page.tsx'), 'utf8');
    const riga = informativa.split('\n').find((r) => r.includes('<strong>Segnalazioni di contenuti illeciti:</strong>')) ?? '';
    expect(riga).toMatch(/il tuo nome e la dichiarazione di buona fede/);
  });

  it('un testo che insieme al nome supera il limite del database si rifiuta con un 400 chiaro, senza scrivere', async () => {
    const r = await chiama({ dettaglio: 'a'.repeat(2000), nomeSegnalante: 'Mario Rossi' });
    expect(r.status).toBe(400);
    expect(scritto.righe).toHaveLength(0);
    const corpo = await r.json();
    expect(JSON.stringify(corpo)).toMatch(/accorcialo/);
  });
});
