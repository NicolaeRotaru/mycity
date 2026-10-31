'use client';

/**
 * 31/10/2026 — LE SEGNALAZIONI DI CONTENUTI ILLECITI SI POSSONO APRIRE.
 *
 * Il pulsante «Segnala» scrive nella tabella `segnalazioni` e avvisa gli amministratori con un
 * link a `/admin/segnalazioni` — una pagina che non esisteva. Le segnalazioni finivano in un
 * archivio che nessuno poteva aprire, mentre il regolamento europeo sui servizi digitali (DSA,
 * art. 16-17) chiede di esaminarle con tempestività e di chiuderle con una decisione motivata.
 *
 * Qui l'amministrazione le vede (le più vecchie da esaminare in cima) e registra la decisione:
 * «in esame», «accolta» o «respinta». Accolta e respinta pretendono la motivazione: senza, il
 * pulsante resta spento. La scrittura passa dalla regola del database «solo l'amministrazione
 * decide»: se il database non aggiorna nessuna riga, la pagina lo dice invece di dire «fatto».
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { AdminPageTitle } from '@/components/admin/AdminUI';
import { vistaDaQuery } from '@/lib/vista-query';
import type { Colonne } from '@/lib/db-rows';

type Segnalazione = Colonne<
  'segnalazioni',
  'id' | 'tipo' | 'oggetto_id' | 'motivo' | 'dettaglio' | 'email_contatto' | 'segnalante_id'
  | 'stato' | 'esito_motivato' | 'deciso_at' | 'created_at'
>;

type Decisione = 'in_esame' | 'accolta' | 'respinta';
type Filtro = 'da_esaminare' | 'tutte';

const CHIAVE = ['admin', 'segnalazioni'] as const;
const QUANTE = 200;
/** Una motivazione è una frase che il venditore e chi ha segnalato possano capire, non «ok». */
const MOTIVAZIONE_MINIMA = 20;

const NOME_STATO: Record<string, string> = {
  ricevuta: 'Ricevuta',
  in_esame: 'In esame',
  accolta: 'Accolta',
  respinta: 'Respinta',
};

const NOME_MOTIVO: Record<string, string> = {
  contraffatto: 'Contraffatto',
  illecito: 'Illecito',
  pericoloso: 'Pericoloso',
  ingannevole: 'Ingannevole',
  proprieta_intellettuale: 'Proprietà intellettuale',
  odio_o_molestie: 'Odio o molestie',
  altro: 'Altro',
};

function dove(s: Pick<Segnalazione, 'tipo' | 'oggetto_id'>): string | null {
  if (s.tipo === 'prodotto') return `/product/${s.oggetto_id}`;
  if (s.tipo === 'negozio') return `/store/${s.oggetto_id}`;
  return null;
}

function SchedaSegnalazione({ s }: { s: Segnalazione }) {
  const qc = useQueryClient();
  const [decisione, setDecisione] = useState<Decisione>(s.stato === 'ricevuta' ? 'in_esame' : (s.stato as Decisione));
  const [motivazione, setMotivazione] = useState(s.esito_motivato ?? '');
  const serveMotivo = decisione !== 'in_esame';
  const motivoValido = motivazione.trim().length >= MOTIVAZIONE_MINIMA;

  const decidi = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('segnalazioni')
        .update({
          stato: decisione,
          esito_motivato: motivazione.trim() || null,
          deciso_da: user?.id ?? null,
          deciso_at: decisione === 'in_esame' ? null : new Date().toISOString(),
        })
        .eq('id', s.id)
        .select('id');
      if (error) throw error;
      // La regola del database scarta in silenzio una scrittura non permessa: zero righe
      // aggiornate non è «fatto», è «non registrato».
      if (!data || data.length === 0) throw new Error('Decisione non registrata: il database non ha aggiornato la segnalazione.');
    },
    onSuccess: () => {
      toast.success('Decisione registrata');
      qc.invalidateQueries({ queryKey: CHIAVE });
    },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  const link = dove(s);
  return (
    <li className="rounded-xl border bg-white p-4 text-sm" data-segnalazione={s.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-ink-800">
          {NOME_MOTIVO[s.motivo] ?? s.motivo} · {s.tipo}{' '}
          {link ? (
            <Link href={link} className="font-mono text-xs text-primary-700 hover:underline">{s.oggetto_id}</Link>
          ) : (
            <span className="font-mono text-xs text-ink-500">{s.oggetto_id}</span>
          )}
        </p>
        <span className="text-xs text-ink-500">
          {NOME_STATO[s.stato] ?? s.stato} · ricevuta il {formatDate(s.created_at)}
        </span>
      </div>
      {s.dettaglio && <p className="mt-2 whitespace-pre-line text-ink-700">{s.dettaglio}</p>}
      <p className="mt-1 text-xs text-ink-500">
        Chi ha segnalato: {s.segnalante_id ? 'utente registrato' : 'senza account'}
        {s.email_contatto ? ` · ${s.email_contatto}` : ''}
      </p>

      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (serveMotivo && !motivoValido) return;
          decidi.mutate();
        }}
      >
        <label className="block text-xs font-semibold text-ink-600">
          Decisione
          <select
            value={decisione}
            onChange={(e) => setDecisione(e.target.value as Decisione)}
            className="mt-1 block rounded-lg border border-cream-300 px-2 py-1 text-sm"
          >
            <option value="in_esame">In esame</option>
            <option value="accolta">Accolta (il contenuto va tolto)</option>
            <option value="respinta">Respinta</option>
          </select>
        </label>
        <label className="block text-xs font-semibold text-ink-600">
          Motivazione {serveMotivo ? `(obbligatoria, almeno ${MOTIVAZIONE_MINIMA} caratteri)` : '(facoltativa)'}
          <textarea
            value={motivazione}
            onChange={(e) => setMotivazione(e.target.value)}
            maxLength={2000}
            rows={3}
            className="mt-1 block w-full rounded-lg border border-cream-300 px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={decidi.isPending || (serveMotivo && !motivoValido)}
          className="rounded-lg bg-primary-700 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {decidi.isPending ? 'Registro…' : 'Registra la decisione'}
        </button>
      </form>
    </li>
  );
}

export default function AdminSegnalazioniPage() {
  const [filtro, setFiltro] = useState<Filtro>('da_esaminare');

  const lettura = useQuery({
    queryKey: [...CHIAVE, filtro],
    queryFn: async (): Promise<Segnalazione[]> => {
      let q = supabase
        .from('segnalazioni')
        .select('id, tipo, oggetto_id, motivo, dettaglio, email_contatto, segnalante_id, stato, esito_motivato, deciso_at, created_at')
        // Da esaminare: la più vecchia in cima, perché è quella che aspetta da più tempo.
        .order('created_at', { ascending: filtro === 'da_esaminare' })
        .limit(QUANTE);
      if (filtro === 'da_esaminare') q = q.in('stato', ['ricevuta', 'in_esame']);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Segnalazione[];
    },
    refetchInterval: 120_000,
  });

  const vista = vistaDaQuery(lettura);
  const elenco = lettura.data;

  return (
    <div className="space-y-5">
      <AdminPageTitle
        eyebrow="Fiducia"
        title="Segnalazioni"
        sub={
          elenco === undefined
            ? vista.mostraErrore ? 'Non sono riuscito a leggere le segnalazioni' : 'Sto leggendo…'
            : `${elenco.length}${elenco.length >= QUANTE ? '+' : ''} ${filtro === 'da_esaminare' ? 'da esaminare' : 'in tutto'}`
        }
      />

      <div className="flex gap-2 text-sm">
        {(['da_esaminare', 'tutte'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={`rounded-full px-3 py-1.5 font-semibold ${filtro === f ? 'bg-primary-700 text-white' : 'bg-cream-100 text-ink-600'}`}
          >
            {f === 'da_esaminare' ? 'Da esaminare' : 'Tutte'}
          </button>
        ))}
      </div>

      {elenco === undefined && vista.mostraErrore ? (
        <ErrorState
          title="Non riesco a leggere le segnalazioni"
          description="Non vuol dire che non ce ne siano: vuol dire che non le ho potute guardare. Riprova fra un momento."
          retry={() => { void lettura.refetch(); }}
          supportHref={null}
        />
      ) : elenco === undefined ? (
        <LoadingState />
      ) : elenco.length === 0 ? (
        <p className="rounded-xl border bg-white p-6 text-center text-sm text-ink-500">
          {filtro === 'da_esaminare' ? 'Nessuna segnalazione da esaminare.' : 'Nessuna segnalazione.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {elenco.map((s) => <SchedaSegnalazione key={`${s.id}-${s.stato}`} s={s} />)}
        </ul>
      )}
    </div>
  );
}
