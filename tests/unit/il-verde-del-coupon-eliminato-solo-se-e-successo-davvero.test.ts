import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  esitoDellaScrittura,
  pretendiScrittura,
  righeDellaRisposta,
  scrivi,
  ScritturaNonRiuscita,
  type RispostaScrittura,
} from '@/lib/esito-scrittura';

/**
 * 8/9/2026 — «COUPON ELIMINATO» IN VERDE MENTRE IL COUPON ERA ANCORA SPENDIBILE.
 *
 * In `/admin/coupons` il pulsante Elimina faceva `await supabase.from('coupons').delete()
 * .eq('id', id)` e basta. Quella funzione non poteva fallire: la risposta veniva buttata via
 * intera, quindi partiva sempre `onSuccess` col messaggio verde. Sessione scaduta, rete caduta a
 * metà, permesso negato dal database — a schermo la stessa frase. L'amministratore chiudeva la
 * pagina convinto che lo sconto fosse spento, i clienti continuavano a usarlo, e ce se ne
 * accorgeva a fine mese guardando i margini. Uguale il pulsante Attivo/Disattivato.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────
 * ① ESEGUE la regola nei casi che contano, compreso quello silenzioso che nessuno guardava:
 *    nessun errore e ZERO righe toccate. Con le regole di riga attive è così che si presenta una
 *    cancellazione senza permesso — non è un errore, è un comando che non trova niente.
 * ② ESEGUE il corpo vero della mutazione con una finta risposta del database, e pretende che il
 *    verde esca solo quando la riga è cambiata davvero.
 * ③ Legge la pagina e pretende che ogni scrittura passi da lì e chieda indietro le righe.
 *
 * ⚪ Da qui non apro il pannello nel browser e non tocco Supabase: verifico la regola, chi la
 * chiama, e il comportamento della mutazione su risposte finte.
 */

const PAGINA = readFileSync(join(process.cwd(), 'app/admin/coupons/page.tsx'), 'utf8');
/** Il codice senza i commenti: lì il difetto vecchio è citato per iscritto, e non va contato. */
const CODICE = PAGINA.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Com'è fatta la risposta di una `delete` che ha davvero cancellato una riga. */
const CANCELLATA: RispostaScrittura = { data: [{ id: 'c1' }], error: null, status: 200 };
/** Nessun errore, ma non ha toccato niente: il caso che faceva uscire il verde. */
const NIENTE_TOCCATO: RispostaScrittura = { data: [], error: null, status: 200 };
/** Il permesso negato, come lo scrive Postgres. */
const PERMESSO_NEGATO: RispostaScrittura = {
  data: null,
  error: { code: '42501', message: 'permission denied for table coupons' },
};

describe('quante righe ha toccato: e «non lo so» non è zero', () => {
  it('le righe restituite si contano', () => {
    expect(righeDellaRisposta(CANCELLATA)).toBe(1);
    expect(righeDellaRisposta(NIENTE_TOCCATO)).toBe(0);
  });

  it('il conteggio esatto vince sulle righe', () => {
    expect(righeDellaRisposta({ data: null, count: 3, error: null })).toBe(3);
    expect(righeDellaRisposta({ data: null, count: 0, error: null })).toBe(0);
  });

  it('una risposta che non le dichiara vale «non lo so», non zero', () => {
    expect(righeDellaRisposta({ data: null, error: null })).toBeNull();
    expect(righeDellaRisposta(undefined)).toBeNull();
  });
});

describe('l’esito di una scrittura', () => {
  it('riga cambiata: riuscita', () => {
    const e = esitoDellaScrittura(CANCELLATA, { cosa: 'Il coupon ESTATE25' });
    expect(e.riuscita).toBe(true);
    expect(e.motivo).toBeNull();
    expect(e.righeToccate).toBe(1);
  });

  it('errore del database: NON riuscita, e l’errore originale resta in mano a chi chiama', () => {
    const e = esitoDellaScrittura(PERMESSO_NEGATO, { cosa: 'Il coupon ESTATE25' });
    expect(e.riuscita).toBe(false);
    expect(e.motivo).toBe('errore');
    expect((e.errore as { code?: string }).code).toBe('42501');
  });

  it('nessun errore ma zero righe: NON riuscita — è il caso che faceva uscire il verde', () => {
    const e = esitoDellaScrittura(NIENTE_TOCCATO, { cosa: 'Il coupon ESTATE25' });
    expect(e.riuscita).toBe(false);
    expect(e.motivo).toBe('nessuna_riga');
    expect(e.messaggio).toContain('ancora come prima');
  });

  it('l’errore batte il conteggio: un `count` a zero con un errore resta un errore', () => {
    const e = esitoDellaScrittura({ count: 0, error: { message: 'network error' } }, { cosa: 'Il coupon' });
    expect(e.motivo).toBe('errore');
  });

  it('scrittura senza prova: non si afferma, si ammette di non sapere', () => {
    // È la `delete` senza `.select()`: il database non dice quante righe ha toccato.
    const e = esitoDellaScrittura({ data: null, error: null }, { cosa: 'Il coupon ESTATE25' });
    expect(e.riuscita).toBe(false);
    expect(e.motivo).toBe('senza_prova');
  });
});

describe('pretendiScrittura: chi non ha la prova, lancia', () => {
  it('riuscita: torna l’esito e non lancia', () => {
    expect(pretendiScrittura(CANCELLATA, { cosa: 'Il coupon' }).riuscita).toBe(true);
  });

  it('zero righe: lancia, e la frase spiega che il coupon è ancora vivo', () => {
    try {
      pretendiScrittura(NIENTE_TOCCATO, { cosa: 'Il coupon ESTATE25' });
      expect.unreachable('doveva lanciare');
    } catch (err) {
      expect(err).toBeInstanceOf(ScritturaNonRiuscita);
      expect((err as ScritturaNonRiuscita).motivo).toBe('nessuna_riga');
      expect((err as Error).message).toContain('ESTATE25');
    }
  });

  it('errore del database: rilancia quello vero, col suo codice', () => {
    try {
      pretendiScrittura(PERMESSO_NEGATO, { cosa: 'Il coupon' });
      expect.unreachable('doveva lanciare');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('42501');
    }
  });
});

/**
 * Il corpo vero della mutazione, con una risposta finta al posto del database: `scrivi` è
 * esattamente quello che la pagina mette dentro `mutationFn`. Se non lancia, React Query manda
 * il messaggio verde — quindi qui «verde» vuol dire proprio quello che si vede a schermo.
 */
async function premuto(risposta: RispostaScrittura): Promise<'verde' | 'rosso'> {
  try {
    await scrivi(async () => risposta, { cosa: 'Il coupon ESTATE25' });
    return 'verde';
  } catch {
    return 'rosso';
  }
}

describe('premo Elimina e il database risponde…', () => {
  it('una riga cancellata → verde', async () => {
    expect(await premuto(CANCELLATA)).toBe('verde');
  });

  it('permesso negato → rosso, non verde', async () => {
    expect(await premuto(PERMESSO_NEGATO)).toBe('rosso');
  });

  it('zero righe toccate → rosso: il coupon è ancora spendibile', async () => {
    expect(await premuto(NIENTE_TOCCATO)).toBe('rosso');
  });

  it('la rete cade e la promessa viene rifiutata: l’errore passa, non si trasforma in verde', async () => {
    await expect(
      scrivi(async () => { throw new Error('Failed to fetch'); }, { cosa: 'Il coupon' }),
    ).rejects.toThrow('Failed to fetch');
  });
});

describe('la pagina dei coupon usa questa regola, e non ne ha una sua', () => {
  const RIGHE = PAGINA.split('\n');
  // I commenti raccontano il difetto vecchio: citano `.delete()` senza essere una scrittura.
  const commento = (r: string) => /^\s*(\*|\/\/|\/\*)/.test(r);
  const SCRITTURE = RIGHE.map((r, i) => ({ r, i })).filter(({ r }) => !commento(r) && /\.(insert|update|delete)\(/.test(r));

  it('ci sono tre scritture: crea, attiva/disattiva, elimina', () => {
    expect(SCRITTURE).toHaveLength(3);
  });

  it('ognuna passa da `scrivi` e chiede indietro le righe toccate', () => {
    for (const { r, i } of SCRITTURE) {
      const intorno = RIGHE.slice(Math.max(0, i - 2), i + 1).filter((x) => !commento(x)).join('\n');
      expect(intorno, `scrittura non giudicata alla riga ${i + 1}: ${r.trim()}`).toContain('scrivi(');
      expect(r, `scrittura senza prova alla riga ${i + 1}: ${r.trim()}`).toContain('.select(');
    }
  });

  it('ogni mutazione ha il suo ramo rosso', () => {
    expect(CODICE.match(/onError:/g) ?? []).toHaveLength(3);
  });

  it('nessuna scrittura smonta la risposta buttando via l’errore', () => {
    expect(CODICE).not.toMatch(/const\s*\{\s*data\s*\}\s*=\s*await\s+supabase/);
    expect(CODICE).not.toMatch(/const\s*\{\s*count\s*\}\s*=\s*await\s+supabase/);
  });
});
