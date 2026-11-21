/**
 * @vitest-environment jsdom
 *
 * R01-017 — QUANDO LA SESSIONE SCADE DA SOLA A TELEFONO CHIUSO, LE NOTIFICHE NON SI PERDONO IN
 * SILENZIO.
 *
 * Il caso vero: il telefono si riapre il giorno dopo, Supabase prova a rinnovare la sessione, non
 * ci riesce e manda SIGNED_OUT prima ancora di dire di chi era la sessione (INITIAL_SESSION arriva
 * dopo, vuota). La barra spegneva l'iscrizione push di questo apparecchio senza sapere di chi
 * fosse, e quindi senza lasciare il segno: al nuovo accesso nessuno diceva che le notifiche non
 * c'erano più, e nessuno le riaccendeva. Qui si monta la barra vera due volte, come due
 * caricamenti della pagina.
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

/** L'apparecchio: un'iscrizione push che si può spegnere, e che dopo non c'è più. */
function apparecchio(diario: string[], iscritto: boolean) {
  let attiva = iscritto;
  const iscrizione = {
    endpoint: 'https://push.test/telefono-di-anna',
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
const ANNA = { user: { id: 'anna' }, access_token: 'gettone' };
const BRUNO = { user: { id: 'bruno' }, access_token: 'altro' };

/** Un caricamento della pagina: la barra si monta da capo, senza ricordi in memoria. */
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

describe('la sessione scade a telefono chiuso: al nuovo accesso lo si dice', () => {
  beforeEach(() => {
    (globalThis as Globale).__PROFILO__ = { isAuthenticated: true, isBuyer: true, profile: { full_name: 'Anna Rossi' } };
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

  it('SIGNED_OUT al caricamento, prima della sessione: l\'iscrizione si spegne e al nuovo accesso di Anna lo si dice', async () => {
    const diario: string[] = [];
    apparecchio(diario, true);
    // Ieri: Anna ha la sessione e le notifiche su questo telefono.
    const ieri = await caricamento();
    await ieri.evento('INITIAL_SESSION', ANNA);
    ieri.s.smonta();

    // Oggi: il rinnovo non riesce, SIGNED_OUT arriva prima di tutto, poi la sessione vuota.
    const oggi = await caricamento();
    await oggi.evento('SIGNED_OUT', null);
    await oggi.evento('INITIAL_SESSION', null);
    expect(diario, 'la difesa resta: a fine sessione l\'iscrizione si spegne').toEqual(['spenta']);
    expect(avvisi.info, 'mentre si è fuori non c\'è nessuno a cui dirlo').toEqual([]);

    await oggi.evento('SIGNED_IN', ANNA);
    expect(avvisi.info.length, 'al nuovo accesso nessuno dice che le notifiche si sono spente').toBe(1);
    expect(avvisi.info[0].testo).toMatch(/notifiche/i);
    expect(avvisi.info[0].opzioni?.action?.label, 'serve la strada per riattivarle').toBe('Riattiva');
    oggi.s.smonta();
  }, 60000);

  it('a Bruno, che entra dopo sullo stesso telefono, non si dice niente; ad Anna sì', async () => {
    apparecchio([], true);
    const ieri = await caricamento();
    await ieri.evento('INITIAL_SESSION', ANNA);
    ieri.s.smonta();

    const oggi = await caricamento();
    await oggi.evento('SIGNED_OUT', null);
    await oggi.evento('INITIAL_SESSION', null);
    await oggi.evento('SIGNED_IN', BRUNO);
    expect(avvisi.info, 'l\'avviso delle notifiche di Anna va a Bruno').toEqual([]);
    await oggi.evento('SIGNED_OUT', null);
    await oggi.evento('SIGNED_IN', ANNA);
    expect(avvisi.info.length, 'il segno di Anna si è perso').toBe(1);
    oggi.s.smonta();
  }, 60000);

  it('controprova: senza notifiche su questo telefono non si ricorda nessuno, e al nuovo accesso non si dice niente', async () => {
    apparecchio([], false);
    const ieri = await caricamento();
    await ieri.evento('INITIAL_SESSION', ANNA);
    expect(window.localStorage.getItem('mc_notifiche_spente_all_uscita'), 'senza notifiche da perdere non si tiene niente').toBeNull();
    ieri.s.smonta();

    const oggi = await caricamento();
    await oggi.evento('SIGNED_OUT', null);
    await oggi.evento('SIGNED_IN', ANNA);
    expect(avvisi.info).toEqual([]);
    oggi.s.smonta();
  }, 60000);

  it('dopo la fine della sessione non resta scritto di chi era la sessione, solo il segno da dire', async () => {
    apparecchio([], true);
    const ieri = await caricamento();
    await ieri.evento('INITIAL_SESSION', ANNA);
    ieri.s.smonta();
    const oggi = await caricamento();
    await oggi.evento('SIGNED_OUT', null);
    const memoria = JSON.parse(window.localStorage.getItem('mc_notifiche_spente_all_uscita') ?? '{}') as Record<string, unknown>;
    expect(Object.keys(memoria)).toEqual(['anna']);
    await oggi.evento('SIGNED_IN', ANNA);
    expect(window.localStorage.getItem('mc_notifiche_spente_all_uscita'), 'detto l\'avviso, il segno se ne va').toBeNull();
    oggi.s.smonta();
  }, 60000);
});
