import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  PICKUP_DISCOUNT_PERCENT,
  RITIRO_IN_NEGOZIO_ATTIVO,
} from '@/lib/constants';
import { compensoRiderCents } from '@/lib/shipping';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';
import {
  fraseComeArriva,
  rispostaComeOrdinare,
  temiDellaSpedizione,
} from '@/lib/promesse-pubbliche';
import { monta } from './aiuti/monta-componente';

function leggi(file: string): string {
  return readFileSync(path.join(process.cwd(), file), 'utf8');
}

describe('il ritiro in negozio non si offre', () => {
  it('l opzione e spenta', () => {
    expect(RITIRO_IN_NEGOZIO_ATTIVO).toBe(false);
  });

  it('lo sconto e zero, cosi nessun negozio lo paga senza saperlo', () => {
    expect(PICKUP_DISCOUNT_PERCENT).toBe(0);
  });

  it('la tessera in cassa e dietro l interruttore, non sempre visibile', () => {
    const selettore = leggi('components/checkout/PaymentMethodSelector.tsx');
    expect(selettore).toContain('RITIRO_IN_NEGOZIO_ATTIVO &&');
  });
});

describe('e non si puo chiedere lo stesso da fuori', () => {
  // Il browser non e' una fonte fidata: una richiesta costruita a mano, o una
  // scheda rimasta aperta da prima del rilascio, puo' mandare pickupInStore
  // uguale a vero. Il server lo spegne subito dopo la convalida, una volta
  // sola, cosi' non c'e' un punto piu' sotto che possa sfuggire.
  for (const rotta of [
    'app/api/orders/cod/route.ts',
    'app/api/stripe/checkout/route.ts',
  ]) {
    it(`${rotta} spegne il ritiro chiesto dal browser`, () => {
      const codice = leggi(rotta);
      expect(codice).toContain('body.pickupInStore = RITIRO_IN_NEGOZIO_ATTIVO && body.pickupInStore;');
    });
  }
});

describe('il compenso del fattorino, col ritiro', () => {
  it('col ritiro non c e consegna, quindi non c e compenso', () => {
    expect(compensoRiderCents({ pickupInStore: true })).toBe(0);
  });

  it('con la consegna vera il compenso c e', () => {
    expect(compensoRiderCents({ pickupInStore: false })).toBeGreaterThan(0);
  });
});

/**
 * 3/9/2026 — LA VETRINA PROMETTEVA ANCORA IL RITIRO, DOVE NESSUNO GUARDAVA.
 *
 * I controlli qui sopra tengono ferma la funzione: l'interruttore spento, le due rotte che spengono
 * quello che arriva dal browser, la tessera in cassa dietro l'interruttore. Nessuno di loro guarda
 * un testo rivolto al cliente — e il testo era rimasto indietro in quattro posti:
 *
 *   ① la descrizione di OGNI pagina negozio (`app/store/[id]/layout.tsx`): «Consegna locale in
 *      30-60 minuti o ritiro in negozio». È quello che si legge nel risultato di Google e
 *      nell'anteprima quando il negoziante incolla il link su WhatsApp: il primo contatto di chi
 *      arriva dal QR in vetrina;
 *   ② la descrizione della categoria «alimentari» (`app/category/[slug]/layout.tsx`);
 *   ③ la PRIMA risposta delle FAQ: «scegli un indirizzo di consegna o il ritiro in negozio»;
 *   ④ la scheda «Spedizioni» del centro assistenza: «Tempi, costi, ritiro in negozio, tracciamento».
 *
 * Chi ci crede riempie il carrello e alla cassa scopre che l'unica strada è la consegna a casa, che
 * si paga. Nicola l'aveva spento apposta: «non ne ho ancora parlato con i negozi».
 *
 * ── Cosa prova questo blocco, e perché non è una parola cercata ──────────────────────────────────
 * Esegue le funzioni con l'interruttore nei due versi, ed ESEGUE la `generateMetadata` vera della
 * pagina negozio con la lettura del database finta: quello che si controlla è la descrizione che
 * uscirebbe davvero. Poi conta i posti: se una pagina rivolta al cliente nomina il ritiro senza
 * sapere niente dell'interruttore, vuol dire che qualcuno l'ha riscritto a mano, ed è rossa.
 */
describe('e in vetrina non si promette il ritiro finché è spento', () => {
  it('la frase «come arriva l’ordine» segue l’interruttore', () => {
    expect(fraseComeArriva(false), 'con il ritiro spento la vetrina non deve nominarlo').not.toMatch(
      /ritiro/i,
    );
    expect(fraseComeArriva(true), 'riacceso, la promessa deve tornare da sé').toMatch(/ritiro in negozio/i);
    expect(fraseComeArriva(false), 'i minuti si prendono da dove sono decisi').toContain(EXPRESS_ETA_LABEL);
  });

  it('la prima risposta delle FAQ non insegna a scegliere un’opzione che non c’è', () => {
    expect(rispostaComeOrdinare(false).a).not.toMatch(/ritiro/i);
    expect(rispostaComeOrdinare(true).a).toMatch(/ritiro in negozio/i);
  });

  it('la scheda «Spedizioni» del centro assistenza non annuncia un tema che la pagina non ha', () => {
    expect(temiDellaSpedizione(false)).not.toMatch(/ritiro/i);
    expect(temiDellaSpedizione(true)).toMatch(/ritiro in negozio/i);
  });

  it('e la descrizione vera della pagina negozio — quella di Google e di WhatsApp — non lo promette', async () => {
    // Qui non si cerca una parola nel file: si ESEGUE la `generateMetadata` vera del guscio del
    // negozio. La riga del database la serve una risposta finta, e il negozio è il caso che conta:
    // approvato e SENZA descrizione propria, cioè quello in cui entra in gioco la frase di ripiego.
    const riga = {
      id: 'negozio-di-prova',
      store_name: 'Panificio di prova',
      store_description: null,
      store_logo: null,
      store_address: 'via di prova 1',
      is_approved: true,
      role: 'seller',
    };
    const veroFetch = globalThis.fetch;
    const vecchieVariabili = {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      chiave: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    };
    process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://finto.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'chiave-finta';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(riga), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    try {
      const guscio = await monta('app/store/[id]/layout.tsx');
      const generaMetadati = guscio.generateMetadata as (
        p: { params: Promise<{ id: string }> },
      ) => Promise<{
        description?: string;
        openGraph?: { description?: string };
        twitter?: { description?: string };
      }>;
      const meta = await generaMetadati({ params: Promise.resolve({ id: riga.id }) });

      const scritte = [
        meta.description,
        meta.openGraph?.description,
        // La card di Twitter porta la stessa frase: dimenticarne una la lascia in giro lo stesso.
        meta.twitter?.description,
      ];
      for (const testo of scritte) {
        expect(testo, 'la descrizione della pagina negozio è sparita: questa prova non misura niente').toBeTruthy();
        expect(
          testo,
          `con il ritiro spento la pagina negozio scrive «${testo}»: chi arriva dal QR in vetrina o ` +
            'da un link su WhatsApp legge una promessa che alla cassa non trova',
        ).not.toMatch(/ritiro/i);
      }
      // E la frase c'è davvero: se sparisse tutta, il controllo qui sopra passerebbe senza motivo.
      expect(meta.description).toContain(fraseComeArriva());
    } finally {
      globalThis.fetch = veroFetch;
      if (vecchieVariabili.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (vecchieVariabili.chiave === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    }
  });
});

describe('nessuna pagina rivolta al cliente riscrive il ritiro a mano', () => {
  const RADICE = process.cwd();
  /** Le pagine dello staff non sono vetrina: lì il ritiro si nomina per governarlo. */
  const NON_E_VETRINA = /(^|\/)(admin|seller|rider|api)(\/|$)/;

  function pagineDelCliente(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
      if (nome === 'node_modules' || nome.startsWith('.')) continue;
      const p = path.join(dir, nome);
      if (statSync(p).isDirectory()) pagineDelCliente(p, out);
      else if (/^(page|layout)\.tsx$/.test(nome) && !NON_E_VETRINA.test(path.relative(RADICE, p))) out.push(p);
    }
    return out;
  }

  /** I pezzi di testo scritti a mano in una riga: fra apici, fra virgolette, fra apici inversi. */
  function fraseScritteAMano(riga: string): string[] {
    return Array.from(riga.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)).map((m) => m[1] ?? m[2] ?? m[3]);
  }

  const pagine = pagineDelCliente(path.join(RADICE, 'app'));

  it('trova davvero delle pagine (se no non sta misurando niente)', () => {
    expect(pagine.length).toBeGreaterThan(20);
  });

  /**
   * La regola, e perché è questa. Il ritiro può comparire in una pagina del cliente in due modi:
   * DERIVATO — `{riquadroRitiroInNegozio() && …}`, `{pickupInStore ? …}` — e allora sparisce da sé
   * quando l'interruttore è spento; oppure SCRITTO A MANO dentro una stringa, e allora resta lì
   * qualunque cosa dica il codice. È così che si erano rotti tutti e quattro i posti di oggi: una
   * frase in una stringa, in un file che nessuno rileggeva come «testo per il cliente».
   */
  it('chi nomina il ritiro lo deriva dall’interruttore, invece di scriverlo in una frase', () => {
    const colpevoli: string[] = [];
    for (const file of pagine) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((riga, i) => {
          if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(riga)) return; // i commenti il cliente non li legge
          if (fraseScritteAMano(riga).some((t) => /ritiro in negozio/i.test(t))) {
            colpevoli.push(`${path.relative(RADICE, file)}:${i + 1}`);
          }
        });
    }
    expect(
      colpevoli,
      'queste righe promettono il ritiro in negozio con una frase scritta a mano, mentre alla cassa ' +
        'non esiste: la frase va presa da lib/promesse-pubbliche.ts, che la fa sparire da sé',
    ).toEqual([]);
  });
});
