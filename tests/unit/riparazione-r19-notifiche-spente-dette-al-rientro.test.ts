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
import { createElement, useState, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
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

/**
 * Giro di correzione: come fa Supabase, all'ascolto arriva subito la sessione di chi c'è
 * (INITIAL_SESSION). È da lì che la barra sa di chi sono le notifiche che si spengono dopo.
 */
function cEAnna(s: { agisci: (f: () => void) => void }) {
  s.agisci(() => ascolti().forEach((a) => a('INITIAL_SESSION', SESSIONE)));
}

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
    cEAnna(s);
    await respira();

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
    cEAnna(s);
    await respira();
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
    cEAnna(s);
    await respira();
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
    cEAnna(s);
    await respira();
    s.agisci(() => ascolti().forEach((a) => a('SIGNED_OUT', null)));
    await respira();
    permesso('default');
    s.agisci(() => ascolti().forEach((a) => a('SIGNED_IN', SESSIONE)));
    await respira();
    expect(avvisi.info).toEqual([]);
    s.smonta();
  }, 60000);

  /**
   * Giro di correzione (13/11), punto (1): il segno era dell'apparecchio. Se dopo la sessione
   * caduta di Anna entrava Bruno, l'avviso andava a lui e Anna non lo sapeva più.
   */
  it('a Bruno, che entra dopo sullo stesso apparecchio, non si dice niente; ad Anna, quando rientra, sì', async () => {
    apparecchio([], true);
    permesso('granted');
    const mod = await monta('components/Navbar.tsx');
    const s = accendi(mod.default, {});
    cEAnna(s);
    await respira();
    s.agisci(() => ascolti().forEach((a) => a('SIGNED_OUT', null)));
    await respira();

    s.agisci(() => ascolti().forEach((a) => a('SIGNED_IN', { user: { id: 'bruno' }, access_token: 'altro' })));
    await respira();
    expect(avvisi.info, 'l\'avviso delle notifiche di Anna va a Bruno').toEqual([]);
    s.agisci(() => ascolti().forEach((a) => a('SIGNED_OUT', null)));
    await respira();

    s.agisci(() => ascolti().forEach((a) => a('SIGNED_IN', SESSIONE)));
    await respira();
    expect(avvisi.info.length, 'il segno di Anna si è perso col passaggio di Bruno').toBe(1);
    expect(avvisi.info[0].opzioni?.action?.label).toBe('Riattiva');
    s.smonta();
  }, 60000);

  it('il segno di Anna resta finché non scade: dopo trenta giorni non si dice più', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
      apparecchio([], true);
      permesso('granted');
      const mod = await monta('components/Navbar.tsx');
      const s = accendi(mod.default, {});
      cEAnna(s);
      await respira();
      s.agisci(() => ascolti().forEach((a) => a('SIGNED_OUT', null)));
      await respira();
      expect(window.localStorage.getItem('mc_notifiche_spente_all_uscita'), 'il segno non c\'è').not.toBeNull();

      vi.setSystemTime(new Date('2026-12-14T10:00:00Z'));
      s.agisci(() => ascolti().forEach((a) => a('SIGNED_IN', SESSIONE)));
      await respira();
      expect(avvisi.info, 'un segno di un mese fa non è più una notizia').toEqual([]);
      expect(window.localStorage.getItem('mc_notifiche_spente_all_uscita'), 'il segno scaduto resta nel browser').toBeNull();
      s.smonta();
    } finally {
      vi.useRealTimers();
    }
  }, 60000);
});

describe('R19-008 · il segno con l\'identificativo è dichiarato nella Cookie policy', () => {
  it('mc_notifiche_spente_all_uscita sta fra gli strumenti necessari, con la sua durata', async () => {
    const { readFileSync } = await import('node:fs');
    const policy = readFileSync('app/cookies/page.tsx', 'utf8');
    const necessari = policy.slice(0, policy.indexOf('2.2 Cookie funzionali'));
    const riga = necessari.split('\n').find((r) => r.includes("name: 'mc_notifiche_spente_all_uscita'"));
    expect(riga, 'il segno porta l\'identificativo dell\'account ma la policy non lo dichiara').toBeTruthy();
    expect(riga).toMatch(/duration: '30 giorni'/);
  });
});

/**
 * Giro di correzione (13/11), punto (2): «Riattiva» porta a /profile/settings?tab=notifications,
 * ma la pagina leggeva `?tab=` solo al montaggio. Qui la pagina vera resta montata, l'indirizzo
 * cambia e la pagina si ridisegna (come fa il router di Next dopo `push`): la scheda deve aprirsi.
 */
describe('R19-008 · «Riattiva» apre la scheda Notifiche anche a impostazioni già aperte', () => {
  const g = globalThis as Globale;
  const fetchDiPartenza = globalThis.fetch;
  beforeEach(() => {
    g.__UTENTE__ = { id: 'anna', email: 'anna@prova.it' };
    g.__RISPOSTA_SUPABASE__ = {
      data: [{ notif_order_updates: true, notif_promos: false, notif_groups: true, notif_newsletter: false, email_marketing: false }],
      error: null,
    };
    window.history.replaceState(null, '', '/profile/settings');
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ pending: false }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  });
  afterEach(() => {
    document.body.innerHTML = '';
    globalThis.fetch = fetchDiPartenza;
    delete g.__UTENTE__;
    delete g.__RISPOSTA_SUPABASE__;
    delete g.__RIDISEGNA__;
  });

  it('da «Account» a ?tab=notifications senza ricaricare: si apre «Notifiche»', async () => {
    const Impostazioni = (await monta('app/profile/settings/page.tsx')).default as ComponentType<Record<string, unknown>>;
    // Il contenitore fa quello che fa il router: a indirizzo cambiato, ridisegna la pagina (senza rimontarla).
    function ComeIlRouter() {
      const [giro, setGiro] = useState(0);
      g.__RIDISEGNA__ = () => setGiro((n) => n + 1);
      return createElement(Impostazioni, { giro });
    }
    const s = accendi(ComeIlRouter, {});
    await respira();
    const schedaAperta = () => testoVisibile(s.radice.querySelector('nav button.font-bold')).trim();
    expect(schedaAperta(), 'la pagina non è arrivata in fondo al caricamento').toBe('Account');

    // Quello che fa router.push('/profile/settings?tab=notifications'): l'indirizzo cambia, la pagina si ridisegna.
    window.history.replaceState(null, '', '/profile/settings?tab=notifications');
    s.agisci(() => (g.__RIDISEGNA__ as () => void)());
    await respira();
    expect(schedaAperta(), '«Riattiva» porta a ?tab=notifications ma la scheda resta quella di prima').toBe('Notifiche');

    // Un ridisegno qualsiasi con lo stesso indirizzo non riporta indietro la scheda scelta a mano.
    const privacy = [...s.radice.querySelectorAll('nav button')].find((b) => testoVisibile(b).trim() === 'Privacy e dati')!;
    s.agisci(() => (privacy as HTMLButtonElement).click());
    s.agisci(() => (g.__RIDISEGNA__ as () => void)());
    await respira();
    expect(schedaAperta()).toBe('Privacy e dati');
    s.smonta();
    window.history.replaceState(null, '', '/');
  }, 60000);
});
