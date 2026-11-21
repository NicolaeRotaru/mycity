/**
 * @vitest-environment jsdom
 *
 * La barra in alto: l'iscrizione push dell'apparecchio segue chi entra, anche quando prima non è
 * arrivata nessuna uscita (all'avvio solo una sessione vuota). Si monta la barra vera.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

const avvisi = vi.hoisted(() => ({ info: [] as Array<{ testo: string; opzioni?: { action?: { label?: string } } }> }));
vi.mock('sonner', () => {
  const toast = Object.assign(() => undefined, {
    success: () => undefined,
    error: () => undefined,
    info: (testo: string, opzioni?: { action?: { label?: string } }) => { avvisi.info.push({ testo, opzioni }); },
  });
  return { toast, Toaster: () => null };
});

type Globale = Record<string, unknown>;
const SEGNO = 'mc_notifiche_spente_all_uscita';

function apparecchio(diario: string[]) {
  let attiva = true;
  const iscrizione = {
    endpoint: 'https://push.test/apparecchio',
    unsubscribe: async () => { diario.push('spenta'); attiva = false; return true; },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => ({ pushManager: { getSubscription: async () => (attiva ? iscrizione : null) } }) },
  });
}

async function respira() {
  for (let i = 0; i < 12; i++) await attendi();
}
const ascolti = () => (globalThis as Globale).__ASCOLTI_AUTH__ as ((evento: string, sessione: unknown) => void)[];
const ANNA = { user: { id: 'anna' }, access_token: 'g1' };
const BRUNO = { user: { id: 'bruno' }, access_token: 'g2' };
const memoria = () => JSON.parse(window.localStorage.getItem(SEGNO) ?? '{}') as Record<string, unknown>;

async function caricamento() {
  (globalThis as Globale).__ASCOLTI_AUTH__ = [];
  const mod = await monta('components/Navbar.tsx');
  const s = accendi(mod.default, {});
  const evento = async (nome: string, sessione: unknown) => {
    s.agisci(() => ascolti().forEach((a) => a(nome, sessione)));
    await respira();
  };
  return { s, evento };
}

/** Ieri: Anna con la sessione e l'iscrizione attiva su questo apparecchio. */
async function ieriAnna() {
  const ieri = await caricamento();
  await ieri.evento('INITIAL_SESSION', ANNA);
  ieri.s.smonta();
}

describe('la barra: l\'iscrizione dell\'apparecchio segue chi entra', () => {
  beforeEach(() => {
    (globalThis as Globale).__PROFILO__ = { isAuthenticated: true, isBuyer: true, profile: { full_name: 'Prova' } };
    (globalThis as Globale).__UTENTE__ = { id: 'anna' };
    (globalThis as Globale).__RISPOSTA_SUPABASE__ = { data: [], error: null };
    (globalThis as Globale).Notification = { permission: 'granted' };
    avvisi.info = [];
    window.localStorage.clear();
  });
  afterEach(() => {
    document.body.innerHTML = '';
    for (const k of ['__PROFILO__', '__UTENTE__', '__ASCOLTI_AUTH__', '__RISPOSTA_SUPABASE__', 'Notification']) delete (globalThis as Globale)[k];
  });

  it('avvio con la sessione vuota, poi entra un altro account: si spegne, e il segno resta al primo', async () => {
    const diario: string[] = [];
    apparecchio(diario);
    await ieriAnna();

    const oggi = await caricamento();
    await oggi.evento('INITIAL_SESSION', null);
    expect(diario, 'senza nessuno che entra non si spegne').toEqual([]);

    await oggi.evento('SIGNED_IN', BRUNO);
    expect(diario, 'entrato un altro account, l\'iscrizione resta accesa').toEqual(['spenta']);
    expect(Object.keys(memoria()), 'il segno per il primo account').toEqual(['anna']);
    expect(avvisi.info, 'a chi entra non si dice niente').toEqual([]);

    await oggi.evento('SIGNED_OUT', null);
    await oggi.evento('SIGNED_IN', ANNA);
    expect(avvisi.info.length, 'al rientro del primo account non si dice niente').toBe(1);
    expect(avvisi.info[0].opzioni?.action?.label).toBe('Riattiva');
    oggi.s.smonta();
  }, 60000);

  it('avvio direttamente con un altro account: si spegne', async () => {
    const diario: string[] = [];
    apparecchio(diario);
    await ieriAnna();

    const oggi = await caricamento();
    await oggi.evento('INITIAL_SESSION', BRUNO);
    expect(diario).toEqual(['spenta']);
    expect(Object.keys(memoria())).toEqual(['anna']);
    oggi.s.smonta();
  }, 60000);

  it('a pagina aperta entra un altro account senza uscita prima: si spegne', async () => {
    const diario: string[] = [];
    apparecchio(diario);
    const s = await caricamento();
    await s.evento('INITIAL_SESSION', ANNA);
    await s.evento('SIGNED_IN', BRUNO);
    expect(diario).toEqual(['spenta']);
    s.s.smonta();
  }, 60000);

  it('controprova: rientra lo stesso account, non si spegne e non si dice niente', async () => {
    const diario: string[] = [];
    apparecchio(diario);
    await ieriAnna();

    const oggi = await caricamento();
    await oggi.evento('INITIAL_SESSION', null);
    await oggi.evento('SIGNED_IN', ANNA);
    expect(diario).toEqual([]);
    expect(avvisi.info).toEqual([]);
    expect((memoria()['@sessione'] as { id?: string } | undefined)?.id).toBe('anna');
    oggi.s.smonta();
  }, 60000);
});
