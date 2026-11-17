import { describe, it, expect, vi } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';
import {
  recapitaAvvisi,
  type ClienteAvvisi,
  type PostaAvvisi,
  type RegistroAvvisi,
} from '@/lib/privacy/avvisi-a-chi-aspetta';
import { verdettoDelGiro, type TentativoCancellazione } from '@/lib/cron-cancellazioni';

/**
 * R02-004 (dal commit 2a5754cf) — Il finto database del giro notturno basta, da solo, per far parlare la libreria degli avvisi
 * con un `ClienteAvvisi`: doppione sulla chiave, indirizzi, e guasti a richiesta (e `.single()`, nel file -single), senza che
 * ogni prova si riscriva il suo finto.
 */
const ADESSO = new Date('2026-10-27T04:00:00.000Z').getTime();
const FATTORINO: TentativoCancellazione = {
  userId: 'rider-1',
  ok: false,
  motivo: 'cassa_da_versare',
  errore: 'Cancellazione rinviata: risultano 120,00 € di contanti incassati e non ancora versati.',
  chiestaIl: new Date(ADESSO - 8 * 86_400_000).toISOString(),
};
const dovuti = () => verdettoDelGiro([FATTORINO], ADESSO, 'privacy@mycity.example').dovuti;
const registro = (): RegistroAvvisi => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const comeCliente = (f: ReturnType<typeof fintoGiroNotturno>) => f.admin as unknown as ClienteAvvisi;

describe('R02-004 — il finto ClienteAvvisi unico', () => {
  it('due giri insieme con la chiave unica: un avviso solo, il secondo vede il doppione', async () => {
    const f = fintoGiroNotturno({ chiaviUniche: true });
    const [a, b] = await Promise.all([
      recapitaAvvisi(comeCliente(f), dovuti(), registro(), undefined, ADESSO),
      recapitaAvvisi(comeCliente(f), dovuti(), registro(), undefined, ADESSO),
    ]);
    expect(a.recapitati + b.recapitati).toBe(1);
    expect(a.giaDetti + b.giaDetti).toBe(1);
    expect(a.falliti + b.falliti).toBe(0);
    expect(f.righe('notifications')).toHaveLength(1);
  });

  it('un guasto sull\'inserimento per una persona: l\'avviso risulta fallito e nel pannello non c\'è', async () => {
    const f = fintoGiroNotturno({
      guasti: [{ tabella: 'notifications', azione: 'insert', messaggio: 'permission denied', seRiga: (r) => r.user_id === 'rider-1' }],
    });
    const r = await recapitaAvvisi(comeCliente(f), dovuti(), registro(), undefined, ADESSO);
    expect(r.falliti).toBe(1);
    expect(f.righe('notifications')).toHaveLength(0);
  });

  it('gli indirizzi arrivano da auth.admin.getUserById, e la posta li usa', async () => {
    const f = fintoGiroNotturno({ indirizzi: { 'rider-1': 'rider@example.com' } });
    const partite: string[] = [];
    const posta: PostaAvvisi = {
      indirizzoDi: async (id) => {
        const { data } = await (f.admin.auth.admin as unknown as { getUserById(i: string): Promise<{ data: { user: { email?: string } | null } }> }).getUserById(id);
        return data.user?.email ?? null;
      },
      invia: async (l) => { partite.push(l.to); return { ok: true }; },
    };
    const r = await recapitaAvvisi(comeCliente(f), dovuti(), registro(), posta, ADESSO);
    expect(r.recapitati).toBe(1);
    expect(partite).toEqual(['rider@example.com']);
  });

  it('il registro degli invii che non si legge si dice: l\'email resta ferma e si segnala', async () => {
    const f = fintoGiroNotturno({
      indirizzi: { 'rider-1': 'rider@example.com' },
      guasti: [{ tabella: 'audit_logs', azione: 'select', messaggio: 'permission denied for table audit_logs' }],
    });
    const invia = vi.fn(async () => ({ ok: true }));
    const posta: PostaAvvisi = { indirizzoDi: async () => 'rider@example.com', invia };
    const r = await recapitaAvvisi(comeCliente(f), dovuti(), registro(), posta, ADESSO);
    expect(invia).not.toHaveBeenCalled();
    expect(r.emailBloccate).toBe(1);
  });
});
