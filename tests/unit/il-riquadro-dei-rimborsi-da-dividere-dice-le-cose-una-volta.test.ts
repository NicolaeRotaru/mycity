/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 16/10/2026 (riesame del lotto) — IL RIQUADRO «RIMBORSI DAL CRUSCOTTO DA
 * DIVIDERE» A SCHERMO.
 *
 * ① Quando la lettura non riusciva, il riquadro metteva davanti al messaggio
 *   del server la stessa frase, e si leggeva: «Non riesco a leggere i rimborsi
 *   dal cruscotto da dividere: Non riesco a leggere i rimborsi da dividere:
 *   riprova fra poco.»
 * ② Un pagamento che Stripe non lasciava leggere spegneva tutto il riquadro.
 *   Adesso il server lo manda a parte (`nonLetti`) e il riquadro lo mostra
 *   sopra i carrelli che si possono dividere.
 * ③ Un ordine del carrello che il webhook non ha fermato (un reclamo in corso)
 *   adesso compare fra quelli a cui dare una parte, e il riquadro dice perché è
 *   diverso dagli altri.
 *
 * La prova monta il componente VERO e legge quello che compare a schermo.
 */

const globali = globalThis as Record<string, unknown>;

afterEach(() => {
  delete globali.__DATI_QUERY__;
  delete globali.__ESITO_QUERY__;
});

async function schermo() {
  const mod = await monta('components/admin/RimborsiDaDividere.tsx');
  return accendi(mod.RimborsiDaDividere, {});
}

describe('il riquadro dei rimborsi dal cruscotto da dividere', () => {
  it('IL CASO DEL RIESAME — se la lettura non riesce, il messaggio del server si legge una volta sola', async () => {
    globali.__ESITO_QUERY__ = {
      data: undefined,
      isError: true,
      isSuccess: false,
      error: new Error('Non riesco a leggere i rimborsi da dividere: riprova fra poco.'),
    };
    const s = await schermo();

    const testo = testoVisibile(s.radice);
    const volte = testo.split('Non riesco a leggere i rimborsi').length - 1;
    expect(volte, `a schermo: «${testo}»`).toBe(1);
    expect(testo).toContain('riprova fra poco');
    expect(testo, 'senza il titolo non si sa di quale riquadro si parla').toContain('Rimborsi dal cruscotto da dividere');
    s.smonta();
  });

  it('un pagamento che Stripe non lascia leggere sta a parte, e il carrello leggibile si divide lo stesso', async () => {
    globali.__DATI_QUERY__ = {
      carrelli: [
        {
          pagamento: 'pi_1',
          daDividereCents: 300,
          ordini: [
            { id: 'pane01', negozio: 'Pane Quotidiano', lordoCents: 1500, giaRimborsatoCents: 0, restaCents: 1500, bonificoPartito: false, fermo: true },
            { id: 'fiori1', negozio: 'Il fioraio', lordoCents: 1290, giaRimborsatoCents: 0, restaCents: 1290, bonificoPartito: false, fermo: false },
          ],
        },
      ],
      nonLetti: [{ pagamento: 'pi_2', motivo: 'Too many requests' }],
    };
    const s = await schermo();

    const testo = testoVisibile(s.radice);
    expect(testo).toContain('pi_2');
    expect(testo).toContain('Stripe adesso non mi lascia leggere questi pagamenti');
    expect(testo, 'il carrello leggibile è sparito').toContain('Pane Quotidiano');
    // Il fioraio non è fermo: il riquadro lo dice, accanto al suo nome.
    const rigaFiori = Array.from(s.radice.querySelectorAll('tr')).find((r) => (r.textContent ?? '').includes('Il fioraio'));
    expect(testoVisibile(rigaFiori ?? null)).toContain('bonifico non fermo');
    const rigaPane = Array.from(s.radice.querySelectorAll('tr')).find((r) => (r.textContent ?? '').includes('Pane Quotidiano'));
    expect(testoVisibile(rigaPane ?? null)).not.toContain('bonifico non fermo');
    s.smonta();
  });

  it('se non c è niente da dividere e niente di illeggibile, il riquadro non compare', async () => {
    globali.__DATI_QUERY__ = { carrelli: [], nonLetti: [] };
    const s = await schermo();
    expect(testoVisibile(s.radice)).toBe('');
    s.smonta();
  });
});
