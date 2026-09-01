import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * LA PASSWORD SI CAMBIA SOLO DIMOSTRANDO DI SAPERE QUELLA VECCHIA.
 *
 * 27/8/2026 (R019) — La verifica viveva dentro `app/profile/settings/page.tsx`,
 * un componente client: prima `signInWithPassword` per controllare la password
 * attuale, poi `updateUser({ password })` per cambiarla. Due chiamate
 * indipendenti, tutte e due dal browser.
 *
 * Chi controlla quella pagina — la console degli strumenti per sviluppatori,
 * un'estensione ostile, uno script iniettato — chiamava direttamente la SECONDA
 * e saltava la prima. Il commento sopra descriveva esattamente la minaccia che
 * voleva chiudere («un telefono lasciato sbloccato… cioè prendersi
 * l'account»), e il controllo messo non la chiudeva.
 *
 * Il costo: una sessione rubata — telefono sbloccato, computer condiviso,
 * cookie esfiltrato — diventava un account perso PER SEMPRE, perché con la
 * password cambiata il proprietario vero non rientra più. Su un venditore vuol
 * dire negozio, catalogo e conto Stripe collegato al payout.
 *
 * Qui verifica e cambio sono una cosa sola, e stanno dove il browser non
 * arriva: se la password attuale non combacia, la nuova non si scrive.
 */

const UTENTE = { id: 'u-1', email: 'mario@example.com' };

const stato: {
  passwordVera: string;
  /** Le password scritte davvero sull'account. */
  scritte: string[];
  accessiProvati: Array<{ email: string; password: string }>;
} = { passwordVera: 'quella-giusta-1', scritte: [], accessiProvati: [] };

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opts: unknown, handler: (ctx: { user: typeof UTENTE; req: Request }) => unknown) =>
    (req: Request) => handler({ user: UTENTE, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    auth: {
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        stato.accessiProvati.push({ email, password });
        return password === stato.passwordVera
          ? { data: {}, error: null }
          : { data: {}, error: { message: 'Invalid login credentials' } };
      },
    },
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    auth: {
      admin: {
        updateUserById: async (_id: string, patch: { password?: string }) => {
          if (patch.password) stato.scritte.push(patch.password);
          return { data: {}, error: null };
        },
      },
    },
  }),
}));

import { POST } from '@/app/api/account/cambia-password/route';

function cambia(corpo: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/account/cambia-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }) as never);
}

beforeEach(() => {
  stato.passwordVera = 'quella-giusta-1';
  stato.scritte = [];
  stato.accessiProvati = [];
  UTENTE.email = 'mario@example.com';
});

describe('chi ha in mano la sessione ma non la password', () => {
  it('IL CASO CHE ROMPEVA — password attuale sbagliata: la nuova non si scrive', async () => {
    // È il telefono lasciato sbloccato: la sessione è valida, la password no.
    const res = await cambia({ passwordAttuale: 'tirata-a-indovinare', nuovaPassword: 'nuovissima-1' });

    expect(res.status).toBe(401);
    expect(
      stato.scritte,
      'la password è stata cambiata da chi non conosceva quella vecchia: account perso per sempre',
    ).toHaveLength(0);
  });

  it('la verifica avviene sull email dell utente della sessione, non su una mandata dal chiamante', async () => {
    await cambia({ passwordAttuale: 'x', nuovaPassword: 'nuovissima-1', email: 'ladro@example.com' });
    expect(stato.accessiProvati[0]?.email).toBe('mario@example.com');
  });
});

describe('chi la password vecchia la sa', () => {
  it('la cambia', async () => {
    const res = await cambia({ passwordAttuale: 'quella-giusta-1', nuovaPassword: 'nuovissima-1' });

    expect(res.status).toBe(200);
    expect(stato.scritte).toEqual(['nuovissima-1']);
  });
});

describe('le condizioni sulla nuova password valgono anche qui', () => {
  it('una password corta non passa, anche saltando la schermata', async () => {
    // Le condizioni erano solo nel browser: chi chiama la rotta a mano le
    // salterebbe tutte.
    const res = await cambia({ passwordAttuale: 'quella-giusta-1', nuovaPassword: 'corta' });

    expect(res.status).toBe(400);
    expect(stato.scritte).toHaveLength(0);
  });

  it('senza password attuale non si prova nemmeno ad accedere', async () => {
    const res = await cambia({ nuovaPassword: 'nuovissima-1' });
    expect(res.status).toBe(400);
    expect(stato.accessiProvati).toHaveLength(0);
  });
});

describe('gli account che entrano senza password', () => {
  it('chi accede solo con Google non si ritrova una password che non ha chiesto', async () => {
    UTENTE.email = '';
    const res = await cambia({ passwordAttuale: 'x', nuovaPassword: 'nuovissima-1' });

    expect(res.status).toBe(409);
    expect(stato.scritte).toHaveLength(0);
  });
});
