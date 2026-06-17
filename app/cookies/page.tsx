'use client';

import Link from 'next/link';
import { openConsentBanner } from '@/components/CookieBanner';
import { Cookie } from 'lucide-react';

const VERSION = '2.0';
const EFFECTIVE_DATE = '24 maggio 2026';

export default function CookiesPage() {
  return (
    <div className="container mx-auto px-6 py-10 max-w-3xl">
      <div className="mb-8">
        <Link href="/" className="text-sm text-primary-700 hover:underline">← Home</Link>
        <h1 className="text-3xl md:text-4xl font-extrabold text-ink-900 mt-2 mb-2">Cookie policy</h1>
        <p className="text-sm text-ink-500">Versione {VERSION} — in vigore dal {EFFECTIVE_DATE}</p>
      </div>

      <div className="space-y-6 text-ink-700 leading-relaxed">
        <section>
          <h2 className="text-xl font-bold text-ink-900 mb-2">1. Cosa sono i cookie</h2>
          <p>
            I cookie sono piccoli file di testo che i siti memorizzano sul tuo dispositivo per
            farlo funzionare, ricordare le tue preferenze o raccogliere statistiche. Oltre ai
            cookie usiamo tecnologie simili (localStorage, sessionStorage, pixel) che soggiacciono
            alle stesse regole di consenso ai sensi dell&apos;art. 122 D.Lgs. 196/2003 e delle{' '}
            <a
              href="https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/9677876"
              target="_blank" rel="noopener noreferrer"
              className="text-primary-700 underline"
            >
              Linee guida cookie del Garante (2021)
            </a>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-900 mb-2">2. Tipologie di cookie usati</h2>

          <h3 className="font-semibold text-ink-900 mt-4 mb-2">2.1 Cookie tecnici (sempre attivi)</h3>
          <p>
            Necessari al funzionamento del sito. Non richiedono consenso preventivo.
          </p>
          <CookieTable rows={[
            { name: 'sb-*-auth-token', purpose: 'Sessione utente (Supabase Auth)', duration: '1 settimana', provider: 'Prima parte' },
            { name: 'mc_consent', purpose: 'Memorizza le tue scelte sui cookie', duration: '6 mesi', provider: 'Prima parte' },
            { name: '__cf_bm', purpose: 'Anti-bot Cloudflare (sicurezza)', duration: '30 minuti', provider: 'Cloudflare' },
            { name: 'cf-turnstile-*', purpose: 'CAPTCHA Turnstile', duration: 'Sessione', provider: 'Cloudflare' },
            { name: '__stripe_mid / __stripe_sid', purpose: 'Anti-frode pagamenti', duration: '1 anno / 30 min', provider: 'Stripe' },
          ]} />

          <h3 className="font-semibold text-ink-900 mt-4 mb-2">2.2 Cookie funzionali (richiede consenso)</h3>
          <p>Memorizzano preferenze come lingua, ultima ricerca, mappa salvata.</p>
          <CookieTable rows={[
            { name: 'mc_pref_*', purpose: 'Preferenze UI (lingua, dark mode)', duration: '1 anno', provider: 'Prima parte' },
          ]} />

          <h3 className="font-semibold text-ink-900 mt-4 mb-2">2.3 Cookie di analisi (richiede consenso)</h3>
          <p>
            Statistiche aggregate anonime sull&apos;uso del sito. Configurati con IP anonimizzato
            e senza condivisione con piattaforme pubblicitarie.
          </p>
          <CookieTable rows={[
            { name: '_ga / _ga_*', purpose: 'Statistiche di utilizzo (se attivato)', duration: '14 mesi', provider: 'Google Analytics 4' },
          ]} />

          <h3 className="font-semibold text-ink-900 mt-4 mb-2">2.4 Cookie di marketing (richiede consenso)</h3>
          <p>
            Annunci personalizzati e remarketing. Attualmente <strong>non installati</strong>;
            la sezione resta a documentare l&apos;eventuale futura attivazione.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-900 mb-2">3. Come gestire le preferenze</h2>
          <p>
            Puoi modificare le tue scelte in qualunque momento riaprendo il banner cookie:
          </p>
          <button
            type="button"
            onClick={openConsentBanner}
            className="mt-2 inline-flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800"
          >
            <Cookie size={18} aria-hidden /> Apri preferenze cookie
          </button>
          <p className="mt-3 text-sm">
            In alternativa puoi disabilitare i cookie dalle impostazioni del browser:
            {' '}<a className="text-primary-700 underline" href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer">Chrome</a>,
            {' '}<a className="text-primary-700 underline" href="https://support.mozilla.org/it/kb/Attivare%20e%20disattivare%20i%20cookie" target="_blank" rel="noopener noreferrer">Firefox</a>,
            {' '}<a className="text-primary-700 underline" href="https://support.apple.com/it-it/guide/safari/sfri11471/mac" target="_blank" rel="noopener noreferrer">Safari</a>,
            {' '}<a className="text-primary-700 underline" href="https://support.microsoft.com/it-it/microsoft-edge/eliminare-i-cookie-in-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09" target="_blank" rel="noopener noreferrer">Edge</a>.
          </p>
          <p className="text-sm">
            Disabilitare i cookie tecnici impedirà il funzionamento corretto del sito (login,
            carrello, sicurezza).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-900 mb-2">4. Trasferimenti extra-UE</h2>
          <p>
            Alcuni provider hanno sede negli Stati Uniti (Cloudflare, Google, Stripe Inc.,
            Anthropic, Resend). I trasferimenti sono coperti dalle Standard Contractual Clauses
            adottate dalla Commissione Europea con Decisione 2021/914.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-ink-900 mb-2">5. Aggiornamenti</h2>
          <p>
            Aggiorniamo questa policy ogni volta che vengono aggiunti, rimossi o modificati cookie
            o tecnologie di tracciamento. Conserviamo le versioni precedenti su richiesta a{' '}
            <a href="mailto:dpo@mycity.it" className="text-primary-700 underline">dpo@mycity.it</a>.
          </p>
        </section>

        <section>
          <p className="text-sm">
            Per maggiori informazioni sul trattamento dei tuoi dati consulta l&apos;
            <Link href="/privacy" className="text-primary-700 underline">Informativa sulla privacy</Link>.
          </p>
        </section>
      </div>

      <div className="mt-10 p-4 bg-accent-50 border border-accent-200 rounded-lg text-xs text-accent-900">
        <strong>Avviso legale:</strong> elenco e descrizione dei cookie vanno aggiornati ogni volta
        che si integra o si rimuove un provider terzo. Auditare periodicamente con strumenti tipo
        Cookie-Script o iubenda.
      </div>
    </div>
  );
}

function CookieTable({ rows }: { rows: Array<{ name: string; purpose: string; duration: string; provider: string }> }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border border-cream-300 text-sm">
        <thead className="bg-cream-50">
          <tr>
            <th className="border px-3 py-2 text-left">Cookie</th>
            <th className="border px-3 py-2 text-left">Finalità</th>
            <th className="border px-3 py-2 text-left">Durata</th>
            <th className="border px-3 py-2 text-left">Provider</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="border px-3 py-2 font-mono text-xs">{r.name}</td>
              <td className="border px-3 py-2">{r.purpose}</td>
              <td className="border px-3 py-2">{r.duration}</td>
              <td className="border px-3 py-2">{r.provider}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
