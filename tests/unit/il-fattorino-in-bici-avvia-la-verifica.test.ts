import { describe, it, expect, vi, beforeEach } from 'vitest';
import { colonneDellaTabella, databaseCheConosceLeColonne } from './aiuti/database-che-conosce-le-colonne';

/**
 * 25/11/2026 — IL FATTORINO IN BICI NON CHIUDEVA MAI L'ISCRIZIONE.
 *
 * La pagina /rider/onboarding e l'approvazione (lib/admin/regole-approvazione.ts, R03-024) dicono
 * la stessa cosa: in bici bastano documento d'identità e selfie, la patente serve a scooter e auto,
 * la polizza RC della bici arriva dopo il lancio (`RC_OBBLIGATORIA_PER_LA_BICI = false`). Il
 * pulsante «Salva e avvia verifica» si apriva con quei due documenti, ma `/api/kyc/start-check`
 * pretendeva sempre patente e polizza e rispondeva 400 «Carica la patente (richiesta per
 * scooter/auto).» anche a chi aveva scritto BIKE. Il fattorino in bici restava fuori per sempre.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────
 * ESEGUE la rotta vera contro un database che conosce le colonne vere (dai tipi generati dalle
 * migrazioni), con il fornitore del controllo finto:
 * ① BIKE ed EBIKE con solo documento e selfie arrivano al fornitore (200).
 * ② SCOOTER e CAR senza patente ricevono ancora 400; CAR con patente ma senza polizza pure.
 * ③ Un mezzo non dichiarato chiede tutto, come prima.
 */

const stato = vi.hoisted(() => ({
  client: null as unknown,
  aggiornamenti: [] as Record<string, unknown>[],
}));

const startCheck = vi.fn(async (_persona: unknown, _documenti: unknown) => ({
  ok: true,
  status: 'PENDING',
  providerCheckId: 'manual_bici_1',
}));
vi.mock('@/lib/kyc/providers', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getKycProvider: () => ({ startCheck }),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.client }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opzioni: unknown, gestore: (ctx: { user: { id: string; email: string } }) => Promise<Response>) =>
    () =>
      gestore({ user: { id: 'fattorino-1', email: 'luca@example.com' } }),
}));

type Rotta = (req: Request) => Promise<Response>;

/** Il fattorino con solo documento fronte e selfie: niente patente, niente polizza. */
function fattorino(campi: Record<string, unknown>) {
  return {
    id: 'fattorino-1',
    role: 'rider',
    legal_first_name: 'Luca',
    legal_last_name: 'Bianchi',
    legal_fiscal_code: null,
    legal_birth_date: '1995-03-10',
    business_vat_number: null,
    kyc_id_doc_front_url: 'fattorino-1/id_front-1.png',
    kyc_id_doc_back_url: null,
    kyc_selfie_url: 'fattorino-1/selfie-1.png',
    rider_license_url: null,
    rider_insurance_url: null,
    rider_vehicle_type: 'BIKE',
    kyc_provider_check_id: null,
    kyc_provider_status: null,
    ...campi,
  };
}

/**
 * La rotta vera, su un database che rifiuta le colonne che non esistono e che, come PostgREST,
 * restituisce SOLO le colonne chieste: una rotta che non legge `rider_vehicle_type` non lo vede,
 * e la prova lo scopre (l'aiuto da solo restituisce la riga intera).
 */
async function chiama(profilo: Record<string, unknown>) {
  const db = databaseCheConosceLeColonne({ profiles: [profilo] });
  stato.client = {
    from: (tabella: string) => {
      const b = db.from(tabella) as Record<string, unknown>;
      let chieste = '*';
      const select = b.select as (c?: string) => unknown;
      b.select = (c?: string) => {
        chieste = c ?? '*';
        return select(c);
      };
      const single = b.single as () => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
      b.single = async () => {
        const r = await single();
        if (!r.data || chieste.trim() === '*') return r;
        const nomi = chieste.split(',').map((s) => s.trim()).filter(Boolean);
        return { ...r, data: Object.fromEntries(nomi.filter((n) => n in r.data!).map((n) => [n, r.data![n]])) };
      };
      b.update = (patch: Record<string, unknown>) => {
        stato.aggiornamenti.push(patch);
        return { eq: async () => ({ data: null, error: null }) };
      };
      return b;
    },
    storage: {
      from: () => ({
        createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://firmato/${p}` }, error: null }),
      }),
    },
  };
  const { POST } = await import('@/app/api/kyc/start-check/route');
  const res = await (POST as unknown as Rotta)(new Request('http://localhost/api/kyc/start-check', { method: 'POST' }));
  return { status: res.status, corpo: JSON.stringify(await res.json()), errori: db.errori };
}

beforeEach(() => {
  stato.client = null;
  stato.aggiornamenti = [];
  startCheck.mockClear();
});

describe('il fattorino avvia la verifica con i documenti che il suo mezzo chiede', () => {
  for (const mezzo of ['BIKE', 'EBIKE']) {
    it(`${mezzo} con solo documento e selfie arriva al fornitore`, async () => {
      const { status, corpo, errori } = await chiama(fattorino({ rider_vehicle_type: mezzo }));

      expect(errori, 'la rotta chiede una colonna che non esiste (42703)').toEqual([]);
      expect(status, `il fattorino in bici viene fermato: ${corpo}`).toBe(200);
      expect(corpo).not.toContain('patente');
      expect(startCheck).toHaveBeenCalledTimes(1);
      // Lo stato della verifica si salva solo su colonne vere del profilo.
      const colonne = colonneDellaTabella('profiles') ?? [];
      expect(stato.aggiornamenti).toHaveLength(1);
      for (const c of Object.keys(stato.aggiornamenti[0])) expect(colonne).toContain(c);
      expect(stato.aggiornamenti[0].kyc_provider_status).toBe('PENDING');
    });
  }

  for (const mezzo of ['SCOOTER', 'CAR']) {
    it(`${mezzo} senza patente riceve ancora 400 e il fornitore non viene chiamato`, async () => {
      const { status, corpo, errori } = await chiama(fattorino({ rider_vehicle_type: mezzo }));

      expect(errori).toEqual([]);
      expect(status).toBe(400);
      expect(corpo).toContain('patente');
      expect(startCheck).not.toHaveBeenCalled();
    });
  }

  it('CAR con la patente ma senza polizza RC riceve 400 sulla polizza', async () => {
    const { status, corpo } = await chiama(
      fattorino({ rider_vehicle_type: 'CAR', rider_license_url: 'fattorino-1/rider_license-1.png' }),
    );

    expect(status).toBe(400);
    expect(corpo).toContain('polizza RC');
    expect(startCheck).not.toHaveBeenCalled();
  });

  it('SCOOTER con patente e polizza arriva al fornitore', async () => {
    const { status, corpo } = await chiama(
      fattorino({
        rider_vehicle_type: 'SCOOTER',
        rider_license_url: 'fattorino-1/rider_license-1.png',
        rider_insurance_url: 'fattorino-1/rider_insurance-1.png',
      }),
    );

    expect(status, corpo).toBe(200);
    expect(startCheck).toHaveBeenCalledTimes(1);
  });

  it('un mezzo non dichiarato chiede tutto, come prima', async () => {
    const { status, corpo } = await chiama(fattorino({ rider_vehicle_type: null }));

    expect(status).toBe(400);
    expect(corpo).toContain('patente');
    expect(startCheck).not.toHaveBeenCalled();
  });
});

/**
 * Il passo dopo: il pannello admin. `esameRider` (lib/kyc/esame-rider.ts) teneva patente e polizza
 * obbligatorie per tutti: il fattorino in bici arrivava in verifica e «Approva» restava spento con
 * «Manca: Patente», mentre la rotta che approva (motivoPerNonApprovare) l'avrebbe accettato.
 * Qui il pannello e la rotta devono dire la stessa cosa, mezzo per mezzo.
 */
describe('il pannello admin e la rotta che approva danno lo stesso verdetto sul fattorino', () => {
  const OGGI = '2026-11-25';
  const URL = {
    kyc_id_doc_front_url: 'r/fronte.png',
    kyc_selfie_url: 'r/selfie.png',
  };
  const PATENTE = {
    valida: { rider_license_url: 'r/patente.png', rider_license_expires_on: '2030-01-01' },
    scaduta: { rider_license_url: 'r/patente.png', rider_license_expires_on: '2025-01-01' },
    assente: {},
  } as const;
  const POLIZZA = {
    valida: { rider_insurance_url: 'r/polizza.png', rider_insurance_expires_on: '2030-01-01' },
    assente: {},
  } as const;

  function perIlPannello(p: Record<string, string | null | undefined>, mezzo: string | null) {
    return {
      legal_birth_date: '1995-03-10',
      veicolo: { tipo: mezzo, targa: null },
      documenti: [
        { chiave: 'documento_fronte' as const, etichetta: 'Fronte', url: p.kyc_id_doc_front_url ?? null, scade_il: null },
        { chiave: 'selfie' as const, etichetta: 'Selfie', url: p.kyc_selfie_url ?? null, scade_il: null },
        { chiave: 'patente' as const, etichetta: 'Patente', url: p.rider_license_url ?? null, scade_il: p.rider_license_expires_on ?? null },
        { chiave: 'polizza' as const, etichetta: 'Polizza RC', url: p.rider_insurance_url ?? null, scade_il: p.rider_insurance_expires_on ?? null },
      ],
    };
  }

  for (const mezzo of ['BIKE', 'EBIKE', 'SCOOTER', 'CAR', null]) {
    for (const [nomePatente, patente] of Object.entries(PATENTE)) {
      for (const [nomePolizza, polizza] of Object.entries(POLIZZA)) {
        it(`${mezzo ?? 'mezzo non dichiarato'} · patente ${nomePatente} · polizza ${nomePolizza}`, async () => {
          const { esameRider } = await import('@/lib/kyc/esame-rider');
          const { motivoPerNonApprovare } = await import('@/lib/admin/regole-approvazione');
          const profilo = { ...URL, ...patente, ...polizza } as Record<string, string>;
          const rotta = motivoPerNonApprovare(
            {
              role: 'rider',
              rider_vehicle_type: mezzo,
              legal_first_name: 'Luca',
              legal_last_name: 'Bianchi',
              legal_fiscal_code: 'BNCLCU95C10G535X',
              legal_birth_date: '1995-03-10',
              ...profilo,
            },
            'approve',
            OGGI,
          );
          const pannello = esameRider(perIlPannello(profilo, mezzo), OGGI);
          expect(pannello.puoApprovare, `pannello: ${pannello.motivi.join(' ')} · rotta: ${rotta}`).toBe(rotta === null);
        });
      }
    }
  }

  it('in bici con solo documento e selfie il pannello lascia approvare', async () => {
    const { esameRider } = await import('@/lib/kyc/esame-rider');
    const esito = esameRider(perIlPannello(URL, 'BIKE'), OGGI);
    expect(esito.motivi).toEqual([]);
    expect(esito.puoApprovare).toBe(true);
  });
});
