/**
 * @vitest-environment jsdom
 *
 * R19-008 (13/11/2026) — QUANDO LA SESSIONE FINISCE DA SOLA, LE NOTIFICHE NON SI
 * SPENGONO IN SILENZIO.
 *
 * La barra in alto spegne l'iscrizione push di questo apparecchio a ogni fine della
 * sessione (difesa degli avvisi di Anna sullo schermo di Bruno: resta). Ma la
 * sessione finisce anche da sola, e allora nessuno ha premuto «Esci»: il permesso del
 * browser resta «concesso» e al rientro niente diceva che le notifiche non c'erano
 * più. Qui si monta la barra vera, si fa finire la sessione con l'iscrizione accesa,
 * poi si rientra: lo si deve dire, una volta, con la strada per riattivarle. Non si
 * riaccendono da sole: chi rientra può essere un'altra persona.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

const avvisi = vi.hoisted(() => ({ info: [] as Array<{ testo: string; opzioni?: { action?: { label?: string; onClick?: () => void } } }> }));
vi.mock('sonner', () => {
  const toast = Object.assign(() => undefined, {
    success: () => undefined,
    error: () => undefined,
    info: (testo: string, opzioni?: { action?: { label?: string; onClick?: () => void } }) => {
      avvisi.info.push({ testo, opzioni });
    },
  });
  return { toast, Toaster: () => null };
});

type Globale = Record<string, unknown>;
type Diario = string[];

/** L'apparecchio: un'iscrizione che si può spegnere, e che dopo non c'è più. */
function apparecchio(diario: Diario, iscritto: boolean) {
  let attiva = iscritto;
  const iscrizione = {
    endpoint: 'https://push.test/telefono-di-anna',
    unsubscribe: async () => {
      diario.push('spenta');
      attiva = false;
      return true;
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: async () => ({ pushManager: { getSubscription: async () => (attiva ? iscrizione : null) } }),
    },
  });
}

function permesso(valore: NotificationPermission) {
  (globalThis as Globale).Notification = { permission: valore };
}

async function respira() {
  for (let i = 0; i < 12; i++) await attendi();
}

function ascolti() {
  return (globalThis as Globale).__ASCOLTI_AUTH__ as ((evento: string, sessione: unknown) => void)[];
}

const SESSIONE = { user: { id: 'anna' }, access_token: 'gettone' };

describe('R19-008 · le notifiche spente alla fine della sessione si dicono al rientro', () => {
  beforeEach(() => {
    (globalThis as Globale).__PROFILO__ = { isAuthenticated: true, isBuyer: true, profile: { full_name: 'Anna Rossi' } };
    (globalThis as Globale).__UTENTE__ = { id: 'anna' };
    (globalThis as Globale).__ASCOLTI_AUTH__ = [];
    (globalThis as Globale).__RISPOSTA_SUPABASE__ = { data: [], error: null };
    avvisi.info = [];
    window.localStorage.clear();
  });
  afterEach(() => {
    document.body.innerHTML = '';
    delete (globalThis as Globale).__PROFILO__;
    delete (globalThis as Globale).__UTENTE__;
    delete (globalThis as Globale).__ASCOLTI_AUTH__;
    delete (globalThis as Globale).__RISPOSTA_SUPABASE__;
    delete (globalThis as Globale).Notification;
  });

  it('la sessione cade da sola con le notifiche accese: al rientro lo si dice, una volta sola', async () => {
    const diario: Diario = [];
    apparecchio(diario, true);
    permesso('granted');
    const mod = await monta('components/Navbar.tsx');
    const s = accendi(mod.default, {});

    s.agisci(() => ascolti().forEach((a) => a('SIGNED_OUT', null)));
    await respira();
    expect(diario, 'la difesa resta: a fine sessione l\'iscrizione di questo apparecchio si spegne').toEqual(['spenta']);
    expect(avvisi.info, 'mentre si è fuori non c\'è nessuno a cui dirlo').toEqual([]);

    s.agisci(() => ascolti().forEach((a) => a('SIGNED_IN', SESSIONE)));
    await respira();
    expect(
      avvisi.info.length,
      'al rientro nessuno dice che le notifiche si sono spente: il permesso resta «concesso» e la persona crede di averle',
    ).toBe(1);
    expect(avvisi.info[0].testo).toMatch(/notifiche/i);
    expect(avvisi.info[0].opzioni?.action?.label, 'serve la strada per riattivarle').toBe('Riattiva');
    expect(diario, 'non si riaccendono da sole: chi rientra può essere un\'altra persona').toEqual(['spenta']);

    s.agisci(() => ascolti().forEach((a) => a('SIGNED_IN', SESSIONE)));
    await respira();
    expect(avvisi.info.length, 'l\'avviso si dà una volta sola').toBe(1);
    s.smonta();
  }, 60000);

  it('anche quando si rientra da un altro accesso (Google): la sessione arriva al caricamento', async () => {
    apparecchio([], true);
    permesso('granted');
    const mod = await monta('components/Navbar.tsx');
    const s = accendi(mod.default, {});
    s.agisci(() => ascolti().forEach((a) => a('SIGNED_OUT', null)));
    await respira();
    s.agisci(() => ascolti().forEach((a) => a('INITIAL_SESSION', SESSIONE)));
    await respira();
    expect(avvisi.info.length).toBe(1);
    s.smonta();
  }, 60000);

  it('se all\'uscita non c\'era niente da spegnere, al rientro non si dice niente', async () => {
    apparecchio([], false);
    permesso('granted');
    const mod = await monta('components/Navbar.tsx');
    const s = accendi(mod.default, {});
    s.agisci(() => ascolti().forEach((a) => a('SIGNED_OUT', null)));
    await respira();
    s.agisci(() => ascolti().forEach((a) => a('SIGNED_IN', SESSIONE)));
    await respira();
    expect(avvisi.info).toEqual([]);
    s.smonta();
  }, 60000);

  it('se il permesso del browser non è più concesso, la persona lo sa già: niente avviso', async () => {
    apparecchio([], true);
    permesso('granted');
    const mod = await monta('components/Navbar.tsx');
    const s = accendi(mod.default, {});
    s.agisci(() => ascolti().forEach((a) => a('SIGNED_OUT', null)));
    await respira();
    permesso('default');
    s.agisci(() => ascolti().forEach((a) => a('SIGNED_IN', SESSIONE)));
    await respira();
    expect(avvisi.info).toEqual([]);
    s.smonta();
  }, 60000);
});
