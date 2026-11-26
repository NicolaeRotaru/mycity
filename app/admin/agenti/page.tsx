'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';

/**
 * GLI AGENTI — 26/11/2026 (migrazione 865). Chi visita i negozi per proporre i servizi di SDG entra in MyCity
 * solo da un link creato qui: non c'è nessun'altra porta. Il link si vede una volta sola, appena creato: va
 * copiato e mandato all'agente (WhatsApp o di persona). Di serie vale per una persona e per 14 giorni.
 */
type StatoInvito = 'valido' | 'usato' | 'scaduto' | 'ritirato' | 'inesistente';
type Invito = { id: string; nota: string | null; creato_il: string; scade_il: string; usi_max: number; usi: number; ritirato_il: string | null; stato: StatoInvito };
type Agente = { user_id: string; email: string; attivo: boolean; creato_il: string; sospeso_il: string | null };

const STATO: Record<StatoInvito, string> = { valido: 'Da usare', usato: 'Usato', scaduto: 'Scaduto', ritirato: 'Ritirato', inesistente: '—' };
const quando = (d: string | null) => (d ? new Date(d).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' }) : '—');

async function chiama<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const corpo = (await r.json().catch(() => null)) as { ok?: boolean; data?: T; error?: { message?: string } } | null;
  if (!r.ok || !corpo?.ok) throw new Error(corpo?.error?.message ?? 'Operazione non riuscita');
  return corpo.data as T;
}

export default function Agenti() {
  const coda = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['admin', 'agenti'], queryFn: () => chiama<{ agenti: Agente[]; inviti: Invito[] }>('/api/admin/agenti') });
  const [nota, setNota] = useState('');
  const [nuovo, setNuovo] = useState<{ link: string; nota: string | null } | null>(null);
  const [occupato, setOccupato] = useState(false);

  const aggiorna = () => coda.invalidateQueries({ queryKey: ['admin', 'agenti'] });
  const copia = (link: string) => navigator.clipboard.writeText(link).then(() => toast.success('Link copiato'), () => toast.error('Non sono riuscito a copiarlo: selezionalo e copialo a mano'));

  async function crea() {
    setOccupato(true);
    try {
      const d = await chiama<{ link: string; invito: Invito }>('/api/admin/agenti', { method: 'POST', body: JSON.stringify({ nota: nota.trim() || null }) });
      setNuovo({ link: d.link, nota: d.invito.nota });
      setNota('');
      aggiorna();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Link non creato'); } finally { setOccupato(false); }
  }
  async function modifica(corpo: Record<string, string>, fatto: string) {
    try { await chiama('/api/admin/agenti', { method: 'PATCH', body: JSON.stringify(corpo) }); toast.success(fatto); aggiorna(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Non salvato'); }
  }

  if (isLoading) return <LoadingState />;
  return (
    <div className="max-w-4xl p-4">
      <h1 className="font-serif text-2xl font-extrabold text-ink-900">Agenti</h1>
      <p className="mt-1 text-sm text-ink-600">
        Gli agenti visitano i negozi e propongono i servizi di SDG. Entrano solo dal link che crei qui: con il link creano il loro account
        e aprono la pagina della scheda del cliente (incollano il link di Google Maps, premono «Analizza»). Ogni link vale per una persona e per 14 giorni.
      </p>

      <section className="mt-5 rounded-xl border border-cream-200 bg-surface-0 p-4">
        <h2 className="font-semibold text-ink-900">Crea un link d’invito</h2>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[14rem] flex-1 flex-col text-xs text-ink-600">
            Per chi è (facoltativo, lo vedi solo tu)
            <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={120} placeholder="Es. Marco, zona centro" className="mt-1 rounded-lg border border-cream-300 px-3 py-2 text-sm text-ink-900" />
          </label>
          <button type="button" disabled={occupato} onClick={crea} className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            {occupato ? 'Creo…' : 'Crea il link'}
          </button>
        </div>
        {nuovo && (
          <div className="mt-3 rounded-lg bg-cream-100 p-3">
            <p className="text-xs font-semibold text-ink-900">Link nuovo{nuovo.nota ? ` per ${nuovo.nota}` : ''}: copialo adesso, dopo non si vede più.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="max-w-full break-all rounded bg-surface-0 px-2 py-1 text-xs">{nuovo.link}</code>
              <button type="button" className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-bold text-white" onClick={() => copia(nuovo.link)}>Copia il link</button>
            </div>
          </div>
        )}
      </section>

      {error && <p role="alert" className="mt-4 text-sm text-secondary-700">{error instanceof Error ? error.message : 'Lettura non riuscita'}</p>}

      <section className="mt-6">
        <h2 className="font-semibold text-ink-900">Agenti ({data?.agenti.length ?? 0})</h2>
        {data && data.agenti.length === 0 && <p className="mt-2 text-sm text-ink-600">Nessun agente, per ora.</p>}
        <ul className="mt-2 space-y-2">
          {data?.agenti.map((a) => (
            <li key={a.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cream-200 bg-surface-0 p-3">
              <div>
                <p className="font-semibold text-ink-900">{a.email}</p>
                <p className="text-xs text-ink-600">{a.attivo ? 'Attivo' : `Sospeso ${quando(a.sospeso_il)}`} · entrato {quando(a.creato_il)}</p>
              </div>
              {a.attivo
                ? <button type="button" className="rounded-lg border border-cream-300 px-3 py-1.5 text-xs font-bold text-ink-900" onClick={() => modifica({ azione: 'sospendi', userId: a.user_id }, 'Agente sospeso')}>Sospendi</button>
                : <button type="button" className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-bold text-white" onClick={() => modifica({ azione: 'riattiva', userId: a.user_id }, 'Agente riattivato')}>Riattiva</button>}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold text-ink-900">Link d’invito</h2>
        {data && data.inviti.length === 0 && <p className="mt-2 text-sm text-ink-600">Nessun link creato.</p>}
        <ul className="mt-2 space-y-2">
          {data?.inviti.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cream-200 bg-surface-0 p-3">
              <div>
                <p className="font-semibold text-ink-900">{i.nota || 'Senza nota'} · {STATO[i.stato]}</p>
                <p className="text-xs text-ink-600">Creato {quando(i.creato_il)} · scade {quando(i.scade_il)} · usato {i.usi} su {i.usi_max}{i.ritirato_il ? ` · ritirato ${quando(i.ritirato_il)}` : ''}</p>
              </div>
              {i.stato === 'valido' && (
                <button type="button" className="rounded-lg border border-cream-300 px-3 py-1.5 text-xs font-bold text-ink-900" onClick={() => modifica({ azione: 'ritira', id: i.id }, 'Link ritirato')}>Ritira</button>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-600">Il link si vede solo quando lo crei: nel database resta solo la sua impronta. Se l’hai perso, ritiralo e creane uno nuovo.</p>
      </section>
    </div>
  );
}
