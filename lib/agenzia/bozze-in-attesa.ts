import { getAdminSupabase } from '@/lib/supabase/server';
import { aspettaLaBozza, senzaPrezzoTranneOrari, type InAttesa } from './bozza-sito-ad';
import { leggiSchedaSalvata, prodottiTipici, senzaPrezzo, vociSenzaPrezzo } from './scheda-cliente';
import { schedaEPagellaAperte, schedaPerIlSito } from './scheda-dopo-abbonamento';

/**
 * I NEGOZI CHE ASPETTANO LA BOZZA DEL SITO — 24/11/2026.
 *
 * Una lettura sola per la pagina admin «Bozze del sito» (così l'AD sa chi fare nel suo giro) e per
 * l'elenco che lo script dell'AD legge (GET /api/agenzia/bozza-sito). La regola di chi aspetta è in
 * `aspettaLaBozza` (lib/agenzia/bozza-sito-ad.ts), senza rete.
 *
 * Con `conIDati` porta anche quello che serve per scrivere la bozza, solo dati pubblici del locale:
 * nome, tipo, indirizzo del negozio, descrizione, i nomi dei prodotti (mai i prezzi), e dalla scheda
 * di n8n i campi con stato e fonte, tolti il telefono (può essere il cellulare del titolare) e il
 * testo del menu (al suo posto i prodotti tipici, senza righe con prezzi).
 */

const TETTO_NEGOZI = 1000;
const QUANTI_CON_I_DATI = 25;
const PRODOTTI_PER_NEGOZIO = 30;
const STATI_IN_CATALOGO = ['available', 'draft', 'out_of_stock', 'pending_approval'];

export type NegozioInAttesa = {
  id_attivita: string;
  nome: string;
  tipo: string | null;
  perche: Extract<InAttesa, { aspetta: true }>['perche'];
  in_revisione: boolean;
  scheda_il: string | null;
  bozza_il: string | null;
  dati?: {
    indirizzo: string | null;
    descrizione: string | null;
    prodotti: string[];
    prodotti_tipici: string[];
    campi_della_scheda: Record<string, { valore: string; stato: string; fonte: string | null }>;
    punti_di_forza: string[];
  };
};

export async function negoziCheAspettanoLaBozza(opzioni: { conIDati?: boolean } = {}): Promise<NegozioInAttesa[]> {
  const admin = getAdminSupabase();
  const [negozi, bozze, schede, visibili, abbonamenti] = await Promise.all([
    admin
      .from('profiles')
      .select('id, role, store_name, business_type, store_address, store_description, store_customization, approval_status, created_at')
      .eq('role', 'seller')
      .order('created_at', { ascending: false })
      .limit(TETTO_NEGOZI),
    admin.from('bozze_sito').select('id_attivita, ricevuta_il').limit(TETTO_NEGOZI),
    admin.from('schede_clienti').select(opzioni.conIDati ? 'id_attivita, aggiornata_il, scheda' : 'id_attivita, aggiornata_il').limit(TETTO_NEGOZI),
    // 25/11/2026 — La scheda di n8n si usa solo dopo l'abbonamento (lib/agenzia/scheda-dopo-abbonamento.ts):
    // per chi è in demo l'AD scrive la bozza con l'analisi e la vetrina, senza i campi della scheda.
    // Due letture facoltative: se cadono, la scheda resta chiusa per tutti.
    opzioni.conIDati
      ? admin.from('profiles').select('id, visibile_senza_abbonamento').eq('role', 'seller').limit(TETTO_NEGOZI)
      : Promise.resolve({ data: [], error: null }),
    // Sempre: serve anche a sapere quando la scheda si è aperta, e quindi se la bozza va rifatta.
    admin.from('abbonamenti_servizi').select('seller_id, stato, creato_il').limit(TETTO_NEGOZI * 5),
  ]);
  if (negozi.error) throw new Error(`negozi non letti: ${negozi.error.message}`);
  if (bozze.error) throw new Error(`bozze non lette: ${bozze.error.message}`);
  // La scheda è facoltativa (migrazione 708): senza, si va avanti senza dati di n8n.
  const bozzaIl = new Map(((bozze.data ?? []) as { id_attivita: string; ricevuta_il: string }[]).map((b) => [b.id_attivita, b.ricevuta_il]));
  const schedePerId = new Map(
    ((schede.error ? [] : schede.data ?? []) as unknown as { id_attivita: string; aggiornata_il: string; scheda?: unknown }[]).map((s) => [s.id_attivita, s]),
  );

  const visibileSenzaAbbonamento = new Set(
    ((visibili.error ? [] : visibili.data ?? []) as Array<{ id: string; visibile_senza_abbonamento?: unknown }>)
      .filter((r) => r.visibile_senza_abbonamento === true)
      .map((r) => r.id),
  );
  const statiPerNegozio = new Map<string, unknown[]>();
  // Il primo abbonamento pagato di ogni negozio: lì la scheda si è aperta.
  const apertaIl = new Map<string, string>();
  for (const r of (abbonamenti.error ? [] : abbonamenti.data ?? []) as Array<{ seller_id: string; stato: unknown; creato_il?: string | null }>) {
    statiPerNegozio.set(r.seller_id, [...(statiPerNegozio.get(r.seller_id) ?? []), r.stato]);
    const quando = typeof r.creato_il === 'string' ? r.creato_il : null;
    if (quando && schedaEPagellaAperte({ visibileSenzaAbbonamento: false, statiAbbonamenti: [r.stato] })) {
      const prima = apertaIl.get(r.seller_id);
      if (!prima || new Date(quando).getTime() < new Date(prima).getTime()) apertaIl.set(r.seller_id, quando);
    }
  }
  const aperta = (id: string) =>
    schedaEPagellaAperte({ visibileSenzaAbbonamento: visibileSenzaAbbonamento.has(id), statiAbbonamenti: statiPerNegozio.get(id) });

  const inAttesa: NegozioInAttesa[] = [];
  for (const p of (negozi.data ?? []) as Array<Record<string, unknown>>) {
    const id = String(p.id);
    const socials = (p.store_customization as { socials?: { website?: unknown } } | null)?.socials;
    const sito = typeof socials?.website === 'string' ? socials.website : null;
    const scheda = schedePerId.get(id);
    const esito = aspettaLaBozza({ id, ruolo: String(p.role), sito, bozzaIl: bozzaIl.get(id) ?? null, schedaIl: scheda?.aggiornata_il ?? null, schedaApertaIl: apertaIl.get(id) ?? null });
    if (!esito.aspetta) continue;
    inAttesa.push({
      id_attivita: id,
      nome: String(p.store_name ?? '').trim() || 'Senza nome',
      tipo: (p.business_type as string | null) ?? null,
      perche: esito.perche,
      in_revisione: p.approval_status === 'pending',
      scheda_il: scheda?.aggiornata_il ?? null,
      bozza_il: bozzaIl.get(id) ?? null,
      ...(opzioni.conIDati ? { dati: datiPubblici(p, scheda?.scheda, aperta(id)) } : {}),
    });
  }
  if (!opzioni.conIDati) return inAttesa;

  // I nomi dei prodotti solo per i primi negozi dell'elenco: lo script ne fa al massimo tanti per giro.
  const primi = inAttesa.slice(0, QUANTI_CON_I_DATI);
  await Promise.all(
    primi.map(async (n) => {
      const r = await admin.from('products').select('name').eq('seller_id', n.id_attivita).in('status', STATI_IN_CATALOGO).limit(PRODOTTI_PER_NEGOZIO);
      if (!r.error && n.dati) {
        n.dati.prodotti = ((r.data ?? []) as { name: string | null }[])
          .map((x) => (x.name ?? '').trim())
          .filter((x) => x.length >= 2 && senzaPrezzo(x));
      }
    }),
  );
  return primi;
}

function datiPubblici(p: Record<string, unknown>, grezza: unknown, aperta: boolean): NonNullable<NegozioInAttesa['dati']> {
  const scheda = schedaPerIlSito(leggiSchedaSalvata(grezza), aperta);
  const campi: NonNullable<NegozioInAttesa['dati']>['campi_della_scheda'] = {};
  for (const [nome, c] of Object.entries(scheda?.campi ?? {})) {
    if (nome === 'telefono' || nome === 'menu_testo') continue;
    const valore = typeof c.valore === 'string' ? c.valore.trim() : '';
    if (!valore || !senzaPrezzoTranneOrari(valore)) continue; // gli orari hanno «8.30»: non sono prezzi
    // Un link WhatsApp o un numero lungo può essere il cellulare del titolare: all'AD non va.
    if (/wa\.me|whatsapp|\+?\d[\d\s.-]{7,}\d/i.test(valore.replace(/\b\d{1,2}[.:]\d{2}\b/g, ' '))) continue;
    campi[nome] = { valore: valore.slice(0, 600), stato: c.stato, fonte: c.fonte ?? null };
  }
  return {
    indirizzo: (p.store_address as string | null) ?? null,
    descrizione: typeof p.store_description === 'string' && senzaPrezzo(p.store_description)
      // Un telefono o un'email scritti nella descrizione non escono: possono essere del titolare.
      ? p.store_description.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/\+?\d[\d\s.-]{7,}\d/g, '[telefono]').slice(0, 1500)
      : null,
    prodotti: [],
    prodotti_tipici: prodottiTipici(scheda, 12),
    campi_della_scheda: campi,
    punti_di_forza: vociSenzaPrezzo(scheda?.analisi?.punti_di_forza, 6, 240),
  };
}
