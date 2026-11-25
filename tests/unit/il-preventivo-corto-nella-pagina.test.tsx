/**
 * 25/11/2026 — IL PREVENTIVO CORTO, NELLA PAGINA VERA.
 *
 * Dal collaudo: la prova dei componenti non vedeva la pagina. Qui si monta `app/preventivo/[codice]/page.tsx`
 * (dopo mycity#331: `app/preventivo/[codice]/abbonamento/page.tsx`) intera, con dati finti al posto del database, e si guarda il testo che legge il cliente: nessun testo intero
 * di `FASCE` (Nicola, 18:30: «corta e con lo stretto necessario»), e c'è ancora tutto quello che serve per
 * scegliere e pagare.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ABBONAMENTI, FASCE, SERVIZI_AGENZIA, costruisciPreventivo, leggiImpostazioniAgenzia } from '@/lib/agenzia/preventivo';
import { offertaSuMisura, type DatiPerLOfferta } from '@/lib/agenzia/offerta-su-misura';
import { SERVIZI_IN_BREVE } from '@/lib/agenzia/preventivo-corto';

const ID = '0de1905e-7000-4000-8000-000000000002';
const DATI: DatiPerLOfferta = {
  nome: 'La Ragazzetta',
  tipo: 'bar',
  dati: { storeLogo: null, storeMedia: [], prodotti: [{ images: [] }, { images: ['https://x.it/p.jpg'] }], socials: { instagram: 'laragazzetta' } },
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => {
  const catena: Record<string, unknown> = {};
  for (const k of ['from', 'select', 'eq', 'in', 'limit']) catena[k] = () => catena;
  catena.maybeSingle = async () => ({ data: null, error: null });
  return { getAdminSupabase: () => catena };
});
vi.mock('@/lib/agenzia/demo-dal-link', () => ({
  leggiDemoDalLink: async () => {
    const preventivo = costruisciPreventivo({
      idAttivita: ID, nomeAttivita: DATI.nome, tipoAttivita: DATI.tipo, dati: DATI.dati,
      impostazioni: leggiImpostazioniAgenzia({}), adesso: new Date('2026-11-25T10:00:00Z'),
    });
    preventivo.offerta = offertaSuMisura(DATI);
    return { tipo: 'aperto', pc: { stato: 'aperto', sellerId: ID, nomeAttivita: DATI.nome, fasciaScelta: null }, preventivo, scheda: null };
  },
}));
vi.mock('@/components/seller/AnteprimaServizio', () => ({ default: () => null }));
vi.mock('@/app/preventivo/[codice]/abbonamento/AccettaDalLink', () => ({ default: () => <button type="button">Accetto</button> }));
vi.mock('@/app/preventivo/[codice]/abbonamento/PagaDalLink', () => ({ default: () => null }));

describe('il preventivo dal link, montato', () => {
  it('nessun testo intero di FASCE; i prezzi, la fascia consigliata e le righe corte ci sono', async () => {
    const { default: Pagina } = await import('@/app/preventivo/[codice]/abbonamento/page');
    const el = await Pagina({ params: Promise.resolve({ codice: 'a'.repeat(64) }), searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(el);
    const testo = html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '’').replace(/\s+/g, ' ');
    expect(testo).toContain('Il preventivo di La Ragazzetta');
    for (const f of ABBONAMENTI) {
      expect(testo).toContain(FASCE[f].nome);
      for (const s of SERVIZI_AGENZIA) expect(testo, `${f}/${s}`).not.toContain(FASCE[f].servizi[s]);
    }
    expect(testo).toContain('consigliato');
    expect(testo).toContain('Perché consigliamo');
    const guardata = ABBONAMENTI.find((f) => testo.includes(`Cosa comprende il ${FASCE[f].nome}`))!;
    expect(guardata).toBeDefined();
    for (const s of SERVIZI_AGENZIA) expect(testo).toContain(SERVIZI_IN_BREVE[guardata][s]);
    // l'offerta su misura è corta: niente riepilogo per fascia, niente «in più»
    expect(html).not.toContain('data-testid="offerta-riepilogo"');
    expect(html).not.toContain('data-testid="offerta-in-piu"');
    expect(testo).toContain('Accetto');
  });
});
