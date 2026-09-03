import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * UNA RISPOSTA TAGLIATA A META' VENIVA TRATTATA COME COMPLETA.
 *
 * Quando il modello esaurisce i token che gli abbiamo concesso si ferma dove
 * capita e lo dichiara: `stop_reason = 'max_tokens'`. Il testo si interrompe a
 * meta' parola; il blocco con i dati strutturati — nome, descrizione, verdetto
 * di conformita' — arriva monco, e l'SDK lo consegna comunque come un oggetto
 * con dentro i campi che era riuscito a scrivere.
 *
 * `runMessage` quel campo lo restituiva gia'. Il guaio e' che restava una
 * casella da guardare: nessuna delle diciassette chiamate la guardava. Una
 * descrizione tagliata finiva in vetrina; un verdetto interrotto passava per
 * «prodotto a posto».
 *
 * La cura non e' aggiungere un controllo in diciassette punti — si dimentica in
 * diciassette punti. E' spostare il cancello nell'unica porta da cui passano
 * tutti: chi non dice niente ottiene il rifiuto, e chi vuole la risposta a
 * meta' deve chiederla per nome.
 *
 * Qui la prova ESEGUE il caso «risposta tagliata»: il finto SDK risponde con
 * `stop_reason: 'max_tokens'` e si guarda cosa succede davvero.
 */

const createMock = vi.fn();
const spesaMock = vi.fn();
const warnMock = vi.fn();

vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return { ...actual, getAnthropic: () => ({ messages: { create: createMock } }) };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    spesa: (...a: unknown[]) => spesaMock(...a),
    warn: (...a: unknown[]) => warnMock(...a),
    error: vi.fn(),
  },
}));

import { runMessage, mapAiError, AiCallError, AiRispostaTagliataError } from '@/lib/ai/run';
import { assertSafeText, UnsafeContentError } from '@/lib/ai/moderation';
import { MODELS } from '@/lib/ai/client';

/** Una risposta del modello, con quanto serve perche' `runMessage` la sappia leggere. */
function risposta(over: Record<string, unknown>) {
  return {
    content: [],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
    ...over,
  };
}

/** La descrizione che il modello stava scrivendo quando i token sono finiti. */
const TAGLIATA = risposta({
  stop_reason: 'max_tokens',
  content: [{ type: 'text', text: 'Lampada a sospensione in ottone anticato, montata a mano nel labo' }],
});

const CHIAMATA = {
  feature: 'prova',
  model: MODELS.fast,
  max_tokens: 64,
  messages: [{ role: 'user' as const, content: 'descrivi questo prodotto' }],
};

describe('una risposta interrotta non esce da runMessage come se fosse finita', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('chi non dice niente e protetto: la risposta tagliata diventa un errore', async () => {
    createMock.mockResolvedValue(TAGLIATA);
    // Nessun `seTagliata` qui dentro: e' esattamente il chiamante distratto del
    // difetto. Prima riceveva il testo mozzo e lo scriveva in vetrina.
    await expect(runMessage(CHIAMATA)).rejects.toBeInstanceOf(AiRispostaTagliataError);
  });

  it('l errore porta con se il tetto che ha fermato il modello', async () => {
    createMock.mockResolvedValue(TAGLIATA);
    const errore = await runMessage(CHIAMATA).catch((e) => e);
    expect(errore).toBeInstanceOf(AiRispostaTagliataError);
    expect(errore.maxTokens, 'senza questo numero non si sa di quanto alzare il tetto').toBe(64);
    // Resta un AiCallError: le rotte che gia' catturano quella famiglia non
    // vedono passare l'errore senza accorgersene.
    expect(errore).toBeInstanceOf(AiCallError);
  });

  it('i token della risposta buttata finiscono lo stesso nel conto della spesa', async () => {
    createMock.mockResolvedValue(TAGLIATA);
    await runMessage(CHIAMATA).catch(() => undefined);
    // Quei token li abbiamo pagati anche se la risposta e' inservibile. Se il
    // rifiuto scattasse PRIMA della registrazione, le chiamate tagliate — cioe'
    // proprio quelle che si tende a rilanciare — sarebbero gratis nel registro,
    // e il tetto giornaliero smetterebbe di vedere la spesa che cresce di piu'.
    expect(
      spesaMock,
      'la chiamata tagliata e uscita dal conto della spesa: e stata pagata e non risulta',
    ).toHaveBeenCalledTimes(1);
    const [nome, dati] = spesaMock.mock.calls[0] as [string, { estCostEur: number }];
    expect(nome).toBe('ai_usage');
    expect(dati.estCostEur).toBeGreaterThan(0);
  });

  it('chi la risposta a meta la vuole davvero, la chiede per nome', async () => {
    createMock.mockResolvedValue(TAGLIATA);
    const r = await runMessage({ ...CHIAMATA, seTagliata: 'accetta' });
    expect(r.text).toContain('labo');
    // …e anche a lui il taglio si vede in faccia, senza dover conoscere il nome
    // tecnico del campo del fornitore.
    expect(r.tagliata).toBe(true);
    expect(r.stopReason).toBe('max_tokens');
  });

  it('una risposta finita normalmente passa come prima', async () => {
    createMock.mockResolvedValue(
      risposta({ content: [{ type: 'text', text: 'Lampada a sospensione in ottone.' }] }),
    );
    const r = await runMessage(CHIAMATA);
    expect(r.text).toBe('Lampada a sospensione in ottone.');
    expect(r.tagliata).toBe(false);
  });

  it('a chi guarda la pagina si dice che la risposta si e interrotta, non che il servizio e giu', async () => {
    createMock.mockResolvedValue(TAGLIATA);
    const errore = await runMessage(CHIAMATA).catch((e) => e);
    const risposta502 = mapAiError(errore, 'prova');
    expect(risposta502.status).toBe(502);
    const corpo = (await risposta502.json()) as { error: { message: string } };
    expect(corpo.error.message).toMatch(/interrott/i);
  });
});

describe('il filtro di conformita non da il via libera con un verdetto interrotto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('un verdetto tagliato a meta non diventa «contenuto ammesso»', async () => {
    // Il caso peggiore: il modello ha fatto in tempo a scrivere `allowed: true`
    // e si e' fermato prima del motivo. Il testo passa il filtro perche' la
    // risposta *sembra* un si'.
    createMock.mockResolvedValue(
      risposta({
        stop_reason: 'max_tokens',
        content: [{ type: 'tool_use', input: { allowed: true } }],
      }),
    );
    await expect(assertSafeText('un testo qualunque')).rejects.toThrow();
  });

  it('con un verdetto completo il filtro continua a lasciar passare', async () => {
    createMock.mockResolvedValue(
      risposta({ content: [{ type: 'tool_use', input: { allowed: true } }] }),
    );
    await expect(assertSafeText('un testo qualunque')).resolves.toBeUndefined();
  });

  it('e un contenuto davvero non conforme resta bloccato per il motivo giusto', async () => {
    createMock.mockResolvedValue(
      risposta({ content: [{ type: 'tool_use', input: { allowed: false, reason: 'armi' } }] }),
    );
    await expect(assertSafeText('un testo qualunque')).rejects.toBeInstanceOf(UnsafeContentError);
  });
});

describe('la porta resta una sola, altrimenti il cancello non serve a niente', () => {
  it('nessuna rotta parla col fornitore del modello scavalcando runMessage', async () => {
    // Il rifiuto vive dentro `runMessage`. Vale finche' quella e' l'UNICA via:
    // una rotta che aprisse per conto suo il collegamento al fornitore
    // tornerebbe ad avere il difetto tutto per se', e nessuno se ne
    // accorgerebbe. Qui si guarda chi tocca il fornitore: solo `lib/ai/`.
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const scavalcano: string[] = [];
    const visita = (cartella: string) => {
      for (const voce of readdirSync(cartella)) {
        const percorso = join(cartella, voce);
        if (statSync(percorso).isDirectory()) {
          visita(percorso);
          continue;
        }
        if (!/\.tsx?$/.test(voce)) continue;
        if (percorso.startsWith('lib/ai/')) continue; // e' casa sua
        const testo = readFileSync(percorso, 'utf8');
        if (/getAnthropic|new Anthropic|messages\.create\(/.test(testo)) scavalcano.push(percorso);
      }
    };
    visita('app');
    visita('lib');
    expect(
      scavalcano,
      'qui si apre il collegamento al modello senza passare da runMessage: il controllo sulla risposta tagliata non c e',
    ).toEqual([]);
  });
});
