/**
 * 8/9/2026 — DUE SENSORI SULLO STESSO FATTO, CON DUE IDEE DIVERSE DI «NON ESEGUITA».
 *
 * Il giro notturno delle cancellazioni dice che il fattorino con la cassa
 * contanti ancora aperta è un RINVIO DECISO DA NOI e non deve svegliare nessuno
 * (`lib/cron-cancellazioni.ts`, con il ragionamento scritto per esteso: «UN
 * fattorino con la cassa aperta renderebbe rosso il giro TUTTE LE NOTTI»).
 *
 * Il sorvegliante degli allarmi operativi, nato lo stesso giorno a tre file di
 * distanza, guardava chi è ancora qui dopo nove giorni e suonava senza nessuna
 * esclusione, con la frase «Il giro notturno non le ha cancellate: o fallisce, o
 * non gira» — le due cose che, per quel fattorino, NON stanno succedendo.
 *
 * Un allarme sempre acceso su una casella GDPR è peggio di nessun allarme: il
 * giorno che si accende per un guasto vero è indistinguibile dal rumore di ieri.
 *
 * Qui si prova la decisione, non la query: `sorvegliaCancellazioni` è la
 * definizione condivisa di «non eseguita» che ai due sensori mancava.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  sorvegliaCancellazioni,
  giornataDiCassaAperta,
  riderConCassaAperta,
  type GiornataDiCassa,
  type LetturaCassa,
} from '@/lib/privacy/cancellazioni-in-sospeso';

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => null,
  isStripeConfigured: () => false,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

import { contantiAncoraDaVersare } from '@/lib/account/cancellazione';

const ADESSO = Date.parse('2026-09-08T09:00:00.000Z');
const giorniFa = (g: number) => new Date(ADESSO - g * 86_400_000).toISOString();

const cassaLetta = (giornate: GiornataDiCassa[]): LetturaCassa => ({ letta: true, giornate });

const giornata = (riderId: string, p: Partial<GiornataDiCassa> = {}): GiornataDiCassa => ({
  riderId,
  remittedAt: null,
  collectedCents: 12_000,
  status: 'PENDING',
  ...p,
});

describe('il sorvegliante e i rinvii che abbiamo deciso noi', () => {
  it('IL CASO CHE ROMPEVA — il fattorino con la cassa aperta non fa suonare niente, nemmeno dopo venti giorni', () => {
    const esito = sorvegliaCancellazioni(
      [{ userId: 'rider-1', chiestaIl: giorniFa(20) }],
      cassaLetta([giornata('rider-1')]),
      ADESSO,
    );

    expect(
      esito.riga,
      'suona per un rinvio deciso da noi: un avviso al giorno, per settimane, per un fattorino che non versa mai',
    ).toBeNull();
    expect(esito.daSegnalare).toHaveLength(0);
    expect(esito.rinviate.map((r) => r.userId)).toEqual(['rider-1']);
  });

  it('e nemmeno quando la giornata non quadra: un ammanco da chiarire è cassa aperta', () => {
    const esito = sorvegliaCancellazioni(
      [{ userId: 'rider-1', chiestaIl: giorniFa(40) }],
      cassaLetta([giornata('rider-1', { collectedCents: 0, status: 'MISMATCH' })]),
      ADESSO,
    );
    expect(esito.riga).toBeNull();
    expect(esito.rinviate).toHaveLength(1);
  });

  it('chi non ha contanti in mano fa suonare l allarme, come prima', () => {
    const esito = sorvegliaCancellazioni(
      [{ userId: 'cliente-1', chiestaIl: giorniFa(20) }],
      cassaLetta([]),
      ADESSO,
    );

    expect(esito.riga, 'una cancellazione davvero non eseguita non sveglia piu nessuno').not.toBeNull();
    expect(esito.giorniDellaPiuVecchia).toBe(20);
    expect(esito.riga).toContain('20 giorni');
  });

  it('e la frase non spaccia piu due ipotesi per un elenco completo', () => {
    const esito = sorvegliaCancellazioni(
      [{ userId: 'cliente-1', chiestaIl: giorniFa(20) }],
      cassaLetta([]),
      ADESSO,
    );

    expect(
      esito.riga,
      'dice ancora «o fallisce, o non gira»: due cause inventate presentate come le uniche due possibili',
    ).not.toContain('o non gira');
    expect(String(esito.riga)).toContain('contanti da versare');
  });

  it('con una cassa aperta e un guasto vero insieme, suona per uno solo e nomina l altro', () => {
    const esito = sorvegliaCancellazioni(
      [
        { userId: 'rider-1', chiestaIl: giorniFa(40) },
        { userId: 'cliente-1', chiestaIl: giorniFa(12) },
      ],
      cassaLetta([giornata('rider-1')]),
      ADESSO,
    );

    expect(esito.daSegnalare.map((r) => r.userId)).toEqual(['cliente-1']);
    expect(
      esito.giorniDellaPiuVecchia,
      'conta i giorni del fattorino rinviato: il numero nell avviso parla di una persona che non c entra',
    ).toBe(12);
    expect(String(esito.riga)).toContain('1 cancellazione e rinviata apposta');
  });

  it('IL VERSO IN CUI SBAGLIARE — una cassa che non si legge non esclude nessuno', () => {
    const esito = sorvegliaCancellazioni(
      [{ userId: 'rider-1', chiestaIl: giorniFa(20) }],
      { letta: false, perche: 'permission denied for table cod_reconciliations' },
      ADESSO,
    );

    expect(
      esito.riga,
      'un permesso negato sulla cassa spegne l allarme per tutti: e il difetto gia riparato dentro cancellazione.ts',
    ).not.toBeNull();
    expect(esito.daSegnalare).toHaveLength(1);
    expect(String(esito.riga)).toContain('non si e potuta leggere');
  });

  it('una riga di profilo senza id non si puo accoppiare a una cassa: si segnala, non si scusa', () => {
    const esito = sorvegliaCancellazioni(
      [{ userId: null, chiestaIl: giorniFa(20) }],
      cassaLetta([giornata('rider-1')]),
      ADESSO,
    );
    expect(esito.daSegnalare).toHaveLength(1);
  });

  it('una giornata gia versata non trattiene piu nessuno', () => {
    const esito = sorvegliaCancellazioni(
      [{ userId: 'rider-1', chiestaIl: giorniFa(20) }],
      cassaLetta([giornata('rider-1', { remittedAt: giorniFa(3) })]),
      ADESSO,
    );
    expect(esito.riga, 'la cassa e chiusa: qui la cancellazione DEVE risultare non eseguita').not.toBeNull();
    expect(esito.rinviate).toHaveLength(0);
  });

  it('riderConCassaAperta tiene solo chi ha davvero qualcosa in mano', () => {
    const aperti = riderConCassaAperta([
      giornata('a'),
      giornata('b', { collectedCents: 0, status: 'OK' }),
      giornata('c', { remittedAt: giorniFa(1) }),
      giornata('d', { collectedCents: 0, status: 'MISMATCH' }),
    ]);
    expect([...aperti].sort()).toEqual(['a', 'd']);
  });
});

/**
 * LA GIUNZIONE FRA I DUE FILE.
 *
 * `giornataDiCassaAperta` (qui) e `contantiAncoraDaVersare`
 * (`lib/account/cancellazione.ts`) devono dire la stessa cosa: sono i due
 * sensori che si contraddicevano. Il file del giro notturno appartiene a
 * un'altra squadra in questo lotto e non si può toccare, quindi la regola è
 * scritta in due posti — e questa prova è il chiodo che li tiene insieme: il
 * giorno in cui una delle due cambia da sola, diventa rossa.
 */
describe('le due definizioni di «cassa aperta» dicono la stessa cosa', () => {
  const fintoAdmin = (righe: Array<Record<string, unknown>>) =>
    ({
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: righe, error: null }),
        }),
      }),
    }) as never;

  const casi: Array<{ nome: string; riga: GiornataDiCassa }> = [
    { nome: 'contanti incassati e mai versati', riga: giornata('r') },
    { nome: 'niente incassato, tutto a posto', riga: giornata('r', { collectedCents: 0, status: 'OK' }) },
    { nome: 'niente incassato ma la giornata non quadra', riga: giornata('r', { collectedCents: 0, status: 'MISMATCH' }) },
    { nome: 'incassato e gia versato', riga: giornata('r', { remittedAt: '2026-09-05T10:00:00Z' }) },
    { nome: 'ammanco gia versato', riga: giornata('r', { collectedCents: 0, status: 'MISMATCH', remittedAt: '2026-09-05T10:00:00Z' }) },
    { nome: 'importo assente (null)', riga: giornata('r', { collectedCents: null, status: 'OK' }) },
    { nome: 'importo assente su giornata che non quadra', riga: giornata('r', { collectedCents: null, status: 'MISMATCH' }) },
    { nome: 'importo negativo (resto dato in piu)', riga: giornata('r', { collectedCents: -500, status: 'OK' }) },
  ];

  for (const caso of casi) {
    it(`stesso verdetto: ${caso.nome}`, async () => {
      const daNoi = giornataDiCassaAperta(caso.riga);
      const daLoro = await contantiAncoraDaVersare(
        fintoAdmin([
          {
            for_date: '2026-09-01',
            collected_cents: caso.riga.collectedCents,
            status: caso.riga.status,
            remitted_at: caso.riga.remittedAt,
          },
        ]),
        'r',
      );
      expect(
        daNoi,
        `il sorvegliante e il giro notturno non sono d accordo su «${caso.nome}»: e il difetto che stiamo chiudendo`,
      ).toBe(daLoro.esito === 'da_versare');
    });
  }
});
