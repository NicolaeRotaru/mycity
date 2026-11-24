import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import {
  ABBONAMENTI,
  costruisciPreventivo,
  leggiImpostazioniAgenzia,
  impostazioniSenzaPrezzi,
  type Abbonamento,
  type AbbonamentoAttivo,
  type Preventivo,
} from '@/lib/agenzia/preventivo';
import { tipoDelProfilo } from '@/lib/agenzia/tipi-attivita';

/**
 * IL PREVENTIVO LETTO DAL DATABASE — una funzione sola per la dashboard (/api/seller/preventivo) e
 * per la pagina col codice (/preventivo/<codice>, 24/11/2026): lo stesso calcolo, gli stessi dati.
 * Sta qui da quando serve a due strade; prima era dentro la rotta della dashboard.
 */

/** I prodotti che contano per «senza foto»: quelli ancora in catalogo. */
const STATI_IN_CATALOGO = ['available', 'draft', 'out_of_stock', 'pending_approval'];

/** Un negozio con migliaia di schede non deve far leggere tutto: oltre questo numero si conta fin qui. */
const TETTO_PRODOTTI = 2000;

export type Letti = { preventivo: Preventivo; telefono: string | null; socials: unknown };

/**
 * L'abbonamento dei servizi attivo, dalla lettura della tabella. Una lettura caduta, o la tabella
 * che non c'è ancora (migrazione 706 non applicata), vale «nessuno»: la pagina mostra la cassa, e
 * la cassa stessa si ferma se la tabella non si legge (`paga/route.ts`).
 */
function abbonamentoAttivo(r: { data: unknown; error: { message: string } | null }): AbbonamentoAttivo | null {
  if (r.error) {
    logger.warn('[preventivo] abbonamento dei servizi non letto', { message: r.error.message });
    return null;
  }
  const riga = (r.data as Array<{ fascia: string; stato: string; rinnovo_il: string | null }> | null)
    ?.find((x) => x.stato === 'active' || x.stato === 'past_due');
  if (!riga || !(ABBONAMENTI as readonly string[]).includes(riga.fascia)) return null;
  if (riga.stato !== 'active' && riga.stato !== 'past_due') return null;
  return { fascia: riga.fascia as Abbonamento, stato: riga.stato, rinnovoIl: riga.rinnovo_il };
}

export async function leggiPreventivo(idAttivita: string, scelto?: Abbonamento): Promise<Letti> {
  const admin = getAdminSupabase();
  const [profilo, prodotti, impostazioni, abbonamento] = await Promise.all([
    admin
      .from('profiles')
      .select('*')
      .eq('id', idAttivita)
      .maybeSingle(),
    admin
      .from('products')
      .select('images')
      .eq('seller_id', idAttivita)
      .in('status', STATI_IN_CATALOGO)
      .limit(TETTO_PRODOTTI),
    admin.from('site_settings').select('agenzia').eq('id', 1).maybeSingle(),
    // 24/11/2026 — L'abbonamento dei servizi già pagato, se c'è (migrazione 706).
    admin
      .from('abbonamenti_servizi')
      .select('fascia, stato, rinnovo_il')
      .eq('seller_id', idAttivita)
      .order('creato_il', { ascending: false })
      .limit(20),
  ]);
  if (profilo.error) throw new Error(`profilo non letto: ${profilo.error.message}`);
  if (!profilo.data) throw new Error('profilo non trovato');
  // «Non ho letto i prodotti» non è «non hai prodotti»: senza questa riga un catalogo
  // di quaranta schede senza foto risulterebbe a posto.
  if (prodotti.error) throw new Error(`prodotti non letti: ${prodotti.error.message}`);
  // Le impostazioni dell'agenzia sono facoltative. Riga vuota, o migrazione 703 non ancora
  // applicata (la colonna non c'è): valgono il nome e il listino scritti nel codice.
  // Qualunque altro errore di lettura: tutti i prezzi «su richiesta». Se Nicola ha tolto un
  // prezzo dalle impostazioni, un guasto di lettura non deve rimetterlo davanti al cliente.
  const colonnaAncoraAssente = impostazioni.error && ['42703', 'PGRST204'].includes(String(impostazioni.error.code));
  if (impostazioni.error) {
    logger.warn(
      colonnaAncoraAssente
        ? '[preventivo] colonna site_settings.agenzia assente (migrazione 703): vale il listino del codice'
        : '[preventivo] impostazioni dell agenzia non lette: prezzi su richiesta',
      { message: impostazioni.error.message },
    );
  }

  // `select('*')`: le colonne del tipo di attività arrivano con la migrazione 703, e chiederle
  // per nome prima di quella farebbe fallire la lettura. Con `*` ci sono se ci sono.
  const p = profilo.data as Record<string, unknown>;
  const personalizzazione = p.store_customization as { socials?: unknown } | null | undefined;
  const socials = personalizzazione?.socials ?? null;
  const preventivo = costruisciPreventivo({
    idAttivita,
    nomeAttivita: String(p.store_name ?? ''),
    tipoAttivita: tipoDelProfilo(p.business_type),
    dati: {
      storeLogo: (p.store_logo as string | null) ?? null,
      storeMedia: p.store_media,
      prodotti: (prodotti.data ?? []) as { images: unknown }[],
      socials,
    },
    impostazioni: impostazioni.error
      ? colonnaAncoraAssente ? leggiImpostazioniAgenzia(null) : impostazioniSenzaPrezzi()
      : leggiImpostazioniAgenzia(impostazioni.data?.agenzia),
    adesso: new Date(),
    scelto,
    attivo: abbonamentoAttivo(abbonamento),
    // Chi ha già avuto un abbonamento dei servizi non ha più il primo mese a metà (lo rifiuta anche la cassa).
    primoMeseScontato: abbonamento.error ? true : ((abbonamento.data as unknown[] | null) ?? []).length === 0,
  });
  const telefono = (p.store_phone as string | null) || (p.phone as string | null) || null;
  return { preventivo, telefono, socials };
}

