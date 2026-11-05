/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { accendi, clicca } from './aiuti/schermo';
import { testoVisibile } from './aiuti/monta-componente';

/**
 * S08 (5/11/2026) — Impostazioni dell'account, Zona pericolosa e scheda Privacy.
 * La pagina vera si monta; di finto ci sono le risposte di /api/account/delete,
 * il client di Supabase e i messaggi a comparsa.
 */

const UTENTE = { id: 'u-1', email: 'anna@example.com' };

type Risposta = { status: number; corpo: unknown };
const stato: {
  get: Risposta;
  post: Risposta;
  del: Risposta;
  toast: Array<{ tipo: string; testo: string; opzioni?: Record<string, unknown> }>;
  tracciati: unknown[][];
  newsletter: boolean;
} = {
  get: { status: 200, corpo: { pending: false } },
  post: { status: 200, corpo: {} },
  del: { status: 200, corpo: { ok: true } },
  toast: [],
  tracciati: [],
  newsletter: false,
};

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: UTENTE }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 'gettone' } }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { notif_order_updates: true, notif_promos: true, notif_groups: true, notif_newsletter: stato.newsletter, email_marketing: false },
            error: null,
          }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));
vi.mock('next/navigation', () => {
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
vi.mock('next-intl', () => ({ useTranslations: () => (chiave: string) => chiave }));
vi.mock('sonner', () => {
  const registra = (tipo: string) => (testo: string, opzioni?: Record<string, unknown>) => {
    stato.toast.push({ tipo, testo, opzioni });
  };
  return { toast: { success: registra('success'), error: registra('error'), info: registra('info') } };
});
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: (...a: unknown[]) => { stato.tracciati.push(a); } }));
vi.mock('@/components/PushNotificationOptIn', () => ({ default: function PushNotificationOptIn() { return null; } }));
vi.mock('@/components/PublicProfileToggle', () => ({ default: function PublicProfileToggle() { return null; } }));

import SettingsPage from '@/app/profile/settings/page';

function risposta(r: Risposta) {
  return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  stato.get = { status: 200, corpo: { pending: false } };
  stato.post = { status: 200, corpo: {} };
  stato.del = { status: 200, corpo: { ok: true } };
  stato.toast = [];
  stato.tracciati = [];
  stato.newsletter = false;
  window.history.replaceState(null, '', '/profile/settings');
  (globalThis as Record<string, unknown>).fetch = async (_url: string, init?: RequestInit) => {
    const metodo = (init?.method ?? 'GET').toUpperCase();
    if (metodo === 'POST') return risposta(stato.post);
    if (metodo === 'DELETE') return risposta(stato.del);
    return risposta(stato.get);
  };
});

async function aspetta() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function apri(scheda?: string) {
  const s = accendi(SettingsPage);
  await aspetta();
  if (scheda) {
    const bottone = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).trim() === scheda);
    if (!bottone) throw new Error(`scheda «${scheda}» non trovata`);
    s.agisci(() => clicca(bottone));
    await aspetta();
  }
  return s;
}

const giorniFra = (g: number) => new Date(Date.now() + g * 86_400_000).toISOString();

const STRADA_503 = {
  error: {
    code: 'SERVICE_UNAVAILABLE',
    message: "Cancellare l'account in automatico non è disponibile in questo momento. Puoi fare la richiesta lo stesso: scrivi a privacy@mycity-marketplace.com. Ti rispondiamo entro un mese, come prevede la legge.",
    details: { recapito: { href: 'mailto:privacy@mycity-marketplace.com?subject=x', testo: 'privacy@mycity-marketplace.com' } },
  },
};

describe('Zona pericolosa: lo stato della richiesta', () => {
  it('scheda 2027 — ?tab=danger apre direttamente la Zona pericolosa', async () => {
    window.history.replaceState(null, '', '/profile/settings?tab=danger');
    stato.get = { status: 200, corpo: { pending: true, effectiveAt: giorniFra(3), daysRemaining: 3, rinviata: false } };
    const s = await apri();
    expect(testoVisibile(s.radice)).toContain('Eliminazione programmata');
    s.smonta();
  });

  it('scheda 2026 — ferma senza avviso dopo i 7 giorni: niente «tra 0 giorni» con una data passata', async () => {
    stato.get = { status: 200, corpo: { pending: true, effectiveAt: giorniFra(-3), daysRemaining: 0, rinviata: false, motivo: null } };
    const s = await apri('Zona pericolosa');
    const testo = testoVisibile(s.radice);
    expect(testo).not.toMatch(/tra\s*0\s*giorni/);
    expect(testo).not.toContain('entro questa data');
    expect(testo).toContain('I 7 giorni per ripensarci sono passati');
    s.smonta();
  });

  it('scheda 1999 — rinviata senza testo del motivo: il riquadro del rinvio c è lo stesso', async () => {
    stato.get = { status: 200, corpo: { pending: true, effectiveAt: giorniFra(-3), daysRemaining: 0, rinviata: true, motivo: null } };
    const s = await apri('Zona pericolosa');
    const testo = testoVisibile(s.radice);
    expect(testo).toContain('La cancellazione è in attesa.');
    expect(testo).toContain('Il motivo ti è stato scritto nelle notifiche');
    s.smonta();
  });

  it('scheda 2042 — rilettura del motivo caduta: «non riusciamo a leggere», non il conto alla rovescia', async () => {
    stato.get = { status: 200, corpo: { pending: true, effectiveAt: giorniFra(-3), daysRemaining: 0, rinviata: null, letturaFallita: true, motivo: null } };
    const s = await apri('Zona pericolosa');
    const testo = testoVisibile(s.radice);
    expect(testo).toContain('Non riusciamo a leggere lo stato della tua richiesta');
    expect(testo).not.toMatch(/tra\s*0\s*giorni/);
    s.smonta();
  });

  it('scheda 2024 — «/contact» e l indirizzo dentro il motivo sono collegamenti', async () => {
    const motivo = 'Cancellazione rinviata. Se pensi che non sia giusto scrivi a noi con il modulo dei contatti del sito (pagina /contact) oppure a privacy@mycity-marketplace.com.';
    stato.get = { status: 200, corpo: { pending: true, effectiveAt: giorniFra(-3), daysRemaining: 0, rinviata: true, motivo } };
    const s = await apri('Zona pericolosa');
    const link = Array.from(s.radice.querySelectorAll('[role="status"] a')).map((a) => a.getAttribute('href'));
    expect(link).toContain('/contact');
    expect(link).toContain('mailto:privacy@mycity-marketplace.com');
    s.smonta();
  });

  it('scheda 2035 — senza chiave di servizio la Zona pericolosa lo dice subito, senza il modulo ELIMINA', async () => {
    stato.get = { status: 503, corpo: STRADA_503 };
    const s = await apri('Zona pericolosa');
    const testo = testoVisibile(s.radice);
    expect(testo).toContain('La cancellazione automatica è spenta');
    expect(testo).toContain('privacy@mycity-marketplace.com');
    expect(s.radice.querySelector('#conferma-eliminazione')).toBeNull();
    s.smonta();
  });
});

describe('Zona pericolosa: i pulsanti', () => {
  it('scheda 2041 — richiesta già registrata: mostra il motivo, non «tra 0 giorni»', async () => {
    const motivo = 'Cancellazione rinviata: risultano 120,00 € di contanti non ancora versati.';
    stato.post = {
      status: 200,
      corpo: { alreadyRequested: true, requestedAt: giorniFra(-10), effectiveAt: giorniFra(-3), daysRemaining: 0, rinviata: true, motivo },
    };
    const s = await apri('Zona pericolosa');
    const campo = s.radice.querySelector<HTMLInputElement>('#conferma-eliminazione')!;
    s.agisci(() => {
      const imposta = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      imposta.call(campo, 'ELIMINA');
      campo.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const bottone = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).includes('Richiedi eliminazione'))!;
    s.agisci(() => clicca(bottone));
    await aspetta();
    const testo = testoVisibile(s.radice);
    expect(testo).toContain(motivo);
    expect(testo).not.toMatch(/tra\s*0\s*giorni/);
    expect(stato.toast.map((t) => t.testo).join(' ')).not.toMatch(/tra 0 giorni/);
    s.smonta();
  });

  it('scheda 2056 — «Annulla eliminazione» senza chiave mostra la frase del server e il suo pulsante', async () => {
    stato.get = { status: 200, corpo: { pending: true, effectiveAt: giorniFra(3), daysRemaining: 3, rinviata: false } };
    stato.del = { status: 503, corpo: STRADA_503 };
    const s = await apri('Zona pericolosa');
    const bottone = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).includes('Annulla eliminazione'))!;
    s.agisci(() => clicca(bottone));
    await aspetta();
    const errore = stato.toast.find((t) => t.tipo === 'error');
    expect(errore?.testo).toContain('privacy@mycity-marketplace.com');
    expect(errore?.testo).not.toContain('Riprova fra un momento');
    expect(errore?.opzioni?.action).toBeTruthy();
    s.smonta();
  });

  it('schede 2022, 2023, 2025 — il pulsante del messaggio è corto, non lo chiude, e l errore si conta', async () => {
    stato.post = { status: 503, corpo: STRADA_503 };
    const s = await apri('Zona pericolosa');
    const campo = s.radice.querySelector<HTMLInputElement>('#conferma-eliminazione')!;
    s.agisci(() => {
      const imposta = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      imposta.call(campo, 'ELIMINA');
      campo.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const bottone = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).includes('Richiedi eliminazione'))!;
    s.agisci(() => clicca(bottone));
    await aspetta();
    const errore = stato.toast.find((t) => t.tipo === 'error')!;
    const azione = errore.opzioni!.action as { label: string; onClick: (e: { preventDefault: () => void }) => void };
    // 2022: l'indirizzo intero non sta nel pulsante (è già nel messaggio).
    expect(azione.label).not.toContain('@');
    expect(azione.label.length).toBeLessThanOrEqual(30);
    // 2023: il tocco ferma la chiusura del messaggio.
    const assign = vi.fn();
    const originale = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originale, assign } });
    let fermato = false;
    azione.onClick({ preventDefault: () => { fermato = true; } });
    Object.defineProperty(window, 'location', { configurable: true, value: originale });
    expect(fermato).toBe(true);
    expect(assign).toHaveBeenCalledWith('mailto:privacy@mycity-marketplace.com?subject=x');
    // 2025: l'errore mostrato si conta come gli altri.
    expect(stato.tracciati.length).toBeGreaterThan(0);
    s.smonta();
  });
});

describe('le altre schede', () => {
  it('scheda 2028 — senza nessun canale la scheda Privacy non manda al modulo dei contatti', async () => {
    stato.get = {
      status: 503,
      corpo: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Vedere lo stato della cancellazione in automatico non è disponibile in questo momento. La tua richiesta non è partita.', details: { recapito: null } } },
    };
    const s = await apri('Privacy e dati');
    const testo = testoVisibile(s.radice);
    expect(testo).not.toContain('scrivici dal');
    expect(testo).toContain('La tua richiesta non è partita');
    s.smonta();
  });

  it('scheda 2036 — newsletter spenta al lancio: nessun interruttore da accendere, niente «coupon»', async () => {
    const { NEWSLETTER_ACCESA, CODICI_SCONTO_IN_CASSA } = await import('@/lib/funzioni-al-lancio');
    const s = await apri('Notifiche');
    const testo = testoVisibile(s.radice);
    if (!NEWSLETTER_ACCESA) {
      expect(testo).not.toContain('Newsletter mensile');
      expect(testo).toContain('La newsletter non è ancora attiva');
    }
    if (!CODICI_SCONTO_IN_CASSA) expect(testo).not.toMatch(/coupon/i);
    s.smonta();
  });
});
