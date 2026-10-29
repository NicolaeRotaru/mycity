import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONSEGNA_FRASE_INTERA } from '@/lib/promessa-consegna';

/**
 * 29/10/2026 — LA CONSEGNA SI PROMETTE ALL'ORA CHE SCEGLI, LA VELOCE SOLO SE C'È UN FATTORINO.
 *
 * Regola di Nicola del 29/10 (registro dei fatti, consegna.promessa): la consegna normale arriva
 * nella fascia oraria che il cliente sceglie in cassa; la veloce arriva in 30-60 minuti dalla
 * conferma del negozio e si può solo dalle 8 alle 21, a negozi aperti, con un fattorino in servizio.
 *
 * Il difetto: la striscia in testata, il piede, i contatti del negozio, la scheda della home e le
 * descrizioni per Google dicevano «Consegna in 30-60 min» come cosa certa, con un solo fattorino in
 * produzione e per di più in attesa di approvazione. La scheda prodotto contava fino alle 18 anche per
 * un forno che chiude alle 13, prometteva «domani» a negozi chiusi domani e «2-3 giorni» — una consegna
 * che la cassa non ha — sui prodotti esauriti. E la home (variante B) diceva «Paghi come vuoi» sopra
 * una cassa che offre solo i contanti.
 *
 * Qui si DISEGNANO i pezzi veri (testata, piede, contatti, scheda prodotto, pagina Come funziona) e
 * si legge il testo che vede la persona.
 */

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isSeller: false, isRider: false, isAuthenticated: false, profile: null, loading: false }),
}));
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));

/** I minuti della veloce, scritti in qualunque modo. */
const MINUTI = /30\s*[-–]\s*60/;
const ALL_ORA_CHE_SCEGLI = "all'ora che scegli";

function testo(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Il testo senza la frase intera, dove i minuti stanno accanto alla loro condizione («quando c'è un
 * fattorino in servizio»): quella è ammessa. Quello che resta non deve promettere minuti.
 */
function senzaLeCondizionate(t: string): string {
  return t.replace(new RegExp(CONSEGNA_FRASE_INTERA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
}

function disegna(c: unknown, props: Record<string, unknown> = {}): string {
  return testo(renderToStaticMarkup(createElement(c as ComponentType<Record<string, unknown>>, props)));
}

/** Un forno vero: aperto dal lunedì al sabato, 8-13, domenica chiuso. */
const FORNO = {
  mon: [['08:00', '13:00']],
  tue: [['08:00', '13:00']],
  wed: [['08:00', '13:00']],
  thu: [['08:00', '13:00']],
  fri: [['08:00', '13:00']],
  sat: [['08:00', '13:00']],
};

describe('le frasi fisse del sito non promettono i 30-60 minuti', () => {
  it('la striscia in testata dice «all’ora che scegli», senza minuti', async () => {
    const { default: PromoTicker } = await import('@/components/PromoTicker');
    const t = disegna(PromoTicker);
    expect(senzaLeCondizionate(t)).not.toMatch(MINUTI);
    expect(t).toContain(ALL_ORA_CHE_SCEGLI);
  });

  it('il piede (motto e striscia di fiducia) non promette minuti', async () => {
    const { default: Footer } = await import('@/components/Footer');
    const t = disegna(Footer);
    expect(senzaLeCondizionate(t)).not.toMatch(MINUTI);
    expect(t).toContain(ALL_ORA_CHE_SCEGLI);
  });

  it('i contatti del negozio non promettono minuti', async () => {
    const { default: ContactSection } = await import('@/components/store-sections/ContactSection');
    const ctx = {
      store: { store_address: 'Via Roma 1, 29121 Piacenza PC', store_phone: '0523 000000', store_name: 'Forno' },
      accent: '#556b2f',
    };
    const t = disegna(ContactSection, { ctx });
    expect(t).not.toMatch(MINUTI);
    expect(t).toContain(ALL_ORA_CHE_SCEGLI);
  });

  it('la pagina Come funziona, e la sua descrizione per Google, non promettono minuti', async () => {
    const mod = await import('@/app/come-funziona/page');
    expect(String(mod.metadata.description)).not.toMatch(MINUTI);
    expect(senzaLeCondizionate(disegna(mod.default))).not.toMatch(MINUTI);
  });

  it('le descrizioni per Google di Chi siamo, Negozi e del sito non promettono minuti', async () => {
    const about = await import('@/app/about/page');
    const negozi = await import('@/app/stores/layout');
    expect(String(about.metadata.description)).not.toMatch(MINUTI);
    expect(String((negozi.metadata as { description?: string }).description)).not.toMatch(MINUTI);
  });
});

describe('la scheda prodotto dice quello che dice la cassa', () => {
  it('sul prodotto esaurito non si scrive nessun tempo di consegna', async () => {
    const { DeliveryCutoff } = await import('@/components/ui/DeliveryCutoff');
    for (const props of [{ esaurito: true, available: false }, { esaurito: true, available: false, storeHours: FORNO }]) {
      expect(disegna(DeliveryCutoff, props), JSON.stringify(props)).toBe('');
    }
  });

  it('niente «2-3 giorni», niente conto fino alle 18, niente «arriva oggi»', async () => {
    const { DeliveryCutoff } = await import('@/components/ui/DeliveryCutoff');
    for (const props of [{ available: false }, { available: true }, { available: true, storeHours: FORNO }]) {
      const t = disegna(DeliveryCutoff, props);
      expect(t, JSON.stringify(props)).not.toMatch(/2-3 giorni|arriva oggi|ordina entro|domani/i);
      expect(t, JSON.stringify(props)).not.toMatch(MINUTI);
      expect(t, JSON.stringify(props)).toContain(ALL_ORA_CHE_SCEGLI);
    }
  });

  it('senza un negozio, la frase è quella di lib/promesse-pubbliche (una copia sola)', async () => {
    const { RIGA_CONSEGNA_SENZA_NEGOZIO } = await import('@/components/ui/DeliveryCutoff');
    const { QUANDO_ARRIVA_SENZA_NEGOZIO } = await import('@/lib/promesse-pubbliche');
    expect(RIGA_CONSEGNA_SENZA_NEGOZIO).toBe(`Consegna ${QUANDO_ARRIVA_SENZA_NEGOZIO}`);
    const src = readFileSync(join(process.cwd(), 'components/ui/DeliveryCutoff.tsx'), 'utf8');
    expect(src).not.toMatch(/'Consegna in giornata, negli orari/);
  });

  it('IL CASO DEL FORNO — sabato 31/10 alle 12:30 non conta cinque ore e mezza: si sceglie l’ora in cassa', async () => {
    const { rigaConsegnaDellaScheda } = await import('@/lib/promessa-consegna');
    const riga = rigaConsegnaDellaScheda({ esaurito: false, orari: FORNO, adesso: new Date(2026, 9, 31, 12, 30), veloce: null });
    expect(riga).toContain(ALL_ORA_CHE_SCEGLI);
    expect(riga).not.toMatch(/entro|18|oggi|domani/);
    expect(riga).not.toMatch(MINUTI);
  });

  it('sabato alle 21:30, domenica chiuso: niente «domani», si dice quando riapre davvero', async () => {
    const { rigaConsegnaDellaScheda } = await import('@/lib/promessa-consegna');
    const riga = rigaConsegnaDellaScheda({ esaurito: false, orari: FORNO, adesso: new Date(2026, 9, 31, 21, 30), veloce: null });
    expect(riga).toContain('riapre lunedì alle 08:00');
    expect(riga).toMatch(/scegli l'ora/);
    expect(riga).not.toMatch(/domani/);
  });

  it('la veloce si nomina solo se la cassa ha detto sì', async () => {
    const { rigaConsegnaDellaScheda } = await import('@/lib/promessa-consegna');
    const aperto = new Date(2026, 9, 30, 10, 0);
    const si = rigaConsegnaDellaScheda({ esaurito: false, orari: FORNO, adesso: aperto, veloce: true });
    expect(si).toMatch(MINUTI);
    expect(si).toContain(ALL_ORA_CHE_SCEGLI);
    for (const veloce of [false, null]) {
      expect(rigaConsegnaDellaScheda({ esaurito: false, orari: FORNO, adesso: aperto, veloce })).not.toMatch(MINUTI);
    }
    expect(rigaConsegnaDellaScheda({ esaurito: true, orari: FORNO, adesso: aperto, veloce: true })).toBeNull();
  });
});

describe('la frase sul pagamento esce dalla cassa', () => {
  it('il giro di benvenuto non dice «paghi come vuoi»: dice la frase dei metodi veri', async () => {
    const { PASSI_DEL_GIRO } = await import('@/components/BuyerOnboardingTour');
    const { frasePagamento } = await import('@/lib/promesse-pubbliche');
    const tutto = PASSI_DEL_GIRO.map((p: { title: string; body: string }) => `${p.title} ${p.body}`).join(' ');
    expect(tutto).not.toMatch(/come vuoi/i);
    expect(tutto).toContain(frasePagamento());
    expect(tutto).not.toMatch(MINUTI);
  });

  it('il titolo della home (variante B) prende la frase da frasePagamento, non «Paghi come vuoi»', () => {
    // app/page.tsx è una pagina di Next: non può esportare la variante, quindi si legge il codice.
    const src = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(src).not.toMatch(/come vuoi/i);
  });
});

describe('il tempo della veloce sta in piedi in bici al confine dei 5 km', () => {
  it('andata al negozio + preparazione + viaggio fino al confine: dentro i 60 minuti', async () => {
    const { deliveryEtaMinutes } = await import('@/lib/geo');
    const { RAGGIO_CONSEGNA_KM, VELOCITA_MEDIA_BICI_KMH } = await import('@/lib/constants');
    const { EXPRESS_ETA_MAX } = await import('@/lib/delivery');
    const andataAlNegozio = (RAGGIO_CONSEGNA_KM / VELOCITA_MEDIA_BICI_KMH) * 60;
    expect(RAGGIO_CONSEGNA_KM).toBe(5);
    expect(deliveryEtaMinutes(RAGGIO_CONSEGNA_KM) + andataAlNegozio).toBeLessThanOrEqual(EXPRESS_ETA_MAX);
  });
});
