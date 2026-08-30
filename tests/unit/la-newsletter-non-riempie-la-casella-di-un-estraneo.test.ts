/**
 * 27/8/2026 (R025, R065) — CON IL NOSTRO DOMINIO SI POTEVA RIEMPIRE LA CASELLA DI UN ESTRANEO.
 *
 * L'iscrizione alla newsletter era l'unico modulo pubblico del sito senza controllo anti-bot: la
 * pagina contatti ce l'ha, l'accesso ce l'ha, questa no. E c'era il seguito, che è la parte che fa
 * male: se l'indirizzo esisteva già e non era ancora confermato, la rotta riscriveva la riga con un
 * gettone nuovo e RISPEDIVA l'email di conferma. Ogni richiesta ripetuta sullo stesso indirizzo =
 * un'altra email, per sempre.
 *
 * Il prezzo non lo paga la newsletter: lo paga la consegna di TUTTE le nostre email. Chi riceve
 * dieci messaggi che non ha chiesto li segna come indesiderati, e la reputazione del dominio su
 * Resend è una sola — la stessa che porta le conferme d'ordine e i codici di ritiro.
 *
 * Adesso: gettone anti-bot verificato sul server come sulla pagina contatti, e una conferma sola
 * ogni dieci minuti per indirizzo. Chi ripete entro i dieci minuti riceve la stessa risposta di
 * sempre («ok»): dire «ne è già partita una» racconterebbe a un estraneo chi sta per iscriversi.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Riga = { id: string; confirmed_at: string | null; created_at: string };

const rigaEsistente = vi.fn<() => Riga | null>(() => null);
const insertMock = vi.fn<(r: Record<string, unknown>) => Promise<{ error: null }>>(() => Promise.resolve({ error: null }));
const updateMock = vi.fn<(r: Record<string, unknown>) => Promise<{ error: null }>>(() => Promise.resolve({ error: null }));
const sendEmailMock = vi.fn<(arg: unknown) => Promise<{ ok: boolean }>>(() => Promise.resolve({ ok: true }));
const verificaAntiBot = vi.fn<() => Promise<{ ok: true } | { ok: false; reason: string }>>(() => Promise.resolve({ ok: true as const }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rigaEsistente(), error: null }) }) }),
      insert: (r: Record<string, unknown>) => insertMock(r),
      update: (r: Record<string, unknown>) => ({ eq: async () => updateMock(r) }),
    }),
  }),
}));

vi.mock('@/lib/email/client', () => ({ sendEmail: (arg: unknown) => sendEmailMock(arg) }));
vi.mock('@/lib/captcha', () => ({ verifyTurnstileToken: () => verificaAntiBot() }));

import { POST } from '@/app/api/newsletter/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

let contatoreIp = 0;
function iscrizione(corpo: Record<string, unknown>): Request {
  contatoreIp += 1;
  return new Request('http://localhost/api/newsletter', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `9.0.0.${contatoreIp}` },
    body: JSON.stringify(corpo),
  });
}

const VALIDA = { email: 'ignaro@example.com', captchaToken: 'gettone-buono' };

describe('iscrizione alla newsletter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    rigaEsistente.mockReturnValue(null);
    verificaAntiBot.mockResolvedValue({ ok: true });
  });

  it('senza il controllo anti-bot superato non parte nessuna email', async () => {
    verificaAntiBot.mockResolvedValue({ ok: false, reason: 'CAPTCHA mancante' });

    const res = await POST(iscrizione({ email: 'ignaro@example.com' }));

    expect(res.status, 'un programma può iscrivere l\'indirizzo di chiunque, all\'infinito').toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('col gettone buono l iscrizione nasce in attesa e la conferma parte', async () => {
    const res = await POST(iscrizione(VALIDA));

    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledOnce();
    expect(insertMock.mock.calls[0][0]).toMatchObject({ email: 'ignaro@example.com', active: false });
    expect(sendEmailMock).toHaveBeenCalledOnce();
  });

  it('chiedendo due volte lo stesso indirizzo la seconda email non parte', async () => {
    // La riga c'è, non è confermata, ed è stata scritta due minuti fa: qualcuno sta insistendo.
    rigaEsistente.mockReturnValue({
      id: 'riga-1',
      confirmed_at: null,
      created_at: new Date(Date.now() - 2 * 60_000).toISOString(),
    });

    const res = await POST(iscrizione(VALIDA));

    expect(res.status, 'la risposta deve restare identica: non si dice a un estraneo chi si sta iscrivendo').toBe(200);
    expect(sendEmailMock, 'ogni richiesta ripetuta era un\'altra email nella casella di un estraneo').not.toHaveBeenCalled();
    expect(updateMock, 'il gettone di conferma già mandato non va invalidato da chi insiste').not.toHaveBeenCalled();
  });

  it('ma chi ci riprova domani riceve la sua conferma', async () => {
    rigaEsistente.mockReturnValue({
      id: 'riga-1',
      confirmed_at: null,
      created_at: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
    });

    const res = await POST(iscrizione(VALIDA));

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(sendEmailMock).toHaveBeenCalledOnce();
  });

  it('a un indirizzo già confermato non si scrive e non si dice niente', async () => {
    rigaEsistente.mockReturnValue({
      id: 'riga-1',
      confirmed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    const res = await POST(iscrizione(VALIDA));

    expect(res.status).toBe(200);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('la versione del testo del consenso che si registra è quella mostrata alla persona', async () => {
    // R065 — il modulo non la mandava, e finiva registrata sempre la costante di ripiego: la prova
    // di quale informativa la persona ha visto valeva zero.
    await POST(iscrizione({ ...VALIDA, consentTextVersion: 'newsletter-v2' }));

    expect(insertMock.mock.calls[0][0]).toMatchObject({ consent_text_version: 'newsletter-v2' });
  });
});
