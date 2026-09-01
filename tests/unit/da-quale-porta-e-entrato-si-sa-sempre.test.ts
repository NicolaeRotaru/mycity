import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/8/2026 (R168) — SU CHI ENTRA CON EMAIL E PASSWORD NON SI SAPEVA DA QUALE
 * PORTA FOSSE ENTRATO.
 *
 * L'evento «accesso fatto» porta una proprietà `metodo` che dice da quale porta
 * è entrata la persona: email, Google… Serve a una domanda sola, ma importante:
 * quale delle due porte funziona, e quindi dove conviene lavorare.
 *
 * Il percorso Google la valorizzava. Il modulo email e password no:
 * `trackSignedIn(data.user.id)`, senza secondo argomento, e la firma ripiegava
 * su 'sconosciuto'. Uno dei due canali era etichettato «sconosciuto», quindi il
 * confronto non si poteva fare — e ce ne si accorge sei mesi dopo, guardando
 * numeri già raccolti così.
 *
 * Due freni, non uno:
 *  ① questa prova, che guarda cosa esce davvero verso PostHog;
 *  ② `metodo` è diventato OBBLIGATORIO nella firma, quindi chi lo dimentica lo
 *    scopre da `npm run typecheck` invece che dai dati.
 */

const emessi: Array<{ evento: string; proprieta: Record<string, unknown> }> = [];

vi.mock('@/lib/analytics/posthog', () => ({
  track: async (evento: string, proprieta: Record<string, unknown> = {}) => {
    emessi.push({ evento, proprieta });
  },
}));
vi.mock('@/lib/consent', () => ({ readConsent: () => ({ analytics: true }) }));

import { trackSignedIn, trackSignupCompleted } from '@/lib/analytics/events';

beforeEach(() => {
  emessi.length = 0;
});

describe('la porta da cui e entrata una persona', () => {
  it('chi entra con email e password viaggia con il suo canale, non con «sconosciuto»', async () => {
    await trackSignedIn('u1', 'email');
    const evento = emessi.find((e) => e.evento === 'signed_in');
    expect(evento, 'l accesso non e stato nemmeno emesso').toBeTruthy();
    expect(
      evento?.proprieta.metodo,
      'il canale d ingresso resta «sconosciuto»: le due porte non si possono confrontare',
    ).toBe('email');
  });

  it('e chi entra con Google porta il suo', async () => {
    await trackSignedIn('u2', 'google');
    expect(emessi[0]?.proprieta.metodo).toBe('google');
  });

  it('non esiste piu nessun valore di ripiego che finga di sapere', async () => {
    // Prima bastava dimenticare un argomento per far nascere un dato falso.
    // Adesso il valore lo deve dire chi chiama: quello che arriva e' quello che
    // e' stato scritto, mai un ripiego inventato dalla firma.
    await trackSignedIn('u3', 'sconosciuto');
    expect(emessi[0]?.proprieta.metodo).toBe('sconosciuto');
    emessi.length = 0;
    await trackSignupCompleted('u4', 'buyer', 'email');
    expect(emessi[0]?.proprieta.metodo).toBe('email');
    expect(emessi[0]?.proprieta.$insert_id, 'chi si registra puo essere contato due volte').toBe('signup:u4');
  });
});
