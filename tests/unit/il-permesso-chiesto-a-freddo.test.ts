/**
 * «Vicino a te» chiedeva la posizione prima di far vedere qualsiasi cosa, e restava ferma ad aspettarla.
 *
 * TRE DIFETTI NELLO STESSO PUNTO, e il secondo è quello che costava di più.
 *
 * ① **Il permesso chiesto a freddo.** La richiesta partiva appena la pagina si montava: il riquadro
 *    di sistema arrivava prima di qualsiasi contenuto, senza una riga che dicesse perché. Un
 *    permesso chiesto così viene negato molto più spesso — e su iPhone, una volta negato, non lo
 *    richiede più nessuno: bisogna andare nelle impostazioni del telefono. **Un «no» dato in due
 *    secondi spegneva la funzione per sempre.**
 *
 * ② **La pagina bloccata ad aspettare.** `if (isLoading || (!pos && !permError))` copriva tutto con
 *    «Calcolo distanze…» finché la posizione non arrivava — dieci secondi di tetto, o **per sempre**
 *    se la persona lasciava lì il riquadro di sistema senza rispondere. E i negozi erano già in
 *    mano: la posizione serve a ORDINARLI, non a trovarli. Si nascondeva una cosa pronta per
 *    aspettarne una facoltativa.
 *
 * ③ **L'errore del browser mostrato com'è.** `'Impossibile ottenere la posizione: ' + err.message`.
 *    Quel testo lo scrive il browser, in inglese, e dice cose come «User denied Geolocation». Chi
 *    legge non capisce né cosa è successo né cosa può fare.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NEGATO,
  NON_DISPONIBILE,
  TROPPO_LENTO,
  frasePosizione,
  motivoPosizione,
  siAspetta,
  type MotivoPosizione,
} from '@/lib/posizione';

// ─────────────────────────────────────────────────────────────────────────────
// ① Cosa è successo: dal codice, non dal testo del browser.
// ─────────────────────────────────────────────────────────────────────────────

describe('leggere l\'errore del browser', () => {
  it('i tre motivi che il browser sa dare', () => {
    expect(motivoPosizione({ code: NEGATO })).toBe('negato');
    expect(motivoPosizione({ code: NON_DISPONIBILE })).toBe('non-disponibile');
    expect(motivoPosizione({ code: TROPPO_LENTO })).toBe('troppo-lento');
  });

  it('un codice sconosciuto è «non lo so», non uno dei tre a caso', () => {
    // Dire «hai negato il permesso» a chi non l'ha negato è peggio che non dire niente.
    for (const strano of [0, 4, 99, -1, undefined, null]) {
      expect(motivoPosizione({ code: strano as number }), `codice ${strano}`).toBe('non-lo-so');
    }
    expect(motivoPosizione(undefined)).toBe('non-lo-so');
    expect(motivoPosizione(null)).toBe('non-lo-so');
  });

  it('si guarda il CODICE e non il messaggio: quello è inglese e cambia da browser a browser', () => {
    const finto = { code: NEGATO, message: 'User denied Geolocation' } as { code: number; message: string };
    expect(motivoPosizione(finto)).toBe('negato');
    expect(frasePosizione(motivoPosizione(finto))).not.toContain('User denied');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② Cosa si dice: sempre cosa è successo E cosa si può fare.
// ─────────────────────────────────────────────────────────────────────────────

describe('la frase che legge la persona', () => {
  const tutti: MotivoPosizione[] = ['negato', 'non-disponibile', 'troppo-lento', 'non-lo-so'];

  it('ogni motivo ha la sua frase, e sono tutte diverse', () => {
    const frasi = tutti.map(frasePosizione);
    expect(new Set(frasi).size, 'due motivi diversi non possono dire la stessa cosa').toBe(tutti.length);
    for (const f of frasi) expect(f.length, 'una frase vuota non spiega niente').toBeGreaterThan(30);
  });

  it('ogni frase dice anche che i negozi ci sono lo stesso: «non è riuscito» da solo lascia fermi', () => {
    for (const m of tutti) {
      expect(frasePosizione(m), `il motivo «${m}» non dice cosa resta`).toMatch(/negozi di Piacenza/);
    }
  });

  it('nessuna frase è in inglese e nessuna incolpa la persona senza motivo', () => {
    for (const m of tutti) {
      const f = frasePosizione(m);
      expect(f).not.toMatch(/\b(denied|unavailable|timeout|error)\b/i);
    }
    // Solo su «negato» si può dire che il permesso non è stato dato: sugli altri sarebbe falso.
    expect(frasePosizione('negato')).toMatch(/permesso/);
    for (const m of ['non-disponibile', 'troppo-lento', 'non-lo-so'] as MotivoPosizione[]) {
      expect(frasePosizione(m), `«${m}» non deve accusare di aver negato`).not.toMatch(/non hai dato il permesso/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ La pagina aspetta solo quello che le serve davvero.
// ─────────────────────────────────────────────────────────────────────────────

describe('cosa vale la pena aspettare', () => {
  it('senza i negozi non c\'è niente da mostrare: lì si aspetta', () => {
    expect(siAspetta({ negoziInArrivo: true })).toBe(true);
  });

  it('IL CASO: i negozi ci sono, la posizione no — e la pagina NON si blocca', () => {
    // È il difetto ②: la lista era pronta e restava nascosta dietro «Calcolo distanze…».
    expect(siAspetta({ negoziInArrivo: false })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ L'invariante sulla pagina vera.
// ─────────────────────────────────────────────────────────────────────────────

describe('l\'invariante su «Vicino a te»', () => {
  const src = readFileSync(join(process.cwd(), 'app/near/page.tsx'), 'utf8');
  const senzaCommenti = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

  it('il permesso NON si chiede al montaggio: parte da un gesto', () => {
    // La forma malata: `getCurrentPosition` dentro un effetto con dipendenze vuote.
    const dentroUnEffetto = /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?getCurrentPosition[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/;
    expect(senzaCommenti, 'il permesso torna a essere chiesto a freddo').not.toMatch(dentroUnEffetto);
    expect(senzaCommenti, 'deve esserci un gesto che la chiede').toMatch(/onClick=\{chiediPosizione\}/);
  });

  it('la pagina non si blocca più aspettando la posizione', () => {
    expect(senzaCommenti, 'la condizione vecchia aspettava anche la posizione')
      .not.toMatch(/isLoading\s*\|\|\s*\(\s*!pos/);
    expect(senzaCommenti, 'deve passare dalla funzione che decide cosa aspettare').toMatch(/siAspetta\(/);
  });

  it('il messaggio del browser non finisce più a video', () => {
    expect(senzaCommenti, 'err.message è inglese e cambia da browser a browser')
      .not.toMatch(/err\.message/);
    expect(senzaCommenti, 'la frase la decide frasePosizione').toMatch(/frasePosizione\(/);
  });

  it('su «negato» non si offre un «riprova» che non può funzionare', () => {
    // Il browser non richiede il permesso una seconda volta: un pulsante lì sarebbe un clic a vuoto.
    expect(senzaCommenti).toMatch(/motivo !== 'negato'/);
  });
});
