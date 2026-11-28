import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { giornoAPiacenza } from '@/lib/armonia';
import { accentHex, normalizeCustomization, socialLinks } from '@/lib/store-customization';
import { leggiServiziScelti, servizioScelto } from '@/lib/agenzia/servizi-scelti';
import type { BozzaSitoOrdine } from '@/lib/agenzia/sito-dell-ordine-ad';
import { fotoDalNegozio, type DatiSitoFinito } from './costruisci';
import { intervalloDelPrefisso, leggiIndirizzo, percorsoDelSito } from './indirizzo';

/**
 * CHI HA UN SITO ONLINE, E CON QUALI DATI — 28/11/2026. SOLO LATO SERVER.
 *
 * Un sito è online quando l'ordine del negozio ha il sito pronto (`sito_stato = 'pronto'`, scritto dall'AD dopo il sì
 * del titolare) e il sito è fra i servizi scelti. Il negozio sospeso non ha sito. Dalla tabella degli ordini escono
 * solo i testi del sito e la città: mai l'email dell'agente, la nota, il canone o le «cose da confermare» (sono per il
 * team). Dal profilo escono solo i dati che il negozio mostra già nella sua vetrina: nome, telefono del negozio,
 * indirizzo, logo, foto, orari, social, colore.
 */

export type SitoDelCliente =
  | { stato: 'online'; dati: Omit<DatiSitoFinito, 'vetrina'> & { sellerId: string; vetrinaAperta: boolean } }
  | { stato: 'altrove'; percorso: string }
  | { stato: 'nessuno' };

type RigaOrdine = { seller_id: string; nome_attivita: string; dati_attivita: { servizi?: unknown; citta?: string | null } | null; sito: BozzaSitoOrdine | null };
type RigaProfilo = {
  id: string;
  store_phone: string | null;
  store_address: string | null;
  store_logo: string | null;
  store_media: unknown;
  store_hours: unknown;
  store_customization: unknown;
  is_approved: boolean | null;
  approval_status: string | null;
  created_at: string | null;
};

/** L'immagine, se sta nell'archivio Supabase del sito; altrimenti `null`. */
function dalNostroArchivio(u: string | null): string | null {
  if (!u) return null;
  try {
    const nostro = new URL(env.supabaseUrl() ?? '').host;
    const sua = new URL(u);
    return sua.protocol === 'https:' && nostro && sua.host === nostro ? sua.toString() : null;
  } catch {
    return null;
  }
}

export async function leggiSitoDelCliente(pezzo: string): Promise<SitoDelCliente> {
  const letto = leggiIndirizzo(pezzo);
  if (!letto) return { stato: 'nessuno' };
  try {
    const admin = getAdminSupabase();
    const { da, a } = intervalloDelPrefisso(letto.prefisso);
    const ordini = await admin
      .from('ordini_sdg')
      .select('seller_id, nome_attivita, dati_attivita, sito')
      .gte('seller_id', da)
      .lte('seller_id', a)
      .eq('sito_stato', 'pronto')
      .limit(5);
    if (ordini.error || !ordini.data?.length) return { stato: 'nessuno' };
    const righe = ordini.data as unknown as RigaOrdine[];
    // Due negozi con le stesse 8 cifre iniziali: vince quello con il nome giusto, altrimenti nessuno.
    const o = righe.length === 1 ? righe[0] : righe.find((r) => percorsoDelSito(r.seller_id, r.nome_attivita)?.endsWith(`/${pezzo.toLowerCase()}`));
    if (!o || !o.sito || !Array.isArray(o.sito.pagine) || o.sito.pagine.length === 0) return { stato: 'nessuno' };
    if (!servizioScelto(leggiServiziScelti(o.dati_attivita?.servizi, null).servizi, 'sito_web')) return { stato: 'nessuno' };

    const giusto = percorsoDelSito(o.seller_id, o.nome_attivita);
    if (!giusto) return { stato: 'nessuno' };
    if (!giusto.endsWith(`/${pezzo.toLowerCase()}`)) return { stato: 'altrove', percorso: giusto };

    const p = await admin
      .from('profiles')
      .select('id, store_phone, store_address, store_logo, store_media, store_hours, store_customization, is_approved, approval_status, created_at')
      .eq('id', o.seller_id)
      .maybeSingle();
    if (p.error || !p.data) return { stato: 'nessuno' };
    const prof = p.data as unknown as RigaProfilo;
    // Collaudo 28/11: sospeso o respinto (anche il ripiego della cancellazione dell'account mette «rejected»): niente sito.
    if (prof.approval_status === 'suspended' || prof.approval_status === 'rejected') return { stato: 'nessuno' };
    const pers = normalizeCustomization(prof.store_customization);

    return {
      stato: 'online',
      dati: {
        sellerId: o.seller_id,
        vetrinaAperta: prof.is_approved === true,
        nome: o.nome_attivita,
        sottotitolo: o.sito.sottotitolo || o.nome_attivita,
        citta: o.dati_attivita?.citta ?? null,
        indirizzo: prof.store_address?.trim() || null,
        telefono: prof.store_phone?.trim() || null,
        orari: prof.store_hours,
        social: socialLinks(pers).map((s) => ({ label: s.label, href: s.href })),
        // Solo immagini dal nostro Supabase: è l'unica casa di immagini che la politica di sicurezza del sito lascia passare.
        logo: dalNostroArchivio(prof.store_logo),
        foto: fotoDalNegozio(prof.store_media).filter((f) => dalNostroArchivio(f) !== null),
        colore: accentHex(pers),
        // La firma nasce dal giorno d'iscrizione a MyCity, che non cambia (skill «armonia», regola 8).
        nascita: prof.created_at ? giornoAPiacenza(new Date(prof.created_at)) : null,
        pagine: o.sito.pagine,
        base: giusto,
      },
    };
  } catch (e) {
    logger.warn('[sito-finito] lettura non riuscita', { errore: String(e) });
    return { stato: 'nessuno' };
  }
}
