import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

/**
 * 17/11/2026 — La home di un negozio che non c'è diceva «Negozio non trovato» due volte: nel
 * titolo della scheda del browser e nel riquadro della pagina. Next manda i metadati in streaming
 * dentro il corpo, quindi la scritta compariva doppia, come alla 404 prima della sua cura. Qui si
 * esegue la `generateMetadata` vera del guscio con la lettura finta, e si confronta il titolo con
 * quello che la pagina disegna quando il negozio non c'è.
 */
const mondo: { riga: unknown } = { riga: null };
vi.mock('@/lib/supabase/lettura-per-metadati', () => ({
  leggiPerMetadati: async () => mondo.riga,
}));

const { generateMetadata } = await import('@/app/store/[id]/layout');

// Il titolo del riquadro che la pagina disegna quando il negozio non c'è.
const pagina = readFileSync('app/store/[id]/page.tsx', 'utf8');
const RIQUADRO = pagina.match(/<EmptyState\s+icon=\{Store\}\s+title="([^"]+)"/)?.[1] ?? '';

async function titolo() {
  const meta = await generateMetadata({ params: Promise.resolve({ id: 'mai-esistito' }) });
  return { titolo: String(meta.title), meta };
}

describe('il titolo della home di un negozio che non c’è', () => {
  it('il riquadro della pagina è quello che conosciamo', () => {
    expect(RIQUADRO).toBe('Negozio non trovato');
  });

  it('negozio inesistente: il titolo dice «non trovata» senza ripetere il riquadro', async () => {
    mondo.riga = null;
    const { titolo: t, meta } = await titolo();
    expect(t.toLowerCase(), 'il titolo ripete la scritta della pagina').not.toContain(RIQUADRO.toLowerCase());
    expect(t).toMatch(/non trovat[oa]/i);
    expect(t).toMatch(/MyCity$/);
    expect(meta.robots).toEqual({ index: false });
    expect(meta.alternates).toEqual({ canonical: null });
  });

  it('negozio non approvato o che non è un negozio: stesso titolo, senza ripetizione', async () => {
    for (const riga of [
      { id: 'n1', store_name: 'Forno Rossi', store_description: null, store_logo: null, store_address: null, is_approved: false, role: 'seller' },
      { id: 'n2', store_name: null, store_description: null, store_logo: null, store_address: null, is_approved: true, role: 'buyer' },
    ]) {
      mondo.riga = riga;
      const { titolo: t } = await titolo();
      expect(t.toLowerCase()).not.toContain(RIQUADRO.toLowerCase());
      expect(t).toMatch(/non trovat[oa]/i);
    }
  });

  it('controprova: il negozio vero ha il suo nome nel titolo', async () => {
    mondo.riga = { id: 'n3', store_name: 'Forno Rossi', store_description: null, store_logo: null, store_address: 'Via Roma 1', is_approved: true, role: 'seller' };
    const { titolo: t } = await titolo();
    expect(t).toContain('Forno Rossi');
  });
});
