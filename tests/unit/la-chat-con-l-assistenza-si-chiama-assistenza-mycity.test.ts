import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * LA CHAT CON L'ASSISTENZA SI CHIAMAVA «UTENTE».
 *
 * 25/10/2026 (scheda 1360) — La conversazione con l'Assistenza ha come seller_id
 * il primo account amministratore. Quell'account non è un negozio: non sta nella
 * vetrina pubblica, e il suo profilo un cliente non lo legge. `nomeDellaControparte`
 * ripiegava quindi su «Utente», e la testata aggiungeva «Negozio».
 *
 * Esempio: un cliente scrive all'Assistenza dal pulsante tondo, poi apre /messages
 * e vede la riga «Utente». Entrando, legge «Utente · Negozio». Non capisce che è
 * l'Assistenza di MyCity, cioè proprio chi stava cercando.
 *
 * Adesso la pagina chiede a GET /api/support/conversation chi fa da Assistenza e
 * la riconosce dal seller_id. Qui si prova la logica e la rotta; cosa esce a video
 * lo prova `la-chat-con-l-assistenza-a-video.test.ts`.
 */

type Chiamata = { tabella: string; metodo: string; argomenti: unknown[] };
type Stato = {
  utente: { id: string };
  admin: { data: { id: string } | null; error: { message: string } | null };
  conversazioneConLAssistenza: { data: { id: string } | null; error: { message: string } | null };
  chiamate: Chiamata[];
  chiaviDelFreno: string[];
  frenoChiuso: boolean;
  avvisi: unknown[][];
  avvolte: number;
};

// `vi.hoisted`: la rotta si importa prima di tutto, e il suo `withAuth` finto conta già.
const stato = vi.hoisted((): Stato => ({
  utente: { id: 'cliente' },
  admin: { data: { id: 'adm' }, error: null },
  conversazioneConLAssistenza: { data: { id: 'conv-1' }, error: null },
  chiamate: [],
  chiaviDelFreno: [],
  frenoChiuso: false,
  avvisi: [],
  avvolte: 0,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuth: (handler: (ctx: { user: { id: string }; req: Request }) => unknown) => {
    stato.avvolte++;
    return (req: Request) => handler({ user: stato.utente, req });
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async ({ key }: { key: string }) => {
    stato.chiaviDelFreno.push(key);
    return stato.frenoChiuso
      ? { allowed: false, remaining: 0, retryAfterSec: 42, limit: 30 }
      : { allowed: true, remaining: 29, retryAfterSec: 0, limit: 30 };
  },
  getClientIp: () => '10.0.0.1',
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      const annota = (metodo: string, argomenti: unknown[]) => stato.chiamate.push({ tabella, metodo, argomenti });
      const catena: Record<string, unknown> = {};
      for (const metodo of ['select', 'eq', 'order', 'limit']) {
        catena[metodo] = (...argomenti: unknown[]) => { annota(metodo, argomenti); return catena; };
      }
      catena.maybeSingle = async () => {
        annota('maybeSingle', []);
        if (tabella === 'profiles') return stato.admin;
        if (tabella === 'conversations') return stato.conversazioneConLAssistenza;
        return { data: null, error: null };
      };
      catena.insert = (...argomenti: unknown[]) => {
        annota('insert', argomenti);
        return {
          select: () => ({ single: async () => ({ data: { id: 'conv-nuova' }, error: null }) }),
          then: (risolvi: (v: { error: null }) => void) => risolvi({ error: null }),
        };
      };
      return catena;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: (...a: unknown[]) => { stato.avvisi.push(a); }, error: () => {}, info: () => {} } }));

import {
  NOME_ASSISTENZA,
  NOME_IN_ARRIVO,
  TETTO_ATTESA_MS,
  conversazioneConLAssistenza,
  leggiIdAssistenza,
  nomeDellaControparte,
  nomeInArrivo,
  serveSapereChiEAssistenza,
  validitaIdAssistenza,
} from '@/lib/queries/controparte-della-chat';
import { GET, POST } from '@/app/api/support/conversation/route';

const conAssistenza = { buyer_id: 'cliente', seller_id: 'adm', buyer: null, seller: null, insegna: null };

function chiamateSu(tabella: string, metodo: string) {
  return stato.chiamate.filter((c) => c.tabella === tabella && c.metodo === metodo).map((c) => c.argomenti);
}

function chiediChiEAssistenza() {
  return GET(new Request('http://localhost/api/support/conversation') as never);
}

beforeEach(() => {
  stato.utente = { id: 'cliente' };
  stato.admin = { data: { id: 'adm' }, error: null };
  stato.conversazioneConLAssistenza = { data: { id: 'conv-1' }, error: null };
  stato.chiamate = [];
  stato.chiaviDelFreno = [];
  stato.frenoChiuso = false;
  stato.avvisi = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('come il cliente vede la chat con l\'Assistenza', () => {
  it('IL CASO CHE ROMPEVA — il cliente vede «Assistenza MyCity», non «Utente»', () => {
    expect(nomeDellaControparte(conAssistenza, 'cliente', 'adm')).toBe('Assistenza MyCity');
    expect(NOME_ASSISTENZA).toBe('Assistenza MyCity');
    expect(conversazioneConLAssistenza(conAssistenza, 'cliente', 'adm')).toBe(true);
  });

  it('mentre si chiede chi è l\'Assistenza, al posto di «Utente» si legge l\'attesa', () => {
    expect(nomeDellaControparte(conAssistenza, 'cliente', null, true)).toBe(NOME_IN_ARRIVO);
  });

  it('senza l\'id dell\'Assistenza, a domanda finita, resta il comportamento di prima', () => {
    expect(nomeDellaControparte(conAssistenza, 'cliente', null)).toBe('Utente');
    expect(nomeDellaControparte(conAssistenza, 'cliente')).toBe('Utente');
    expect(conversazioneConLAssistenza(conAssistenza, 'cliente', null)).toBe(false);
  });

  it('un negozio vero resta col suo nome, anche mentre si chiede chi è l\'Assistenza', () => {
    const conNegozio = { ...conAssistenza, seller_id: 'pane', insegna: 'Pane Quotidiano' };
    expect(nomeDellaControparte(conNegozio, 'cliente', 'adm')).toBe('Pane Quotidiano');
    expect(nomeDellaControparte(conNegozio, 'cliente', null, true)).toBe('Pane Quotidiano');
    expect(conversazioneConLAssistenza(conNegozio, 'cliente', 'adm')).toBe(false);
  });

  it('un negozio che si chiama «Assistenza MyCity» non diventa l\'Assistenza', () => {
    const finto = { ...conAssistenza, seller_id: 'furbo', insegna: 'Assistenza MyCity' };
    expect(conversazioneConLAssistenza(finto, 'cliente', 'adm')).toBe(false);
  });

  it('dal lato dell\'Assistenza si vede il nome del cliente, come prima', () => {
    const vistaDallAssistenza = { ...conAssistenza, buyer: { full_name: 'Mario Rossi', store_name: null } };
    expect(nomeDellaControparte(vistaDallAssistenza, 'adm', 'adm')).toBe('Mario Rossi');
    expect(conversazioneConLAssistenza(vistaDallAssistenza, 'adm', 'adm')).toBe(false);
  });
});

describe('quando serve chiedere chi è l\'Assistenza, e quando il nome è «in arrivo»', () => {
  const conNegozio = { ...conAssistenza, seller_id: 'pane', insegna: 'Pane Quotidiano' };

  it('serve solo al cliente, e solo se il negozio non ha un nome da mostrare', () => {
    expect(serveSapereChiEAssistenza(conAssistenza, 'cliente')).toBe(true);
    expect(serveSapereChiEAssistenza(conNegozio, 'cliente')).toBe(false);
    expect(serveSapereChiEAssistenza({ ...conAssistenza, seller: { full_name: null, store_name: 'Fiori' } }, 'cliente')).toBe(false);
    expect(serveSapereChiEAssistenza(conAssistenza, 'adm'), 'chi sta dal lato del negozio non chiede').toBe(false);
    expect(serveSapereChiEAssistenza(conAssistenza, null)).toBe(false);
  });

  it('«in arrivo» vale solo per la riga senza nome, e smette quando l\'id arriva', () => {
    expect(nomeInArrivo(conAssistenza, 'cliente', null, true)).toBe(true);
    expect(nomeInArrivo(conAssistenza, 'cliente', null, false)).toBe(false);
    expect(nomeInArrivo(conAssistenza, 'cliente', 'adm', true)).toBe(false);
    expect(nomeInArrivo(conNegozio, 'cliente', null, true)).toBe(false);
  });

  it('un negozio che si chiama «…» non viene scambiato per un nome in arrivo', () => {
    const puntini = { ...conAssistenza, seller_id: 'strano', insegna: NOME_IN_ARRIVO };
    expect(nomeDellaControparte(puntini, 'cliente', null, true)).toBe(NOME_IN_ARRIVO);
    expect(nomeInArrivo(puntini, 'cliente', null, true)).toBe(false);
  });

  it('un id letto vale un\'ora; un «non c\'è» si richiede presto', () => {
    expect(validitaIdAssistenza({ state: { data: 'adm' } })).toBe(60 * 60 * 1000);
    expect(validitaIdAssistenza({ state: { data: null } })).toBeLessThanOrEqual(30 * 1000);
    expect(validitaIdAssistenza({ state: { data: undefined } })).toBeLessThanOrEqual(30 * 1000);
  });
});

describe('GET /api/support/conversation dice chi fa da Assistenza, solo a chi ci ha già scritto', () => {
  it('tutte e due le rotte passano dal controllo d\'accesso', () => {
    expect(stato.avvolte).toBe(2);
  });

  it('a chi ha una conversazione con l\'Assistenza risponde con il suo id', async () => {
    const risposta = await chiediChiEAssistenza();
    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toEqual({ supportId: 'adm' });
    expect(risposta.headers.get('cache-control')).toContain('no-store');
    expect(chiamateSu('profiles', 'eq')).toContainEqual(['role', 'admin']);
    expect(chiamateSu('profiles', 'order')).toContainEqual(['created_at', { ascending: true }]);
    expect(chiamateSu('conversations', 'eq')).toEqual([['buyer_id', 'cliente'], ['seller_id', 'adm']]);
    expect(stato.chiaviDelFreno).toEqual(['support:who:cliente']);
  });

  it('chi chiede troppo spesso riceve 429, e il database non viene toccato', async () => {
    stato.frenoChiuso = true;
    const risposta = await chiediChiEAssistenza();
    expect(risposta.status).toBe(429);
    expect(stato.chiamate).toEqual([]);
  });

  it('a chi non ha mai scritto all\'Assistenza non dà l\'id', async () => {
    stato.conversazioneConLAssistenza = { data: null, error: null };
    const risposta = await chiediChiEAssistenza();
    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toEqual({ supportId: null });
  });

  it('senza amministratori risponde null invece di un errore', async () => {
    stato.admin = { data: null, error: null };
    const risposta = await chiediChiEAssistenza();
    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toEqual({ supportId: null });
  });

  it('un guasto del database non diventa «nessuna Assistenza»', async () => {
    stato.admin = { data: null, error: { message: 'connessione caduta' } };
    const risposta = await chiediChiEAssistenza();
    expect(risposta.status).toBe(503);
    expect(JSON.stringify(await risposta.json())).not.toContain('supportId');
  });

  it('nemmeno un guasto sulla lettura della conversazione', async () => {
    stato.conversazioneConLAssistenza = { data: null, error: { message: 'connessione caduta' } };
    const risposta = await chiediChiEAssistenza();
    expect(risposta.status).toBe(503);
    expect(JSON.stringify(await risposta.json())).not.toContain('supportId');
  });
});

describe('POST /api/support/conversation, dopo il riordino', () => {
  function apriChat() {
    return POST(new Request('http://localhost/api/support/conversation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ firstMessage: 'Il mio ordine non è arrivato.' }),
    }) as never);
  }

  it('apre la chat con l\'Assistenza e dice subito chi è', async () => {
    stato.conversazioneConLAssistenza = { data: null, error: null };
    const risposta = await apriChat();
    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toEqual({ conversationId: 'conv-nuova', supportId: 'adm' });
    expect(chiamateSu('profiles', 'eq')).toContainEqual(['role', 'admin']);
    expect(chiamateSu('profiles', 'order')).toContainEqual(['created_at', { ascending: true }]);
  });

  it('senza amministratori resta «Assistenza non disponibile»', async () => {
    stato.admin = { data: null, error: null };
    expect((await apriChat()).status).toBe(404);
  });

  it('un guasto del database dice che l\'Assistenza non si raggiunge, non che non esiste', async () => {
    stato.admin = { data: null, error: { message: 'connessione caduta' } };
    expect((await apriChat()).status).toBe(503);
  });

  it('un guasto nel cercare la chat già aperta dà 503 e non ne apre una seconda', async () => {
    stato.conversazioneConLAssistenza = { data: null, error: { message: 'connessione caduta' } };
    expect((await apriChat()).status).toBe(503);
    expect(chiamateSu('conversations', 'insert'), 'una seconda chat urterebbe il vincolo di unicità').toEqual([]);
    expect(chiamateSu('messages', 'insert'), 'il primo messaggio andrebbe perso').toEqual([]);
  });

  it('l\'account Assistenza non apre una chat con se stesso', async () => {
    stato.utente = { id: 'adm' };
    expect((await apriChat()).status).toBe(400);
    expect(chiamateSu('conversations', 'insert')).toEqual([]);
  });
});

describe('leggiIdAssistenza: una domanda fallita si riprova, non si ricorda', () => {
  it('chiede all\'indirizzo giusto, con GET, e legge l\'id', async () => {
    const finto = vi.fn(async (_url: string, _o?: RequestInit) => new Response(JSON.stringify({ supportId: 'adm' }), { status: 200 }));
    vi.stubGlobal('fetch', finto);
    expect(await leggiIdAssistenza()).toBe('adm');
    expect(finto.mock.calls[0][0]).toBe('/api/support/conversation');
    expect(finto.mock.calls[0][1]?.method).toBe('GET');
  });

  it('«nessuna Assistenza per te» dà null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ supportId: null }), { status: 200 })));
    expect(await leggiIdAssistenza()).toBeNull();
  });

  it('una risposta d\'errore lancia, così React Query riprova', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    await expect(leggiIdAssistenza()).rejects.toThrow();
  });

  it('una rete caduta lancia, così React Query riprova', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rete caduta'); }));
    await expect(leggiIdAssistenza()).rejects.toThrow('rete caduta');
  });

  /**
   * Una rete che non risponde mai: la richiesta finisce solo se qualcuno la annulla. Come il
   * `fetch` vero, con un segnale già annullato si rifiuta subito. Torna lo stato del segnale
   * al momento di ogni chiamata.
   */
  function reteMuta() {
    const giaAnnullato: boolean[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, o?: RequestInit) => new Promise((_r, rifiuta) => {
      giaAnnullato.push(!!o?.signal?.aborted);
      if (o?.signal?.aborted) return rifiuta(new Error('annullata'));
      o?.signal?.addEventListener('abort', () => rifiuta(new Error('annullata')));
    })));
    return giaAnnullato;
  }

  // Il numero è scritto qui per esteso, non preso da TETTO_ATTESA_MS: se il tetto cambiasse
  // nel codice, una prova che legge la stessa costante cambierebbe insieme e non lo vedrebbe.
  it('una rete muta si arrende dopo 4 secondi, non prima', async () => {
    vi.useFakeTimers();
    reteMuta();
    let finita = false;
    const domanda = leggiIdAssistenza().finally(() => { finita = true; });
    domanda.catch(() => {});
    await vi.advanceTimersByTimeAsync(3999);
    expect(finita, 'si è arresa prima del tetto').toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(finita, 'dopo 4 secondi la domanda è ancora in piedi').toBe(true);
    await expect(domanda).rejects.toThrow('annullata');
    expect(TETTO_ATTESA_MS).toBe(4000);
  });

  it('a domanda finita il timer del tetto si spegne', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ supportId: 'adm' }), { status: 200 })));
    expect(await leggiIdAssistenza()).toBe('adm');
    expect(vi.getTimerCount(), 'un timer resta acceso dopo ogni domanda').toBe(0);
  });

  it('annullata da React Query si ferma subito, senza scriverlo come guasto', async () => {
    reteMuta();
    const annulla = new AbortController();
    const domanda = leggiIdAssistenza(annulla.signal);
    annulla.abort();
    await expect(domanda).rejects.toThrow('annullata');
    expect(stato.avvisi, 'un annullamento voluto finiva nei log come guasto').toEqual([]);
  });

  it('un segnale già annullato arriva alla rete già annullato', async () => {
    const giaAnnullato = reteMuta();
    const annulla = new AbortController();
    annulla.abort();
    await expect(leggiIdAssistenza(annulla.signal)).rejects.toThrow('annullata');
    expect(giaAnnullato, 'la domanda partiva come se nessuno l\'avesse annullata').toEqual([true]);
  });
});
