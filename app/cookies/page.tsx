import Link from 'next/link';

export const metadata = {
  title: 'Cookie policy · MyCity',
  description: 'Informativa estesa sull\'uso dei cookie su MyCity.',
};

export default function CookiesPage() {
  return (
    <div className="container mx-auto px-6 py-10 max-w-3xl">
      <div className="mb-8">
        <Link href="/" className="text-sm text-indigo-600 hover:underline">← Home</Link>
        <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 mt-2 mb-2">Cookie policy</h1>
        <p className="text-sm text-gray-500">Ultimo aggiornamento: 1° gennaio 2026</p>
      </div>

      <div className="prose prose-gray max-w-none space-y-6 text-gray-700 leading-relaxed">
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Cosa sono i cookie</h2>
          <p>I cookie sono piccoli file di testo che i siti web salvano sul tuo dispositivo per memorizzare informazioni
          (ad esempio: preferenze, sessione, statistiche di utilizzo).</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Cookie che utilizziamo</h2>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="border p-2 font-semibold">Cookie</th>
                  <th className="border p-2 font-semibold">Tipo</th>
                  <th className="border p-2 font-semibold">Durata</th>
                  <th className="border p-2 font-semibold">Finalità</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border p-2 font-mono text-xs">sb-*</td>
                  <td className="border p-2">Tecnico</td>
                  <td className="border p-2">Sessione</td>
                  <td className="border p-2">Autenticazione utente (Supabase)</td>
                </tr>
                <tr>
                  <td className="border p-2 font-mono text-xs">mycity_cart</td>
                  <td className="border p-2">Tecnico</td>
                  <td className="border p-2">30 giorni</td>
                  <td className="border p-2">Conserva il carrello tra sessioni</td>
                </tr>
                <tr>
                  <td className="border p-2 font-mono text-xs">mycity_prefs</td>
                  <td className="border p-2">Funzionale</td>
                  <td className="border p-2">12 mesi</td>
                  <td className="border p-2">Preferenze utente (notifiche, lingua)</td>
                </tr>
                <tr>
                  <td className="border p-2 font-mono text-xs">_ga, _gid</td>
                  <td className="border p-2">Analitico (3a parte)</td>
                  <td className="border p-2">2 anni / 24h</td>
                  <td className="border p-2">Statistiche anonime di utilizzo</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Cookie tecnici e funzionali</h2>
          <p>Sono indispensabili per il funzionamento del sito (login, carrello, sicurezza). Non richiedono consenso e
          non possono essere disattivati senza compromettere il servizio.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Cookie analitici</h2>
          <p>Ci aiutano a capire come gli utenti usano la piattaforma per migliorarla. Vengono usati solo previo tuo
          consenso e con IP anonimizzato.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Cookie di profilazione / marketing</h2>
          <p>Attualmente <strong>non utilizziamo</strong> cookie di profilazione o pubblicitari di terze parti.
          Se in futuro li introdurremo, te lo notificheremo e raccoglieremo un nuovo consenso.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Come gestire i cookie</h2>
          <p>Puoi modificare le tue preferenze in qualsiasi momento dal banner cookie (icona in basso a sinistra) oppure
          dalle impostazioni del tuo browser:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">Google Chrome</a></li>
            <li><a href="https://support.mozilla.org/it/kb/Gestione%20dei%20cookie" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">Mozilla Firefox</a></li>
            <li><a href="https://support.apple.com/it-it/guide/safari/sfri11471" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">Safari</a></li>
            <li><a href="https://support.microsoft.com/it-it/microsoft-edge" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">Microsoft Edge</a></li>
          </ul>
          <p>Disattivare i cookie tecnici può impedire il corretto funzionamento del sito.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Contatti</h2>
          <p>Per domande sui cookie scrivi a <a href="mailto:privacy@mycity.it" className="text-indigo-600 underline">privacy@mycity.it</a>.</p>
        </section>
      </div>
    </div>
  );
}
