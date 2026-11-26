// GLI AGENTI E I LORO INVITI — 26/11/2026 (migrazione 865).
//
// Nicola: «non ci deve essere da nessuna parte il modo di iscriversi come venditore dentro MyCity … quando io
// creo un link dentro admin … solo chi ha quel link lì può iscriversi». Chi visita i negozi per i servizi SDG
// qui si chiama AGENTE, perché in MyCity «venditore» vuol già dire «negozio».
//
// Il link: <sito>/invito-agente/<codice>, dove il codice sono 256 bit casuali. Nel database c'è solo la sua
// impronta (sha256): chi leggesse la tabella non avrebbe un link valido. Di serie vale per una persona e per
// 14 giorni; Admin lo può ritirare prima. Essere agente = avere una riga attiva in `agenti` (il ruolo del
// profilo non cambia). Tutto con la chiave di servizio: il browser non legge né scrive queste tabelle.

import { createHash, randomBytes } from 'node:crypto';
import { getAdminSupabase } from '@/lib/supabase/server';
import { env } from '@/lib/env';

export const CODICE_INVITO = /^[A-Za-z0-9_-]{43}$/;
export const GIORNI_DI_SERIE = 14;
export const PERCORSO_INVITO = '/invito-agente';

export const improntaCodice = (codice: string) => createHash('sha256').update(codice, 'utf8').digest('hex');
export const nuovoCodice = () => randomBytes(32).toString('base64url');
export const linkInvito = (codice: string) => `${env.appUrl()}${PERCORSO_INVITO}/${codice}`;

export type Invito = { id: string; nota: string | null; creato_il: string; scade_il: string; usi_max: number; usi: number; ritirato_il: string | null };
export type Agente = { user_id: string; email: string; invito_id: string | null; attivo: boolean; creato_il: string; sospeso_il: string | null };

/** Un invito si può usare? (Il controllo vero lo rifà il database, in modo atomico, al momento di usarlo.) */
export function statoInvito(i: Pick<Invito, 'scade_il' | 'usi' | 'usi_max' | 'ritirato_il'> | null, adesso = Date.now()): 'valido' | 'usato' | 'scaduto' | 'ritirato' | 'inesistente' {
  if (!i) return 'inesistente';
  if (i.ritirato_il) return 'ritirato';
  if (new Date(i.scade_il).getTime() <= adesso) return 'scaduto';
  if (i.usi >= i.usi_max) return 'usato';
  return 'valido';
}

export async function creaInvito({ creatoDa, nota, giorni = GIORNI_DI_SERIE, usiMax = 1 }: { creatoDa: string; nota?: string | null; giorni?: number; usiMax?: number }) {
  const codice = nuovoCodice();
  const scade = new Date(Date.now() + Math.min(Math.max(giorni, 1), 60) * 24 * 3600 * 1000).toISOString();
  const { data, error } = await getAdminSupabase().from('inviti_agente')
    .insert({ codice_hash: improntaCodice(codice), nota: nota?.trim().slice(0, 120) || null, creato_da: creatoDa, scade_il: scade, usi_max: Math.min(Math.max(usiMax, 1), 50) })
    .select('id, nota, creato_il, scade_il, usi_max, usi, ritirato_il').single();
  if (error || !data) throw new Error(error?.message ?? 'invito non creato');
  // Il codice in chiaro esce una volta sola, adesso: dopo, nel database resta solo l'impronta.
  return { invito: data as Invito, link: linkInvito(codice) };
}

export async function leggiInvito(codice: string): Promise<Invito | null> {
  if (!CODICE_INVITO.test(codice)) return null;
  const { data, error } = await getAdminSupabase().from('inviti_agente')
    .select('id, nota, creato_il, scade_il, usi_max, usi, ritirato_il').eq('codice_hash', improntaCodice(codice)).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Invito | null) ?? null;
}

/** Usa l'invito (un posto in meno), in modo atomico. `null` se nel frattempo è finito, scaduto o ritirato. */
export async function usaInvito(codice: string): Promise<string | null> {
  if (!CODICE_INVITO.test(codice)) return null;
  const { data, error } = await getAdminSupabase().rpc('usa_invito_agente', { p_codice_hash: improntaCodice(codice) });
  if (error) throw new Error(error.message);
  return typeof data === 'string' && data ? data : null;
}

/** Se l'account non si è creato dopo aver preso il posto, il posto torna libero. */
export async function restituisciInvito(id: string): Promise<void> {
  const admin = getAdminSupabase();
  const { data } = await admin.from('inviti_agente').select('usi').eq('id', id).maybeSingle();
  const usi = (data as { usi?: number } | null)?.usi ?? 0;
  if (usi > 0) await admin.from('inviti_agente').update({ usi: usi - 1 }).eq('id', id).eq('usi', usi);
}

/** Fa diventare agente un account (o lo riattiva, se Nicola gli ha mandato un link nuovo). */
export async function faiAgente({ userId, email, invitoId }: { userId: string; email: string; invitoId: string }): Promise<void> {
  const { error } = await getAdminSupabase().from('agenti')
    .upsert({ user_id: userId, email: email.toLowerCase(), invito_id: invitoId, attivo: true, sospeso_il: null }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

export async function agenteDi(userId: string): Promise<Agente | null> {
  const { data, error } = await getAdminSupabase().from('agenti')
    .select('user_id, email, invito_id, attivo, creato_il, sospeso_il').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Agente | null) ?? null;
}

/** Può usare la pagina dell'agente: un agente attivo, oppure l'admin (Nicola la può provare). */
export async function puoUsareLaScheda(userId: string, ruolo: string | null | undefined): Promise<boolean> {
  if (ruolo === 'admin') return true;
  const a = await agenteDi(userId);
  return !!a?.attivo;
}
