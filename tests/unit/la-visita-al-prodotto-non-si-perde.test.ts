/**
 * 27/8/2026 (R175) — LA PRIMA SCHEDA PRODOTTO DI OGNI VISITATORE NUOVO NON VENIVA CONTATA.
 *
 * Due difetti nello stesso pezzo di codice, e tutti e due tolgono visite al negoziante.
 *
 * ① IL CONSENSO CHE ARRIVA DOPO. Chi apre una scheda prodotto e accetta i cookie da lì — cioè il
 *   caso normale al primo ingresso nel sito — non generava niente: né l'evento, né la riga in
 *   `product_views`. L'effetto guardava il consenso una volta sola, all'apertura, e non ascoltava
 *   il momento in cui la persona accetta. Il commento sopra prometteva il contrario («il conteggio
 *   riparte da solo appena la persona accetta»); PostHog quel caso lo gestisce da sempre.
 *
 * ② IL FRENO MESSO PRIMA DI PARTIRE. La visita veniva segnata come «già contata» PRIMA di scrivere
 *   la riga. Se la scrittura falliva — rete, permessi, database occupato — quella visita restava
 *   segnata come contata per tutta la sessione: persa, e senza modo di accorgersene.
 *
 * Il negoziante vede una visita in meno per ogni persona nuova, e il tasso di conversione che ne
 * deriva (ordini diviso visite) esce gonfiato.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { contaLaVisita, chiaveDellaVisita } from '@/lib/analytics/visita-prodotto';

function banco(opzioni: { consenso?: boolean; scritturaFallisce?: boolean } = {}) {
  const segnate = new Set<string>();
  const annunci: number[] = [];
  const scritture: number[] = [];
  return {
    segnate,
    annunci,
    scritture,
    deps: {
      consenso: () => opzioni.consenso ?? true,
      giaContata: (c: string) => segnate.has(c),
      segnaContata: (c: string) => { segnate.add(c); },
      annuncia: () => { annunci.push(1); },
      registra: async () => {
        scritture.push(1);
        if (opzioni.scritturaFallisce) throw new Error('rete giù');
      },
    },
  };
}

describe('contare la visita a una scheda prodotto', () => {
  it('senza consenso non si conta niente e non si segna niente', async () => {
    const b = banco({ consenso: false });
    expect(await contaLaVisita('pane-1', b.deps)).toBe('senza-consenso');
    expect(b.scritture).toHaveLength(0);
    expect(b.segnate.size, 'segnata come contata una visita che non è mai partita').toBe(0);
  });

  it('se la scrittura fallisce la visita NON resta segnata come contata', async () => {
    const b = banco({ scritturaFallisce: true });

    expect(await contaLaVisita('pane-1', b.deps)).toBe('non-riuscita');
    expect(b.segnate.has(chiaveDellaVisita('pane-1')), 'la visita è persa per tutta la sessione').toBe(false);
  });

  it('e al tentativo dopo ci riprova davvero', async () => {
    const segnate = new Set<string>();
    let fallisci = true;
    const scritture: number[] = [];
    const deps = {
      consenso: () => true,
      giaContata: (c: string) => segnate.has(c),
      segnaContata: (c: string) => { segnate.add(c); },
      annuncia: () => {},
      registra: async () => {
        scritture.push(1);
        if (fallisci) { fallisci = false; throw new Error('rete giù'); }
      },
    };

    await contaLaVisita('pane-1', deps);
    const secondo = await contaLaVisita('pane-1', deps);

    expect(secondo).toBe('contata');
    expect(scritture, 'la seconda volta non ci ha nemmeno provato').toHaveLength(2);
  });

  it('quando è andata bene, la stessa scheda non si conta due volte', async () => {
    const b = banco();
    expect(await contaLaVisita('pane-1', b.deps)).toBe('contata');
    expect(await contaLaVisita('pane-1', b.deps)).toBe('gia-contata');
    expect(b.scritture, 'venti ricariche = venti visite finte').toHaveLength(1);
  });

  it('l evento verso i sistemi di misura parte una volta sola, e solo se la riga è stata scritta', async () => {
    const rotto = banco({ scritturaFallisce: true });
    await contaLaVisita('pane-1', rotto.deps);
    expect(rotto.annunci, 'annunciata una visita che nel database non esiste').toHaveLength(0);

    const buono = banco();
    await contaLaVisita('pane-1', buono.deps);
    await contaLaVisita('pane-1', buono.deps);
    expect(buono.annunci).toHaveLength(1);
  });
});

describe('il componente che sta sulla scheda', () => {
  const src = readFileSync('components/ProductViewTracker.tsx', 'utf8');

  it('si rimette in ascolto quando la persona accetta i cookie', () => {
    // Controllo di struttura (i componenti React non si montano dentro una prova, qui): il
    // componente deve iscriversi al cambio di consenso, come fa PostHog.
    expect(src, 'chi accetta i cookie dalla scheda prodotto non viene contato').toContain('mc:consent-change');
  });

  it('la visita la conta il modulo qui sopra, non una copia scritta nel componente', () => {
    expect(src).toContain('contaLaVisita');
  });
});
