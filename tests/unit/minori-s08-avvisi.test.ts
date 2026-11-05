import { describe, it, expect, vi } from 'vitest';

/**
 * S08 (5/11/2026) — lib/privacy/avvisi-a-chi-aspetta.ts: la spiegazione dovuta
 * a chi aspetta la cancellazione, nel pannello e per email.
 */

const spedite = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (l: Record<string, unknown>) => { spedite.push(l); return { ok: true }; },
}));

import {
  recapitaAvvisi,
  rispondiAChiAspetta,
  corpoDellEmail,
  TENTATIVI_EMAIL_MASSIMI,
  type ClienteAvvisi,
  type LetturaAvvisi,
  type PostaAvvisi,
  type RegistroAvvisi,
} from '@/lib/privacy/avvisi-a-chi-aspetta';
import { verdettoDelGiro, type TentativoCancellazione } from '@/lib/cron-cancellazioni';

const ADESSO = new Date('2026-10-27T04:00:00.000Z').getTime();
const giorniFa = (g: number) => new Date(ADESSO - g * 86_400_000).toISOString();
const allaNotte = (n: number) => ADESSO + n * 86_400_000;

function fattorino(id: string, euro = '120,00'): TentativoCancellazione {
  return {
    userId: id, ok: false, motivo: 'cassa_da_versare',
    errore: `Cancellazione rinviata: risultano ${euro} € di contanti incassati e non ancora versati.`,
    chiestaIl: giorniFa(8),
  };
}
const dovuti = (...t: TentativoCancellazione[]) => verdettoDelGiro(t, ADESSO, 'privacy@mycity.example').dovuti;
const registro = (): RegistroAvvisi => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

type Riga = Record<string, unknown>;
function database(o: { pannelloRottoPer?: string; turnoRotto?: (riga: Riga) => boolean } = {}) {
  const tabelle: Record<string, Riga[]> = {};
  const righe = (t: string) => (tabelle[t] ??= []);
  const cliente: ClienteAvvisi = {
    from: (t) => ({
      select: () => {
        const filtri: Array<[string, unknown]> = [];
        const lettura: LetturaAvvisi = {
          eq: (c, v) => { filtri.push([c, v]); return lettura; },
          then: (ok, ko) =>
            Promise.resolve({ data: righe(t).filter((r) => filtri.every(([c, v]) => r[c] === v)), error: null }).then(ok, ko),
        };
        return lettura;
      },
      insert: async (nuove) => {
        if (t === 'notifications' && nuove.some((n) => n.user_id === o.pannelloRottoPer)) {
          return { data: null, error: { message: 'permission denied for table notifications' } };
        }
        if (t === 'audit_logs' && o.turnoRotto && nuove.some(o.turnoRotto)) {
          return { data: null, error: { message: 'connessione persa' } };
        }
        if (nuove.some((n) => righe(t).some((r) => r.id === n.id))) {
          return { data: null, error: { message: `duplicate key value violates unique constraint "${t}_pkey"` } };
        }
        righe(t).push(...nuove);
        return { data: nuove, error: null };
      },
    }),
  };
  return { cliente, righe };
}

function posta(risponde = true) {
  const lettere: Array<{ to: string; subject: string; html: string; text?: string }> = [];
  const p: PostaAvvisi = {
    indirizzoDi: async (id) => `${id}@example.com`,
    invia: async (l) => { if (risponde) lettere.push(l); return { ok: risponde }; },
  };
  return { p, lettere, set: (v: boolean) => { risponde = v; } };
}

describe('il pannello e l email', () => {
  it('schede 2008 e 1994 — se il pannello della prima persona fallisce, le email partono lo stesso, per tutte e due', async () => {
    const db = database({ pannelloRottoPer: 'rider-1' });
    const { p, lettere } = posta();
    const r = await recapitaAvvisi(db.cliente, dovuti(fattorino('rider-1'), fattorino('rider-2')), registro(), p, allaNotte(1));
    expect(r.falliti).toBe(1);
    expect(lettere.map((l) => l.to).sort()).toEqual(['rider-1@example.com', 'rider-2@example.com']);
  });

  it('scheda 2053 — l email porta il testo salvato nel pannello, non quello ricalcolato', async () => {
    const db = database();
    const { p, lettere, set } = posta(false);
    await recapitaAvvisi(db.cliente, dovuti(fattorino('rider-1', '120,00')), registro(), p, allaNotte(1));
    set(true);
    await recapitaAvvisi(db.cliente, dovuti(fattorino('rider-1', '80,00')), registro(), p, allaNotte(2));
    expect(lettere).toHaveLength(1);
    expect(lettere[0].html).toContain('120,00');
    expect(lettere[0].html).not.toContain('80,00');
  });

  it('scheda 2054 — l email ha la veste del sito e una parte di testo', async () => {
    const db = database();
    const { p, lettere } = posta();
    await recapitaAvvisi(db.cliente, dovuti(fattorino('rider-1')), registro(), p, allaNotte(1));
    expect(lettere[0].html.toLowerCase()).toContain('<!doctype html>');
    expect(lettere[0].html).toContain('/privacy');
    expect(lettere[0].text ?? '').toContain('120,00');
  });

  it('scheda 2001 — anche le notti dopo l invio l avviso si mette fra quelli da chiudere', async () => {
    const db = database();
    const { p } = posta();
    await recapitaAvvisi(db.cliente, dovuti(fattorino('rider-1')), registro(), p, allaNotte(1));
    const dopo = await recapitaAvvisi(db.cliente, dovuti(fattorino('rider-1')), registro(), p, allaNotte(2));
    expect(dopo.emailPartiteAvvisi).toHaveLength(1);
  });
});

describe('il lucchetto dei tentativi', () => {
  it('scheda 1996 — al terzo tentativo un rifiuto del registro che non è un doppione blocca, non è «in corso»', async () => {
    const db = database({ turnoRotto: (r) => (r.metadata as { tentativo?: number })?.tentativo === 3 });
    const { p } = posta(false);
    await recapitaAvvisi(db.cliente, dovuti(fattorino('rider-1')), registro(), p, allaNotte(1));
    await recapitaAvvisi(db.cliente, dovuti(fattorino('rider-1')), registro(), p, allaNotte(2));
    const terza = await recapitaAvvisi(db.cliente, dovuti(fattorino('rider-1')), registro(), p, allaNotte(3));
    expect(terza.emailBloccate).toBe(1);
    expect(terza.emailRimandate).toBe(0);
  });

  it('scheda 1963 — con la posta spenta i tentativi hanno un tetto, e dal terzo non sono più errori', async () => {
    const db = database();
    const { p } = posta(false);
    const reg = registro();
    for (let n = 1; n <= TENTATIVI_EMAIL_MASSIMI + 10; n++) {
      await recapitaAvvisi(db.cliente, dovuti(fattorino('rider-1')), reg, p, allaNotte(n));
    }
    const tentate = db.righe('audit_logs').filter((r) => String(r.action).endsWith('email_tentata'));
    expect(tentate).toHaveLength(TENTATIVI_EMAIL_MASSIMI);
    const erroriDellaPosta = (reg.error as ReturnType<typeof vi.fn>).mock.calls.filter(([m]) => String(m).includes('non e partita per email'));
    expect(erroriDellaPosta.length).toBeLessThanOrEqual(2);
  });
});

describe('come parte e cosa dice', () => {
  it('scheda 1998 — la spiegazione di legge parte come email transazionale', async () => {
    spedite.length = 0;
    const db = database();
    const admin = {
      ...db.cliente,
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@example.com` } }, error: null }) } },
    };
    await rispondiAChiAspetta(admin as never, { dovuti: dovuti(fattorino('rider-1')) }, registro());
    expect(spedite).toHaveLength(1);
    expect(spedite[0].tipo).toBe('transazionale');
  });

  it('scheda 2007 — il collegamento si trova solo su «/contact» come percorso a sé', () => {
    const [a] = dovuti(fattorino('rider-1'));
    const html = corpoDellEmail({ ...a, corpo: 'Scrivi dalla pagina /contact oppure guarda /contacts e https://altro.example/contact.', link: '' });
    expect(html.match(/<a /g)?.length).toBe(1);
    expect(html).toContain('/contacts');
    expect(html).toContain('https://altro.example/contact');
  });
});
