/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  scollegaPushDaQuestoDispositivo,
  notificheAttiveQui,
  attivaPushSuQuestoDispositivo,
} from '@/lib/push/dispositivo';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca, attendi } from './aiuti/schermo';

/**
 * GLI AVVISI DI ANNA SULLO SCHERMO DI BRUNO.
 *
 * Il permesso di mandare notifiche lo dà il browser e resta attaccato
 * all'apparecchio; la riga che dice a chi appartiene sta nel database ed è di
 * una persona sola. Finché nessuno le stacca, le due cose si dividono al primo
 * cambio di account sullo stesso apparecchio:
 *
 *   mercoledì Anna accende le notifiche sul tablet di casa ed esce;
 *   giovedì entra Bruno, sullo stesso tablet;
 *   il tablet è ancora iscritto come Anna, quindi «Il tuo ordine è in consegna»
 *   di Anna compare mentre lo usa Bruno — e a Bruno non arriva niente, anche se
 *   in impostazioni legge «Notifiche attive».
 *
 * Succede sul tablet di famiglia, sul computer del negozio usato dal titolare e
 * dal commesso, su un telefono prestato.
 *
 * Qui si prova il comportamento, non le parole: le funzioni girano davvero, e
 * la barra in alto viene montata e cliccata come la clicca una persona.
 */

type Diario = string[];

function iscrizioneFinta(endpoint: string, diario: Diario) {
  return {
    endpoint,
    unsubscribe: async () => {
      diario.push(`spenta:${endpoint}`);
      return true;
    },
  };
}

describe('uscire dall\'account stacca le notifiche di questo apparecchio', () => {
  it('cancella la riga e poi spegne l\'iscrizione del browser, in quest\'ordine', async () => {
    const diario: Diario = [];
    const iscrizione = iscrizioneFinta('https://push.test/tablet', diario);

    const esito = await scollegaPushDaQuestoDispositivo({
      gestore: { getSubscription: async () => iscrizione },
      cancellaRiga: async (endpoint) => {
        diario.push(`riga-cancellata:${endpoint}`);
        return { error: null };
      },
    });

    expect(
      diario,
      'La riga va cancellata PRIMA di uscire (dopo la sessione non c\'è più e il database non lascia cancellare niente), e subito dopo va spenta l\'iscrizione del browser',
    ).toEqual(['riga-cancellata:https://push.test/tablet', 'spenta:https://push.test/tablet']);
    expect(esito).toEqual({ cera: true, disiscritto: true, rigaCancellata: true });
  });

  it('se la riga non si cancella, l\'apparecchio si stacca lo stesso', async () => {
    const diario: Diario = [];
    const iscrizione = iscrizioneFinta('https://push.test/tablet', diario);

    const esito = await scollegaPushDaQuestoDispositivo({
      gestore: { getSubscription: async () => iscrizione },
      cancellaRiga: async () => {
        throw new Error('rete caduta');
      },
    });

    expect(
      diario,
      'È l\'iscrizione del browser che consegna gli avvisi di una persona allo schermo di un\'altra: si spegne anche quando il database non risponde',
    ).toEqual(['spenta:https://push.test/tablet']);
    expect(esito).toEqual({ cera: true, disiscritto: true, rigaCancellata: false });
  });

  it('il database che rifiuta la cancellazione non passa per riuscito', async () => {
    const diario: Diario = [];
    const iscrizione = iscrizioneFinta('https://push.test/tablet', diario);

    const esito = await scollegaPushDaQuestoDispositivo({
      gestore: { getSubscription: async () => iscrizione },
      cancellaRiga: async () => ({ error: { code: '42501', message: 'row-level security' } }),
    });

    expect(esito.rigaCancellata).toBe(false);
    expect(esito.disiscritto).toBe(true);
  });

  it('se il servizio di notifiche non risponde, l\'uscita non resta appesa', async () => {
    // Spegnere un'iscrizione vuol dire parlare col servizio del browser: su una
    // rete lenta può non rispondere. Chi ha premuto «Esci» deve uscire lo stesso.
    const partito = Date.now();
    const esito = await scollegaPushDaQuestoDispositivo({
      gestore: { getSubscription: () => new Promise(() => { /* non risponde mai */ }) },
      attesaMassima: 30,
    });
    expect(esito).toEqual({ cera: false, disiscritto: false, rigaCancellata: false });
    expect(Date.now() - partito, 'L\'uscita è rimasta appesa ad aspettare il servizio di notifiche').toBeLessThan(2000);
  });

  it('non c\'è niente da staccare se questo apparecchio non era iscritto', async () => {
    const esito = await scollegaPushDaQuestoDispositivo({
      gestore: { getSubscription: async () => null },
      cancellaRiga: async () => {
        throw new Error('non deve essere chiamata');
      },
    });
    expect(esito).toEqual({ cera: false, disiscritto: false, rigaCancellata: false });
  });
});

describe('«Notifiche attive» si scrive solo a chi le ha davvero', () => {
  it('non basta che il browser abbia un\'iscrizione: dev\'essere la mia', () => {
    // Il tablet è ancora iscritto come Anna: il browser risponde di sì, ma la
    // riga di quell'indirizzo non è fra quelle di Bruno.
    expect(
      notificheAttiveQui({
        endpointDelBrowser: 'https://push.test/tablet-di-anna',
        endpointMiei: [],
      }),
      'Bruno leggeva «Notifiche attive» e non avrebbe ricevuto mai niente',
    ).toBe(false);
  });

  it('è attiva quando la riga di questo indirizzo è mia', () => {
    expect(
      notificheAttiveQui({
        endpointDelBrowser: 'https://push.test/telefono-di-bruno',
        endpointMiei: ['https://push.test/telefono-di-bruno'],
      }),
    ).toBe(true);
  });

  it('senza iscrizione nel browser non è attiva', () => {
    expect(notificheAttiveQui({ endpointDelBrowser: null, endpointMiei: ['https://push.test/x'] })).toBe(false);
  });
});

describe('attivare le notifiche su un apparecchio già usato da un altro', () => {
  it('butta l\'indirizzo del primo e ne prende uno nuovo, invece di arrendersi', async () => {
    const diario: Diario = [];
    let contatore = 0;
    const salvati: string[] = [];

    const esito = await attivaPushSuQuestoDispositivo({
      creaIscrizione: async () => {
        contatore += 1;
        return iscrizioneFinta(contatore === 1 ? 'https://push.test/di-anna' : 'https://push.test/nuovo', diario);
      },
      salva: async (iscrizione) => {
        salvati.push(iscrizione.endpoint);
        // Il primo indirizzo è intestato ad Anna: i permessi per riga lo rifiutano.
        return iscrizione.endpoint === 'https://push.test/di-anna'
          ? { error: { code: '42501', message: 'new row violates row-level security policy' } }
          : { error: null };
      },
    });

    expect(esito.salvata, 'Bruno non riusciva ad attivare le notifiche sul tablet e nessuno glielo diceva').toBe(true);
    expect(salvati).toEqual(['https://push.test/di-anna', 'https://push.test/nuovo']);
    expect(
      diario,
      'L\'iscrizione di chi c\'era prima va spenta: altrimenti continua a consegnargli gli avvisi su questo apparecchio',
    ).toContain('spenta:https://push.test/di-anna');
  });

  it('se non si riesce a salvare, non si scrive che è attiva', async () => {
    const diario: Diario = [];
    const esito = await attivaPushSuQuestoDispositivo({
      creaIscrizione: async () => iscrizioneFinta('https://push.test/x', diario),
      salva: async () => ({ error: { message: 'database irraggiungibile' } }),
    });
    expect(esito.salvata).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// La barra in alto, montata e cliccata davvero.

type Globale = Record<string, unknown>;

function apparecchioIscritto(diario: Diario, endpoint = 'https://push.test/tablet-di-casa') {
  const iscrizione = iscrizioneFinta(endpoint, diario);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: async () => ({ pushManager: { getSubscription: async () => iscrizione } }),
    },
  });
  (globalThis as Globale).__RISPOSTA_SUPABASE__ = ({ tavola }: { tavola: string }) => {
    if (tavola === 'push_subscriptions') diario.push('riga-cancellata');
    return { data: [], error: null };
  };
  return iscrizione;
}

/** Lascia finire le promesse che partono da un clic. */
async function respira() {
  for (let i = 0; i < 12; i++) await attendi();
}

describe('la barra in alto, quando esci dall\'account', () => {
  beforeEach(() => {
    (globalThis as Globale).__PROFILO__ = { isAuthenticated: true, isBuyer: true, profile: { full_name: 'Anna Rossi' } };
    (globalThis as Globale).__UTENTE__ = { id: 'anna' };
    (globalThis as Globale).__DATI_QUERY__ = undefined;
    (globalThis as Globale).__ASCOLTI_AUTH__ = [];
  });
  afterEach(() => {
    document.body.innerHTML = '';
    delete (globalThis as Globale).__PROFILO__;
    delete (globalThis as Globale).__UTENTE__;
    delete (globalThis as Globale).__RISPOSTA_SUPABASE__;
    delete (globalThis as Globale).__ASCOLTI_AUTH__;
  });

  it('il pulsante «Esci» stacca le notifiche di questo apparecchio', async () => {
    const diario: Diario = [];
    apparecchioIscritto(diario);

    const mod = await monta('components/Navbar.tsx');
    const s = accendi(mod.default, {});

    const menu = Array.from(s.radice.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Menu account',
    );
    expect(menu, 'Nella barra non c\'è più il menu dell\'account: la prova non guarda niente').toBeTruthy();
    s.agisci(() => clicca(menu!));

    const esci = Array.from(s.radice.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Esci',
    );
    expect(esci, 'Nel menu dell\'account non c\'è più «Esci»').toBeTruthy();
    s.agisci(() => clicca(esci!));
    await respira();

    expect(
      diario,
      'Uscendo dall\'account il tablet resta iscritto: gli avvisi degli ordini di chi è uscito arrivano a chi entra dopo',
    ).toEqual(['riga-cancellata', 'spenta:https://push.test/tablet-di-casa']);
    s.smonta();
  }, 60000);

  it('vale per ogni uscita, non solo per il pulsante di qui', async () => {
    const diario: Diario = [];
    apparecchioIscritto(diario, 'https://push.test/computer-del-negozio');

    const mod = await monta('components/Navbar.tsx');
    const s = accendi(mod.default, {});

    const ascolti = (globalThis as Globale).__ASCOLTI_AUTH__ as ((evento: string, sessione: unknown) => void)[];
    expect(
      ascolti.length,
      'La barra non ascolta i cambi di sessione: le uscite dalla barra in fondo, dalla colonna dell\'account e le sessioni scadute passano inosservate',
    ).toBeGreaterThan(0);

    s.agisci(() => ascolti.forEach((a) => a('SIGNED_OUT', null)));
    await respira();

    expect(
      diario,
      'Il commesso esce dal computer del negozio da un altro pulsante e l\'apparecchio resta iscritto a lui',
    ).toContain('spenta:https://push.test/computer-del-negozio');
    s.smonta();
  }, 60000);
});
