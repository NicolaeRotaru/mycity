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

const NOME_CANALE: Record<string, string> = {
  segnalanteEmail: "l'email a chi ha segnalato",
  segnalanteNotifica: 'la notifica a chi ha segnalato',
  venditore: "l'avviso al venditore",
};

/** I canali che la rotta dell'esito dichiara caduti (`'fallita'`). */
function canaliFalliti(corpo: Record<string, unknown> | null): string[] {
  if (!corpo) return [];
  return Object.keys(NOME_CANALE).filter((k) => corpo[k] === 'fallita').map((k) => NOME_CANALE[k]);
}

function messaggioEsitoNonPartito(canali: string[]): string {
  if (canali.length === 0) {
    return "L'esito non è partito a chi ha segnalato e al venditore: registra di nuovo la decisione per rimandarlo.";
  }
  return `L'esito non è partito: ${canali.join(', ')}. Registra di nuovo la decisione per rimandare solo ${canali.length === 1 ? 'quello' : 'quelli'}.`;
}

function dove(s: Pick<Segnalazione, 'tipo' | 'oggetto_id'>): string | null {
  if (s.tipo === 'prodotto') return `/product/${s.oggetto_id}`;
  if (s.tipo === 'negozio') return `/store/${s.oggetto_id}`;
  return null;
}

type RecensioneSegnalata = { di: 'prodotto' | 'negozio'; link: string | null; voto: number; testo: string | null; scritta: string | null };

/**
 * 27/11/2026 (R01-006) — LO STAFF DECIDE VEDENDO LA RECENSIONE.
 *
 * Per una recensione c'era solo il codice: niente link, niente testo, e non si sapeva nemmeno se
 * era di un prodotto o di un negozio (sono due tabelle). La legge la rotta delle segnalazioni,
 * che risponde solo agli amministratori.
 */
function RecensioneDaDecidere({ id }: { id: string }) {
  const lettura = useQuery({
    queryKey: [...CHIAVE, 'recensione', id],
    queryFn: async (): Promise<RecensioneSegnalata | null> => {
      const r = await fetch(`/api/segnalazioni?recensione=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error('Recensione non letta');
      const corpo = (await r.json().catch(() => null)) as { recensione?: RecensioneSegnalata | null } | null;
      return corpo?.recensione ?? null;
    },
  });
  if (lettura.isPending) return <p className="mt-2 text-xs text-ink-500">Sto leggendo la recensione…</p>;
  if (lettura.isError) {
    return <p className="mt-2 text-xs text-red-700">Non sono riuscito a leggere la recensione segnalata: riprova fra poco.</p>;
  }
  const rec = lettura.data;
  if (!rec) return <p className="mt-2 text-xs text-ink-500">La recensione non c&apos;è più: è già stata tolta.</p>;
  return (
    <div className="mt-2 rounded-lg border border-cream-200 bg-cream-50 p-2" data-recensione-segnalata={id}>
      <p className="text-xs font-semibold text-ink-600">
        Recensione {rec.di === 'prodotto' ? 'di un prodotto' : 'di un negozio'} · {rec.voto}/5
        {rec.scritta ? ` · ${formatDate(rec.scritta)}` : ''}
        {rec.link && (
          <>
            {' · '}
            <Link href={rec.link} className="text-primary-700 hover:underline">
              {rec.di === 'prodotto' ? 'apri il prodotto' : 'apri il negozio'}
            </Link>
          </>
        )}
      </p>
      <p className="mt-1 whitespace-pre-line break-words [overflow-wrap:anywhere] text-ink-700">
        {rec.testo?.trim() || '(senza testo: solo il voto)'}
      </p>
    </div>
  );
}

function SchedaSegnalazione({ s }: { s: Segnalazione }) {
  const qc = useQueryClient();
  const [decisione, setDecisione] = useState<Decisione>(s.stato === 'ricevuta' ? 'in_esame' : (s.stato as Decisione));
  const [motivazione, setMotivazione] = useState(s.esito_motivato ?? '');
  const serveMotivo = decisione !== 'in_esame';
  // R02-003 — Si può accogliere solo ciò che da qui si sa togliere: il prodotto (va in bozza) e
  // il negozio (si sospende). Recensioni e messaggi non hanno ancora un'azione di rimozione.
  // 27/11/2026 (R01-013) — Anche la domanda sotto un prodotto: accogliere la nasconde.
  const puoTogliere = s.tipo === 'prodotto' || s.tipo === 'negozio' || s.tipo === 'domanda';
  const motivoValido = motivazione.trim().length >= MOTIVAZIONE_MINIMA;

  const decidi = useMutation({
    mutationFn: async () => {
      // 12/11/2026 (R02-003) — «Accolta» toglie davvero il contenuto, PRIMA di registrare la
      // decisione: l'esito che parte dopo dice «rimosso», e deve essere vero. Se togliere non
      // riesce, la decisione non si salva e non parte niente.
      if (decisione === 'accolta' && s.tipo === 'prodotto') {
        const r = await fetch('/api/admin/segnalazioni/accogli', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: s.id }),
        });
        if (!r.ok) throw new Error('Il prodotto non è stato tolto: decisione non registrata. Riprova.');
      }
      if (decisione === 'accolta' && s.tipo === 'negozio') {
        // Si sospende solo un negozio che è online (approvato). Già sospeso, in attesa o respinto
        // vuol dire che dalla vetrina è già fuori: la decisione si registra senza risospenderlo
        // (la rotta di moderazione risponderebbe 400 e la decisione non entrerebbe mai).
        const { data: negozio, error: erroreNegozio } = await supabase
          .from('profiles')
          .select('approval_status')
          .eq('id', s.oggetto_id)
          .maybeSingle();
        // 26/11/2026 — Una lettura caduta non dice che il negozio e' fuori dalla vetrina: prima
        // si saltava la sospensione e «accolta» si registrava col negozio ancora online.
        if (erroreNegozio) throw new Error('Non sono riuscito a leggere lo stato del negozio: decisione non registrata. Riprova.');
        if ((negozio as { approval_status?: string } | null)?.approval_status === 'approved') {
          if (!window.confirm('Accogliere la segnalazione sospende il negozio. Confermi?')) {
            throw new Error('Decisione annullata: il negozio resta attivo.');
          }
          const r = await fetch(`/api/admin/users/${s.oggetto_id}/moderate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // La rotta di moderazione accetta un motivo di al massimo 500 caratteri.
            body: JSON.stringify({ action: 'suspend', reason: motivazione.trim().slice(0, 500) }),
          });
          if (!r.ok) throw new Error('Il negozio non è stato sospeso: decisione non registrata. Riprova.');
        }
      }
      if (decisione === 'accolta' && s.tipo === 'domanda') {
        // 27/11/2026 (R01-013) — Una domanda segnalata si nascondeva solo dalla pagina del prodotto,
        // e da qui non si poteva accogliere. Ora «Accolta» la nasconde (is_public = false: la regola
        // qa_admin_nasconde della migrazione 364) PRIMA di registrare la decisione, come per il
        // prodotto. Zero righe toccate: se la domanda c'è ancora non è stata nascosta, e ci si
        // ferma; se non c'è più (cancellata da chi l'ha scritta) è già fuori e si va avanti.
        const { data: nascoste, error: erroreDomanda } = await supabase
          .from('product_questions')
          .update({ is_public: false })
          .eq('id', s.oggetto_id)
          .select('id');
        if (erroreDomanda) throw new Error('La domanda non è stata nascosta: decisione non registrata. Riprova.');
        if (!nascoste || nascoste.length === 0) {
          const { data: ancora, error: erroreLettura } = await supabase
            .from('product_questions')
            .select('id')
            .eq('id', s.oggetto_id)
            .maybeSingle();
          if (erroreLettura || ancora) throw new Error('La domanda non è stata nascosta: decisione non registrata. Riprova.');
        }
      }
      if (decisione === 'accolta' && !puoTogliere) {
        throw new Error('Per questo tipo di contenuto non c\'è ancora un modo di toglierlo da qui.');
      }
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
      // 01/11/2026 — collaudo finale. La decisione si salvava e basta: chi aveva
      // segnalato e il venditore non ricevevano niente (DSA art. 16.5 e 17), e i
      // Termini promettono «ti scriviamo com'e' andata e perche'». Con una
      // decisione presa, la rotta manda l'esito a entrambi.
      if (decisione === 'in_esame') return { comunicato: true, canaliFalliti: [] as string[] };
      try {
        const r = await fetch('/api/segnalazioni', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: s.id }),
        });
        // R06-014 — la rotta dice quale canale è caduto: lo si legge per nominarlo nel messaggio.
        const corpo = (await r.json().catch(() => null)) as Record<string, unknown> | null;
        return { comunicato: r.ok, canaliFalliti: canaliFalliti(corpo) };
      } catch {
        return { comunicato: false, canaliFalliti: [] as string[] };
      }
    },
    onSuccess: (esito) => {
      toast.success('Decisione registrata');
      if (esito?.comunicato === false) {
        toast.error(messaggioEsitoNonPartito(esito.canaliFalliti ?? []));
      }
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
      {/* R02-021 — Un link lungo incollato da chi segnala usciva dalla scheda e allargava la pagina sul telefono. */}
      {s.dettaglio && <p className="mt-2 whitespace-pre-line break-words [overflow-wrap:anywhere] text-ink-700">{s.dettaglio}</p>}
      {s.tipo === 'recensione' && <RecensioneDaDecidere id={s.oggetto_id} />}
      <p className="mt-1 text-xs text-ink-500">
        Chi ha segnalato: {s.segnalante_id ? 'utente registrato' : 'senza account'}
        {s.email_contatto ? ` · ${s.email_contatto}` : ''}
      </p>

      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (serveMotivo && !motivoValido) return;
          // Un doppio invio nello stesso istante faceva due salvataggi e due esiti.
          if (decidi.isPending) return;
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
            <option value="accolta" disabled={!puoTogliere}>
              {s.tipo === 'prodotto'
                ? 'Accolta: il prodotto esce dalla vetrina'
                : s.tipo === 'negozio'
                ? 'Accolta: il negozio viene sospeso'
                : s.tipo === 'domanda'
                ? 'Accolta: la domanda viene nascosta'
                : 'Accolta (non disponibile: questo contenuto non si toglie da qui)'}
            </option>
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
