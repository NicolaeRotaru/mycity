'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Sparkles, Loader2, Send, Check, PackagePlus, RotateCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import { avvisoDopoLApplicazione, type AvvisoCopilot } from '@/lib/ai/esitoCopilot';

/**
 * Catalog Copilot — chat: il venditore scrive un'istruzione in linguaggio naturale
 * ("abbassa del 10% l'elettronica") e il copilot propone le modifiche per i prodotti
 * coinvolti, mostrate in una card di anteprima dentro la bolla della risposta.
 * Applica via /api/ai/catalog-apply-bulk (lo stesso apply validato, tutte in una
 * richiesta) dopo conferma. Human-in-the-loop.
 *
 * Design: docs/mockup/ui_kits/seller/src/80-ai.txt → AiCopilot (avatar gradient,
 * stato "Online", bolle utente/assistente, puntini di digitazione, chip suggeriti,
 * anteprime ricche in-linea). Tutta la logica /api/ai/copilot + l'applicazione
 * in blocco resta.
 */

type Change = { product_id: string; name: string; patch: Record<string, unknown> };

type Message =
  | { id: string; role: 'user'; text: string }
  /**
   * `esito`: com'e' andata l'applicazione; c'e' solo dopo «Applica tutte».
   * `rimaste`: le voci che la rotta ha lasciato fuori per il tempo, da rimandare da sole (R10-002).
   */
  | { id: string; role: 'assistant'; text: string; changes: Change[]; esito?: AvvisoCopilot; rimaste?: string[] }
  | { id: string; role: 'typing' };

/** Gli esiti di una scheda finora: il primo invio più i rimandi, per un avviso solo su tutte le voci. */
type EsitiFinora = { applied: number; results: Record<string, unknown>[] };

const esitiDellaRisposta = (json: unknown): Record<string, unknown>[] => {
  const results = (json as { results?: unknown } | null)?.results;
  return (Array.isArray(results) ? results : []).filter(
    (r): r is Record<string, unknown> => !!r && typeof r === 'object',
  );
};

/** Le voci che la risposta da' per scritte (ok: true). */
const scritteDellaRisposta = (json: unknown): string[] =>
  esitiDellaRisposta(json).filter((r) => r.ok === true).map((r) => String(r.productId));

/**
 * R10-002 — Le voci rimaste fuori (`rimaste` della rotta: id dei prodotti non controllati o non
 * scritti in tempo, che la rotta non ha toccato). Solo fra quelle mandate, e mai una gia' scritta.
 */
function rimasteDellaRisposta(json: unknown, mandate: Change[], scritte: Set<string>): string[] {
  const rimaste = (json as { rimaste?: unknown } | null)?.rimaste;
  if (!Array.isArray(rimaste)) return [];
  const mandati = new Set(mandate.map((c) => c.product_id));
  return Array.from(new Set(rimaste.map(String))).filter((id) => mandati.has(id) && !scritte.has(id));
}

const SUGGESTIONS = [
  'Abbassa del 10% l\'elettronica',
  'Metti in bozza gli esauriti',
  'Aggiungi il tag saldi all\'abbigliamento',
  'Alza del 5% i salumi',
];

/** Il muro del limite orario: si distingue dagli altri errori. */
class TroppeRichieste extends Error {}

async function authedFetch(path: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Sessione scaduta');
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (res.status === 429) throw new TroppeRichieste(apiErrorMessage(json, 'Limite raggiunto'));
  if (!res.ok) throw new Error(apiErrorMessage(json, 'Errore'));
  return json;
}

function patchSummary(patch: Record<string, unknown>): string {
  return Object.entries(patch)
    .map(([k, v]) => `${k} → ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join(' · ');
}

let msgSeq = 0;
const nextId = () => `m${++msgSeq}`;

export default function CatalogCopilot() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: nextId(),
      role: 'assistant',
      text: 'Ciao! Sono il tuo copilota catalogo. Dammi un comando sull\'intero catalogo — aggiusto i prezzi, metto in bozza, aggiungo tag e altro. Tu confermi, al resto penso io.',
      changes: [],
    },
  ]);
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * R10-002 — Per scheda: un invio alla volta (un doppio clic non manda due volte), le voci gia'
   * scritte (non si rimandano mai, neanche da un clic rimasto indietro) e gli esiti finora.
   * Nei ref, non nello stato: si leggono e si aggiornano subito, senza aspettare il disegno.
   */
  const inVolo = useRef(new Set<string>());
  const scritte = useRef(new Map<string, Set<string>>());
  const esitiFinora = useRef(new Map<string, EsitiFinora>());

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const ask = async (q?: string) => {
    const text = (q ?? instruction).trim();
    if (!text || loading) return;
    setLoading(true);
    setInstruction('');
    const typingId = nextId();
    setMessages((m) => [
      ...m,
      { id: nextId(), role: 'user', text },
      { id: typingId, role: 'typing' },
    ]);
    try {
      const json = await authedFetch('/api/ai/copilot', { instruction: text });
      const changes: Change[] = Array.isArray(json.changes) ? json.changes : [];
      setMessages((m) => [
        ...m.filter((x) => x.id !== typingId),
        { id: nextId(), role: 'assistant', text: json.reply ?? '', changes },
      ]);
    } catch (err) {
      setMessages((m) => m.filter((x) => x.id !== typingId));
      toast.error(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  /**
   * `soloQueste`: R10-002 — il rimando delle voci rimaste fuori. Stesso invio in blocco, con le
   * stesse modifiche gia' proposte (non ricalcolate), filtrato su quelle voci.
   */
  const applyChanges = async (msgId: string, changes: Change[], soloQueste?: string[]) => {
    if (inVolo.current.has(msgId)) return;
    const giaScritte = scritte.current.get(msgId) ?? new Set<string>();
    const daMandare = changes.filter(
      (c) => (!soloQueste || soloQueste.includes(c.product_id)) && !giaScritte.has(c.product_id),
    );
    if (daMandare.length === 0) return;
    inVolo.current.add(msgId);
    setApplyingId(msgId);
    try {
      /**
       * 27/8/2026 (R157) — DUECENTO MODIFICHE MANDATE UNA ALLA VOLTA.
       *
       * Qui c'era un ciclo che chiamava la rotta di applicazione una volta per
       * prodotto. Quella rotta, a ogni chiamata, rileggeva il prodotto,
       * rileggeva tutte le categorie e — se la modifica toccava nome o
       * descrizione — faceva partire una chiamata al modello per il controllo
       * di conformita'. Sessanta all'ora era il tetto: dalla sessantunesima in
       * poi il server rispondeva «troppe richieste», e «abbassa del 10%
       * l'elettronica» su un catalogo grande diventava un lavoro in tre riprese
       * a un'ora di distanza.
       *
       * Adesso partono tutte insieme, in una richiesta sola. Il server legge i
       * prodotti una volta, fa i controlli di conformita' in parallelo e scrive.
       */
      const json = await authedFetch('/api/ai/catalog-apply-bulk', {
        changes: daMandare.map((c) => ({ productId: c.product_id, patch: c.patch })),
      });
      for (const id of scritteDellaRisposta(json)) giaScritte.add(id);
      scritte.current.set(msgId, giaScritte);
      // Gli esiti delle voci mandate ora prendono il posto dei loro esiti di prima.
      const mandati = new Set(daMandare.map((c) => c.product_id));
      const prima = esitiFinora.current.get(msgId);
      const applied = typeof json?.applied === 'number' ? json.applied : 0;
      const finora: EsitiFinora = {
        applied: (prima?.applied ?? 0) + applied,
        results: [
          ...(prima?.results ?? []).filter((r) => !mandati.has(String(r.productId))),
          ...esitiDellaRisposta(json),
        ],
      };
      esitiFinora.current.set(msgId, finora);
      const rimaste = rimasteDellaRisposta(json, daMandare, giaScritte);
      // Quello che non e' passato non passera' nemmeno riprovando: o non e'
      // un prodotto tuo, o la modifica non era valida, o il controllo sui
      // contenuti l'ha fermata, o (R36) manca qualcosa per metterlo in vendita.
      // Dirlo col nome del prodotto e il motivo, invece di far ritentare a vuoto.
      // R10-002 — Tranne le voci rimaste fuori per il tempo: quelle si rimandano da sole.
      const avviso = avvisoDopoLApplicazione(finora, changes);
      if (avviso.tipo === 'successo') toast.success(avviso.testo);
      else toast.warning(avviso.testo, { duration: 20_000 });
      setMessages((m) =>
        m.map((x) => (x.id === msgId && x.role === 'assistant' ? { ...x, esito: avviso, rimaste } : x)),
      );
    } catch (err) {
      if (err instanceof TroppeRichieste) {
        // Le modifiche NON si segnano come applicate: restano li', pronte per
        // il tentativo dopo.
        toast.warning(
          'Hai raggiunto il limite orario delle applicazioni in blocco. Riprova fra un\'ora — le modifiche restano qui.',
          { duration: 12_000 },
        );
      } else {
        toast.error(friendlyError(err));
      }
    } finally {
      inVolo.current.delete(msgId);
      setApplyingId(null);
    }
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-warm">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-cream-200 px-4 py-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-secondary-600 text-white">
          <Sparkles size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink-900">Copilot del catalogo</p>
          <p className="flex items-center gap-1 text-xs text-olive-600">
            <span className="h-1.5 w-1.5 rounded-full bg-olive-500" aria-hidden /> Online · vede il tuo catalogo
          </p>
        </div>
      </div>

      {/* Conversazione */}
      <div ref={scrollRef} className="flex h-[440px] flex-col gap-3 overflow-y-auto bg-cream-50 p-4">
        {messages.map((m) => {
          if (m.role === 'typing') {
            return (
              <div key={m.id} className="self-start rounded-[14px_14px_14px_4px] border border-cream-300 bg-white px-3.5 py-2.5">
                <span className="inline-flex gap-1" aria-label="Sta scrivendo">
                  <Dot delay="0s" /><Dot delay="0.15s" /><Dot delay="0.3s" />
                </span>
              </div>
            );
          }
          const isUser = m.role === 'user';
          return (
            <div
              key={m.id}
              className={`flex max-w-[88%] flex-col gap-2 ${isUser ? 'self-end items-end' : 'self-start items-start'}`}
            >
              {m.text && (
                <div
                  className={`px-3.5 py-2.5 text-sm leading-relaxed ${
                    isUser
                      ? 'rounded-[14px_14px_4px_14px] bg-primary-700 text-white'
                      : 'rounded-[14px_14px_14px_4px] border border-cream-300 bg-white text-ink-800'
                  }`}
                >
                  {m.text}
                </div>
              )}
              {m.role === 'assistant' && m.changes.length > 0 && (
                <ChangesPreview
                  changes={m.changes}
                  esito={m.esito}
                  applying={applyingId === m.id}
                  onApply={() => void applyChanges(m.id, m.changes)}
                  rimaste={m.rimaste?.length ?? 0}
                  onRimanda={() => void applyChanges(m.id, m.changes, m.rimaste ?? [])}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Chip suggeriti */}
      <div className="flex flex-wrap gap-1.5 border-t border-cream-200 px-3.5 py-2.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void ask(s)}
            disabled={loading}
            className="rounded-full border border-cream-300 bg-white px-3 py-1 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-50 disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-end gap-2 border-t border-cream-200 px-3.5 py-3">
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(); } }}
          rows={1}
          placeholder="Chiedi al copilota…"
          className="max-h-28 flex-1 resize-none rounded-full border border-cream-300 px-4 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-primary-700 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void ask()}
          disabled={loading || !instruction.trim()}
          aria-label="Invia al copilot"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white transition-colors hover:bg-primary-700 disabled:opacity-40"
        >
          {loading ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Send size={18} aria-hidden />}
        </button>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ink-300"
      style={{ animationDelay: delay }}
      aria-hidden
    />
  );
}

/** Anteprima ricca delle modifiche proposte, dentro la bolla dell'assistente. */
function ChangesPreview({
  changes, esito, applying, onApply, rimaste, onRimanda,
}: {
  changes: Change[];
  esito?: AvvisoCopilot;
  applying: boolean;
  onApply: () => void;
  /** R10-002 — Quante voci la rotta ha lasciato fuori per il tempo. */
  rimaste: number;
  onRimanda: () => void;
}) {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-cream-300 bg-white shadow-warm-sm">
      <div className="flex items-center gap-2 border-b border-cream-200 bg-cream-50 px-3.5 py-2.5">
        <PackagePlus size={16} className="text-primary-700" aria-hidden />
        <span className="flex-1 text-sm font-bold text-ink-900">
          {changes.length} {changes.length === 1 ? 'modifica proposta' : 'modifiche proposte'}
        </span>
        <span className="inline-flex items-center rounded-full bg-olive-100 px-2 py-0.5 text-xs font-semibold text-olive-800 ring-1 ring-inset ring-olive-200">
          Anteprima
        </span>
      </div>
      <ul className="max-h-56 overflow-y-auto py-1">
        {changes.map((c) => (
          <li key={c.product_id} className="px-3.5 py-2 text-sm">
            <span className="font-medium text-ink-900">{c.name}</span>
            <span className="text-ink-500"> — {patchSummary(c.patch)}</span>
          </li>
        ))}
      </ul>
      <div className="border-t border-cream-200 px-3.5 py-2.5">
        {/* «Applicato.» col segno verde solo se e' entrato tutto: altrimenti
            resta scritto quello che l'avviso diceva, che a tempo sparisce. */}
        {esito?.tipo === 'successo' ? (
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-olive-600">
            <Check size={16} strokeWidth={2.6} aria-hidden /> Applicato.
          </p>
        ) : esito ? (
          <>
            <p className="text-sm text-ink-800">{esito.testo}</p>
            {/* R10-002 — L'avviso dice «rimandalo»: qui si rimandano solo le voci rimaste fuori. */}
            {rimaste > 0 && (
              <button
                type="button"
                onClick={onRimanda}
                disabled={applying}
                className="mt-2 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
              >
                {applying ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <RotateCw size={16} strokeWidth={2.4} aria-hidden />}
                {rimaste === 1 ? 'Rimanda la voce rimasta fuori' : `Rimanda le ${rimaste} voci rimaste fuori`}
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={onApply}
            disabled={applying}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {applying ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} strokeWidth={2.4} aria-hidden />}
            Applica tutte
          </button>
        )}
      </div>
    </div>
  );
}
