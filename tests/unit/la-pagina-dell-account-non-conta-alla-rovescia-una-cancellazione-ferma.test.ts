/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { accendi, clicca } from './aiuti/schermo';
import { testoVisibile } from './aiuti/monta-componente';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

/**
 * 27/10/2026 — LA PAGINA DELL'ACCOUNT NON CONTA ALLA ROVESCIA UNA CANCELLAZIONE FERMA.
 *
 * Passo indietro. Chi chiede di cancellare l'account ha 7 giorni per
 * ripensarci; passati quelli, il giro notturno lo cancella. A volte la notte
 * non può: un fattorino ha 120 € di contanti incassati e non ancora versati.
 * Allora la notte gli scrive il motivo, e la rotta GET /api/account/delete
 * risponde `rinviata: true` insieme a quel motivo.
 *
 * Il difetto trovato dal collaudo: la pagina poteva tornare a ignorare
 * `rinviata` — in app/profile/settings/page.tsx bastava scrivere
 * `rinviata: false` — e nessuna prova diventava rossa. La rotta aveva la sua
 * prova; il pezzo fra la risposta e lo schermo no. A schermo il fattorino
 * leggeva «sarà eliminato definitivamente tra 0 giorni» accanto al motivo del
 * rinvio, e «puoi annullare entro questa data» con una data già passata.
 *
 * Qui la pagina vera si MONTA e chiede lo stato alla rotta VERA, dopo una
 * notte VERA: la catena notte → avviso → rotta → pagina è quella della
 * produzione. Di finto ci sono solo il database, il servizio di accesso e la
 * posta. Se la pagina smette di leggere `rinviata`, o la rotta lo chiama in un
 * altro modo, questa prova diventa rossa.
 */

type Esito = { ok: boolean; motivo?: string; errore?: string; fileRimossi: number; erroriFile: string[] };

const UTENTE = { id: 'rider-1', email: 'rider@example.com' };
/** Il gettone che la pagina ha in mano: il servizio di accesso riconosce solo questo. */
const GETTONE = 'gettone-del-fattorino';
const SEGRETO_DELLA_NOTTE = 'segreto-della-notte-di-prova';

const stato: { mondo: ReturnType<typeof fintoGiroNotturno>; esito: Esito } = {
  mondo: fintoGiroNotturno(),
  esito: { ok: true, fileRimossi: 0, erroriFile: [] },
};

/** Il finto database del giro notturno, col `.single()` che usano la rotta e il controllo d'accesso. */
function adminDiProva() {
  const base = stato.mondo.admin as unknown as {
    from(t: string): Record<string, unknown> & PromiseLike<{ data: unknown[] | null; error: unknown }>;
  };
  return {
    ...(stato.mondo.admin as object),
    // L'indirizzo a cui la notte spedisce la spiegazione per email.
    auth: {
      admin: {
        ...stato.mondo.admin.auth.admin,
        getUserById: async (id: string) => ({ data: { user: id === UTENTE.id ? UTENTE : null }, error: null }),
      },
    },
    from(tabella: string) {
      const q = base.from(tabella);
      q.single = async () => {
        const r = await q;
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: r.error };
      };
      return q;
    },
  };
}

// ── Il lato del server: le rotte sono quelle vere, il controllo d'accesso anche.
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => adminDiProva(),
  getCurrentUser: async () => null,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {}, spesa: () => {} },
}));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: async (): Promise<Esito> => stato.esito,
}));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    auth: {
      getUser: async (gettone?: string) =>
        gettone === GETTONE
          ? { data: { user: UTENTE }, error: null }
          : { data: { user: null }, error: { message: 'gettone sconosciuto' } },
    },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true }) }));

// ── Il lato del browser: la pagina è quella vera, fuori da Next.
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: UTENTE }, error: null }),
      getSession: async () => ({ data: { session: { access_token: GETTONE } }, error: null }),
    },
    // Le preferenze delle notifiche: la pagina le legge, a questa prova non servono.
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));
vi.mock('next/navigation', () => {
  // Sempre lo stesso oggetto: la pagina ricarica lo stato a ogni router nuovo.
  const rotta = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} };
  return { useRouter: () => rotta };
});
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: function Collegamento({ href, children, ...resto }: { href: unknown; children?: unknown } & Record<string, unknown>) {
      return createElement('a', { ...resto, href: String(href) }, children as never);
    },
  };
});
// Le parole del «caricamento in corso»: qui conta solo che il caricamento finisca.
vi.mock('next-intl', () => ({ useTranslations: () => (chiave: string) => chiave }));
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock('@/components/PushNotificationOptIn', () => ({ default: function PushNotificationOptIn() { return null; } }));
vi.mock('@/components/PublicProfileToggle', () => ({ default: function PublicProfileToggle() { return null; } }));

import SettingsPage from '@/app/profile/settings/page';
import { POST as notte } from '@/app/api/cron/process-deletions/route';
import { GET as statoCancellazione } from '@/app/api/account/delete/route';

const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();
const MOTIVO =
  'Cancellazione rinviata: risultano 120,00 € di contanti incassati alle consegne e non ancora ' +
  'versati (1 giornata di cassa). Appena il versamento è registrato la cancellazione riparte da sola.';
const CASSA_APERTA: Esito = { ok: false, motivo: 'cassa_da_versare', errore: MOTIVO, fileRimossi: 0, erroriFile: [] };

/** Il fattorino ha chiesto la cancellazione `giorni` giorni fa. */
function ilFattorinoHaChiestoDiCancellarsi(giorni: number, esito: Esito) {
  const chiesta = giorniFa(giorni);
  stato.esito = esito;
  stato.mondo = fintoGiroNotturno({
    // La funzione del database restituisce solo chi ha passato i 7 giorni.
    rpc: {
      process_expired_deletions: {
        data: giorni > 7 ? [{ user_id: UTENTE.id, deleted_at: chiesta }] : [],
        error: null,
      },
    },
    tabelle: {
      notifications: [],
      profiles: [
        { id: UTENTE.id, role: 'rider', deletion_requested_at: chiesta },
        { id: 'admin-1', role: 'admin' },
      ],
    },
  });
}

const passaLaNotte = () =>
  notte(new Request('http://localhost/api/cron/process-deletions', {
    method: 'POST',
    headers: { authorization: `Bearer ${SEGRETO_DELLA_NOTTE}` },
  }) as never);

/** Quello che la rotta vera ha risposto alla pagina, chiamata per chiamata. */
let risposte: { status: number; corpo: Record<string, unknown> }[] = [];

/** La pagina chiama /api/account/delete: risponde la rotta vera, senza rete. */
async function rispondeLaRotta(input: unknown, init?: RequestInit): Promise<Response> {
  const percorso = String(input);
  const metodo = (init?.method ?? 'GET').toUpperCase();
  if (percorso !== '/api/account/delete' || metodo !== 'GET') {
    throw new Error(`La pagina ha chiamato ${metodo} ${percorso}: questa prova non se lo aspettava`);
  }
  const res = await statoCancellazione(
    new Request('http://localhost' + percorso, { method: metodo, headers: init?.headers }) as never,
  );
  risposte.push({ status: res.status, corpo: (await res.clone().json()) as Record<string, unknown> });
  return res;
}

let smonta: (() => void) | null = null;

/** Apre le impostazioni come il fattorino, va su «Zona pericolosa» e legge quello che c'è scritto. */
async function apreLaZonaPericolosa(): Promise<string> {
  const s = accendi(SettingsPage as ComponentType);
  smonta = s.smonta;
  const scheda = () =>
    Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b) === 'Zona pericolosa');
  // La pagina aspetta l'accesso, le preferenze e la rotta: un giro alla volta.
  for (let giro = 0; giro < 100 && !scheda(); giro++) {
    await act(async () => {
      await new Promise((fatto) => setTimeout(fatto, 0));
    });
  }
  const bottone = scheda();
  if (!bottone) throw new Error('la pagina delle impostazioni non ha finito di caricare');
  s.agisci(() => clicca(bottone));
  const titolo = Array.from(s.radice.querySelectorAll('h2')).find((h) => testoVisibile(h) === 'Zona pericolosa');
  return testoVisibile(titolo?.closest('section') ?? null);
}

beforeEach(() => {
  process.env.CRON_SECRET = SEGRETO_DELLA_NOTTE;
  risposte = [];
  vi.stubGlobal('fetch', rispondeLaRotta);
});

afterEach(() => {
  smonta?.();
  smonta = null;
  vi.unstubAllGlobals();
});

describe('la pagina dell account dice quello che la rotta sa della cancellazione', () => {
  it('IL CASO CHE ROMPEVA — rinviata dalla notte: niente conto alla rovescia a zero, il motivo e la strada per annullare', async () => {
    ilFattorinoHaChiestoDiCancellarsi(8, CASSA_APERTA);
    const laNotte = await passaLaNotte();
    expect(laNotte.status, 'un rinvio deciso da noi non è un guasto').toBe(200);

    const zona = await apreLaZonaPericolosa();

    // La rotta l'ha detto: se manca questo, il guasto è a monte della pagina.
    expect(risposte).toHaveLength(1);
    expect(risposte[0].status).toBe(200);
    expect(risposte[0].corpo.rinviata, 'la rotta deve dire che la cancellazione è ferma').toBe(true);

    // E la pagina l'ha scritto.
    expect(
      zona,
      'la rotta risponde «rinviata» e la pagina non lo dice: il conto alla rovescia vale ancora per lei',
    ).toContain('I 7 giorni per ripensarci sono passati');
    expect(zona, 'il motivo del rinvio, come gliel ha scritto la notte').toContain('120,00 €');
    expect(zona, 'un conto alla rovescia fermo a zero accanto al motivo del rinvio').not.toContain(
      'eliminato definitivamente tra',
    );
    expect(zona, 'una data già passata non è un termine entro cui annullare').not.toContain('entro questa data');
    expect(zona, 'finché la cancellazione è ferma si può ancora annullare').toContain('Annulla eliminazione');
  });

  it('dentro i 7 giorni il conto alla rovescia resta quello vero, senza un rinvio inventato', async () => {
    ilFattorinoHaChiestoDiCancellarsi(2, CASSA_APERTA);
    await passaLaNotte();

    const zona = await apreLaZonaPericolosa();

    expect(risposte).toHaveLength(1);
    expect(risposte[0].corpo.rinviata).toBe(false);
    expect(zona).toMatch(/eliminato definitivamente tra 5 giorni/);
    expect(zona).toContain('entro questa data');
    expect(zona, 'nessun rinvio: niente «i 7 giorni sono passati»').not.toContain('I 7 giorni per ripensarci sono passati');
    expect(zona, 'nessun rinvio: niente «in attesa»').not.toContain('La cancellazione è in attesa');
  });
});
