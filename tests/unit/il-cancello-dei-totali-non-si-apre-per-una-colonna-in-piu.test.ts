import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { totaliDiSempre } from '@/lib/metriche-venditore';

/**
 * 6/9/2026 — IL CANCELLO SI FIDAVA DI UNA COLONNA COME SE FOSSE UNA PROMESSA.
 *
 * Nel cruscotto del negozio i totali «dall'inizio» li somma il database, con la
 * funzione `numeri_del_negozio`. Quella funzione somma il prezzo pieno degli
 * ordini e i rimborsi non li ha mai visti: se il negoziante li leggesse,
 * vedrebbe incassato piu' di quello che gli arriva in banca.
 *
 * Per questo in `lib/metriche-venditore.ts` c'e' un cancello: i totali del
 * database si mostrano solo se il database manda ANCHE quanto e' stato
 * rimborsato. Oggi non lo manda, quindi il cancello resta chiuso e si ripiega
 * sul conto del browser. Fin qui va bene.
 *
 * Il difetto e' come il cancello decide. Usa la PRESENZA di una colonna
 * (`rimborsi_totali_cents`) come prova che una somma fatta in un altro file —
 * una migrazione SQL — abbia tolto i rimborsi. Sono due cose diverse. Il giorno
 * in cui una migrazione aggiunge quella colonna senza rendere netto
 * l'incassato, il cancello si apre da solo, il negoziante torna a vedere il
 * numero gonfiato, e nessuna prova diventa rossa: il contratto fra il
 * TypeScript e la funzione SQL non lo verificava nessuno.
 *
 * Questa prova e' quel controllo. Legge il file .sql vero, trova l'ultima
 * definizione della funzione, e pretende: se il corpo espone
 * `rimborsi_totali_cents`, allora dentro il calcolo di `incasso_totale_cents`
 * deve comparire `refunded_amount_cents`. La colonna da sola non basta piu'.
 */

const RADICE = path.resolve(__dirname, '../..');
const CARTELLA_MIGRAZIONI = path.join(RADICE, 'migrations');

/** La colonna-sentinella su cui il cancello in TypeScript decide. */
const SENTINELLA = 'rimborsi_totali_cents';
/** Il campo dell'ordine dove vive il rimborso: senza quello, nessuna somma puo' essere netta. */
const RIMBORSO_SULL_ORDINE = 'refunded_amount_cents';

/**
 * L'ultima definizione di una funzione SQL, cercata come la applicherebbe
 * Postgres: le migrazioni in ordine di numero, e vince l'ultima che la riscrive.
 */
function ultimaDefinizione(nomeFunzione: string): { file: string; corpo: string } {
  const numero = (nome: string) => Number.parseInt(nome.slice(0, 3), 10);
  const files = readdirSync(CARTELLA_MIGRAZIONI)
    .filter((n) => n.endsWith('.sql'))
    .sort((a, b) => numero(a) - numero(b));

  let trovato: { file: string; corpo: string } | null = null;
  for (const nome of files) {
    const testo = readFileSync(path.join(CARTELLA_MIGRAZIONI, nome), 'utf8');
    const inizio = new RegExp(
      `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${nomeFunzione}\\b`,
      'gi',
    );
    let m: RegExpExecArray | null;
    while ((m = inizio.exec(testo)) !== null) {
      const dopo = testo.slice(m.index);
      const apre = dopo.indexOf('AS $$');
      if (apre === -1) continue;
      const chiude = dopo.indexOf('$$;', apre + 5);
      if (chiude === -1) continue;
      trovato = { file: nome, corpo: dopo.slice(apre + 5, chiude) };
    }
  }

  if (!trovato) {
    throw new Error(
      `Nessuna migrazione definisce public.${nomeFunzione}: questa prova non sta guardando niente.`,
    );
  }
  return trovato;
}

/**
 * Il contratto, in una frase: chi espone la sentinella dichiara di aver tolto i
 * rimborsi, e allora deve averli tolti davvero dov'e' scritto l'incassato.
 * Torna il motivo se il contratto e' rotto, `null` se regge.
 */
function contrattoRotto(corpo: string): string | null {
  if (!corpo.includes(SENTINELLA)) return null;

  const chiave = corpo.indexOf("'incasso_totale_cents'");
  if (chiave === -1) {
    return `Il corpo espone ${SENTINELLA} ma non calcola piu' incasso_totale_cents: il cancello in TypeScript legge un campo che non esiste.`;
  }

  // Il calcolo di quella voce: dai due punti fino alla voce successiva del
  // jsonb_build_object (una riga che apre con un apostrofo dopo una virgola).
  const resto = corpo.slice(chiave + "'incasso_totale_cents'".length);
  const prossima = resto.search(/,\s*(?:--[^\n]*\n\s*)*'/);
  const calcolo = prossima === -1 ? resto : resto.slice(0, prossima);

  if (!calcolo.includes(RIMBORSO_SULL_ORDINE)) {
    return `Il corpo espone ${SENTINELLA} ma incasso_totale_cents non nomina ${RIMBORSO_SULL_ORDINE}: la colonna in piu' apre il cancello senza che nessuno abbia tolto i rimborsi.`;
  }
  return null;
}

describe('la funzione del database che somma i totali del negozio', () => {
  const { file, corpo } = ultimaDefinizione('numeri_del_negozio');

  it('rispetta il contratto: se dice di sapere dei rimborsi, li ha tolti', () => {
    expect(contrattoRotto(corpo), `Contratto rotto in migrations/${file}`).toBeNull();
  });

  it('oggi non espone i rimborsi, quindi il cruscotto ripiega sul conto del browser', () => {
    const espone = corpo.includes(SENTINELLA);
    const ripiego = { incassatoCents: 6_000, tuoNettoCents: 5_000 };

    // Lo stato del file .sql e la scelta del codice devono raccontare la stessa
    // storia: finche' la funzione non manda i rimborsi, i suoi totali non si mostrano.
    const dalDatabase = { incasso_totale_cents: 10_000, commissione_totale_cents: 850 };
    expect(espone).toBe(false);
    // 8/9/2026 — i totali adesso escono con la loro finestra attaccata: sono le
    // stesse due cifre di prima, piu' il periodo che coprono davvero.
    expect(totaliDiSempre(dalDatabase, ripiego)).toEqual({ ...ripiego, finestra: 'ultimi-30-giorni' });
  });
});

describe('il controllo del contratto morde davvero', () => {
  /** La migrazione scomoda: aggiunge la colonna e lascia la somma sul prezzo pieno. */
  const colonnaAggiuntaAMano = `
    SELECT jsonb_build_object(
      'ordini_contati', count(*),
      'incasso_totale_cents', coalesce(sum(round(total_price * 100)::int), 0),
      'rimborsi_totali_cents', coalesce(sum(coalesce(refunded_amount_cents, 0)), 0)
    ) INTO v_esito FROM conta;
  `;

  /** La migrazione giusta: l'incassato e' gia' al netto di quello che e' tornato indietro. */
  const contoResoNetto = `
    SELECT jsonb_build_object(
      'ordini_contati', count(*),
      'incasso_totale_cents',
        coalesce(sum(greatest(round(total_price * 100)::int - coalesce(refunded_amount_cents, 0), 0)), 0),
      'rimborsi_totali_cents', coalesce(sum(coalesce(refunded_amount_cents, 0)), 0)
    ) INTO v_esito FROM conta;
  `;

  it('boccia la colonna aggiunta senza rendere netto l incassato', () => {
    expect(contrattoRotto(colonnaAggiuntaAMano)).toMatch(/non nomina refunded_amount_cents/);
  });

  it('promuove la somma che i rimborsi li toglie davvero', () => {
    expect(contrattoRotto(contoResoNetto)).toBeNull();
  });

  it('non ha niente da dire finche la sentinella non c e', () => {
    expect(contrattoRotto("SELECT jsonb_build_object('incasso_totale_cents', 1)")).toBeNull();
  });
});

describe('il cancello in TypeScript e questa prova guardano la stessa colonna', () => {
  it('lib/metriche-venditore.ts decide ancora su rimborsi_totali_cents', () => {
    const sorgente = readFileSync(path.join(RADICE, 'lib/metriche-venditore.ts'), 'utf8');
    expect(
      sorgente.includes(SENTINELLA),
      `Il cancello non nomina piu' ${SENTINELLA}: questa prova sorveglierebbe un contratto che non esiste piu'.`,
    ).toBe(true);
  });

  it('con la sentinella presente i totali del database valgono', () => {
    const ripiego = { incassatoCents: 6_000, tuoNettoCents: 5_000 };
    expect(
      totaliDiSempre(
        {
          incasso_totale_cents: 10_000,
          commissione_totale_cents: 850,
          non_del_negozio_cents: 800,
          rimborsi_totali_cents: 0,
        },
        ripiego,
      ),
    ).toEqual({ incassatoCents: 10_000, tuoNettoCents: 8_350, finestra: 'dall-inizio' });
  });
});
