import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

/**
 * 28/11/2026 (onda 2, R05-010 / R05-011) — UNA CONTESTAZIONE CHE ARRIVA PRIMA DELL'ORDINE NON SI PERDE.
 *
 * Il carrello è pagato ma l'ordine non è ancora nato (l'avviso del pagamento non è passato, o è a metà).
 * Arriva la contestazione della banca: senza ordini, il gestore la lavorava come un buono regalo
 * (`gift_card_void_for_payment`, che se non trova il buono se lo annota, R05-011), cercava una
 * sponsorizzazione e usciva con una riga nel registro (R05-010). L'ordine nasceva dopo senza
 * `dispute_status` e il negozio veniva pagato con soldi che la banca si era già ripresa.
 *
 * Adesso, come per il rimborso (rimborsi.ts): carrello aperto (o completato in quel momento) → si lancia e
 * Stripe ripete; carrello chiuso senza ordine → avviso agli amministratori; nessun carrello → come prima.
 *
 * Se diventa rosso: la contestazione di un carrello aperto torna a uscire bene, o a passare dai buoni.
 */

const stato = vi.hoisted(() => ({
  rpc: [] as string[],
  avvisi: [] as Array<{ titolo: string; opzioni?: { unaVoltaPer?: string } }>,
  carrelli: {} as Record<string, string>,
  pagamenti: {} as Record<string, { metadata?: Record<string, string>; transfer_group?: string | null }>,
  stripeGiu: false,
  letti: [] as string[],
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    paymentIntents: {
      retrieve: async (id: string) => {
        if (stato.stripeGiu) throw new Error('Stripe non risponde');
        return { id, metadata: {}, transfer_group: null, ...(stato.pagamenti[id] ?? {}) };
      },
    },
    // La ricerca della sponsorizzazione del pagamento (sponsorizzati.ts): nessuna.
    checkout: { sessions: { list: async () => { stato.letti.push('stripe:checkout.sessions'); return { data: [] }; } } },
  }),
}));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  // Nessun ordine col pagamento contestato: è il caso di questa prova.
  findOrdersForDispute: async () => [],
  notifyAdmins: vi.fn(async (titolo: string, _testo: string, _link: string, opzioni?: { unaVoltaPer?: string }) => {
    stato.avvisi.push({ titolo, opzioni });
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async (nome: string) => {
      stato.rpc.push(nome);
      return { data: { esito: 'non_trovato' }, error: null };
    },
    from: (tabella: string) => {
      stato.letti.push(tabella);
      let id = '';
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = (_col: string, v: string) => ((id = v), c);
      c.maybeSingle = async () => {
        if (tabella === 'pending_checkouts') return { data: stato.carrelli[id] ? { status: stato.carrelli[id] } : null, error: null };
        return { data: null, error: null };
      };
      return c;
    },
  }),
}));

import { handleDisputeClosed, handleDisputeCreated } from '@/lib/stripe/webhook/dispute';

const contestazione = (status = 'needs_response') =>
  ({ id: 'dp_1', status, amount: 3100, payment_intent: 'pi_carrello', charge: 'ch_carrello' }) as unknown as Stripe.Dispute;

beforeEach(() => {
  stato.rpc = [];
  stato.avvisi = [];
  stato.carrelli = {};
  stato.pagamenti = {};
  stato.stripeGiu = false;
  stato.letti = [];
});

describe('R05-010 / R05-011 — la contestazione che arriva prima dell ordine', () => {
  it('carrello ancora aperto: si lancia (Stripe ripete) e non passa dai buoni né dalle sponsorizzazioni', async () => {
    stato.pagamenti.pi_carrello = { metadata: { pending_checkout_id: 'pc_1' } };
    stato.carrelli.pc_1 = 'PENDING';

    await expect(handleDisputeCreated(contestazione()), 'la contestazione di un carrello aperto esce bene: si perde').rejects.toThrow(/si riprova/);
    expect(stato.rpc, 'la contestazione di un carrello aperto è stata lavorata come un buono regalo').not.toContain('gift_card_void_for_payment');
    expect(stato.letti, 'la contestazione di un carrello aperto ha cercato una sponsorizzazione').not.toContain('stripe:checkout.sessions');
  });

  it('anche se il carrello si riconosce solo dal gruppo dei bonifici (mc_<carrello>)', async () => {
    stato.pagamenti.pi_carrello = { transfer_group: 'mc_pc_2' };
    stato.carrelli.pc_2 = 'PENDING';

    await expect(handleDisputeCreated(contestazione())).rejects.toThrow(/pc_2/);
    expect(stato.rpc).not.toContain('gift_card_void_for_payment');
  });

  it('carrello completato ma nessun ordine letto (nati in mezzo): si lancia', async () => {
    stato.pagamenti.pi_carrello = { metadata: { pending_checkout_id: 'pc_1' } };
    stato.carrelli.pc_1 = 'COMPLETED';

    await expect(handleDisputeCreated(contestazione())).rejects.toThrow(/si riprova/);
  });

  it('una richiesta di informazioni su un carrello aperto non diventa «forse un buono regalo»', async () => {
    stato.pagamenti.pi_carrello = { metadata: { pending_checkout_id: 'pc_1' } };
    stato.carrelli.pc_1 = 'PENDING';

    await expect(handleDisputeCreated(contestazione('warning_needs_response'))).rejects.toThrow(/si riprova/);
    expect(stato.avvisi.map((a) => a.titolo)).not.toContain('ℹ️ La banca chiede informazioni su un pagamento');
  });

  it('carrello scaduto, l ordine non nascerà: gli amministratori lo sanno (una volta), e non passa dai buoni', async () => {
    stato.pagamenti.pi_carrello = { metadata: { pending_checkout_id: 'pc_1' } };
    stato.carrelli.pc_1 = 'EXPIRED';

    await handleDisputeCreated(contestazione());

    expect(stato.avvisi).toEqual([
      { titolo: '⚠️ Contestazione su un pagamento senza ordine', opzioni: { unaVoltaPer: 'contestazione-senza-ordine:dp_1:apertura' } },
    ]);
    expect(stato.rpc).not.toContain('gift_card_void_for_payment');
  });

  it('Stripe non risponde mentre si cerca il carrello: si lancia, non si tira a indovinare', async () => {
    stato.stripeGiu = true;

    await expect(handleDisputeCreated(contestazione())).rejects.toThrow('Stripe non risponde');
    expect(stato.rpc).not.toContain('gift_card_void_for_payment');
  });

  it('un pagamento che non è di un carrello (buono regalo) si lavora come prima', async () => {
    await handleDisputeCreated(contestazione());

    expect(stato.rpc).toContain('gift_card_void_for_payment');
  });

  it('alla chiusura: un carrello ancora aperto si lancia, invece di cercare un buono da riattivare', async () => {
    stato.pagamenti.pi_carrello = { metadata: { pending_checkout_id: 'pc_1' } };
    stato.carrelli.pc_1 = 'PENDING';

    await expect(handleDisputeClosed(contestazione('won'))).rejects.toThrow(/si riprova/);
    expect(stato.letti).not.toContain('gift_cards');
  });
});
