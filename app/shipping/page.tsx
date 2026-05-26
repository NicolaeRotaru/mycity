import Link from 'next/link';

export const metadata = {
  title: 'Spedizioni e consegne · MyCity',
  description: 'Tempi, costi e modalità di consegna su MyCity.',
};

export default function ShippingPage() {
  return (
    <div className="container mx-auto px-6 py-10 max-w-3xl">
      <div className="mb-8 text-center">
        <h1 className="text-3xl md:text-4xl font-extrabold text-ink-900 mb-3">🚚 Spedizioni e consegne</h1>
        <p className="text-ink-600">Tempi, costi e opzioni per ricevere il tuo ordine.</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mb-10">
        <div className="bg-olive-50 border border-olive-200 rounded-xl p-5 text-center">
          <div className="text-3xl mb-2">🎁</div>
          <div className="font-bold text-green-900">Spedizione GRATIS</div>
          <div className="text-sm text-olive-700 mt-1">Per ordini ≥ €30 dallo stesso venditore</div>
        </div>
        <div className="bg-primary-50 border border-primary-200 rounded-xl p-5 text-center">
          <div className="text-3xl mb-2">⚡</div>
          <div className="font-bold text-primary-900">Consegna 24-48h</div>
          <div className="text-sm text-primary-800 mt-1">Nei comuni serviti</div>
        </div>
        <div className="bg-secondary-50 border border-secondary-200 rounded-xl p-5 text-center">
          <div className="text-3xl mb-2">🏪</div>
          <div className="font-bold text-secondary-900">Ritiro in negozio</div>
          <div className="text-sm text-secondary-700 mt-1">10% di sconto sull'ordine</div>
        </div>
      </div>

      <section className="prose prose-gray max-w-none space-y-6 text-ink-700 leading-relaxed">
        <div>
          <h2 className="text-xl font-bold text-ink-900 mb-2">Tempi di consegna</h2>
          <p>La maggior parte degli ordini viene consegnata in <strong>24-48 ore</strong> dalla conferma da parte del
          venditore. Per ordini effettuati prima delle 12:00 nei giorni feriali, molti venditori consegnano in giornata.</p>
          <ul className="list-disc pl-5">
            <li>Ordine entro le 12:00 → consegna in giornata o il giorno successivo</li>
            <li>Ordine dopo le 12:00 → consegna entro 48h</li>
            <li>Weekend e festivi → consegna il primo giorno feriale successivo</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-bold text-ink-900 mb-2">Costi di spedizione</h2>
          <p>Il costo dipende dalla distanza dal negozio e dal venditore:</p>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-cream-50 text-left">
                  <th className="border p-2 font-semibold">Distanza</th>
                  <th className="border p-2 font-semibold">Costo medio</th>
                  <th className="border p-2 font-semibold">Sopra €30</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border p-2">0 - 2 km</td>
                  <td className="border p-2">€ 2,50</td>
                  <td className="border p-2 text-olive-700 font-semibold">GRATIS</td>
                </tr>
                <tr>
                  <td className="border p-2">2 - 5 km</td>
                  <td className="border p-2">€ 3,50</td>
                  <td className="border p-2 text-olive-700 font-semibold">GRATIS</td>
                </tr>
                <tr>
                  <td className="border p-2">5 - 10 km</td>
                  <td className="border p-2">€ 4,50</td>
                  <td className="border p-2 text-olive-700 font-semibold">GRATIS</td>
                </tr>
                <tr>
                  <td className="border p-2">Oltre 10 km</td>
                  <td className="border p-2">A preventivo</td>
                  <td className="border p-2">—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm">Il costo esatto è sempre mostrato al checkout prima di confermare.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold text-ink-900 mb-2">Ritiro in negozio</h2>
          <p>Scegliendo il ritiro in negozio ottieni <strong>il 10% di sconto</strong> sull'intero ordine e non paghi
          spese di spedizione. Riceverai una notifica appena l'ordine sarà pronto.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold text-ink-900 mb-2">Tracciamento</h2>
          <p>Da <Link href="/orders" className="text-primary-700 underline">"I miei ordini"</Link> vedi in tempo reale:</p>
          <ul className="list-disc pl-5">
            <li>🕒 In attesa di conferma</li>
            <li>👨‍🍳 In preparazione presso il venditore</li>
            <li>📦 Pronto per il ritiro / la consegna</li>
            <li>🛵 In consegna (con nome del rider)</li>
            <li>✅ Consegnato</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-bold text-ink-900 mb-2">Aree servite</h2>
          <p>Attualmente operiamo a <strong>Piacenza</strong> e nei comuni limitrofi entro 15 km. Stiamo espandendo
          progressivamente. Inserendo il tuo indirizzo al checkout sapremo se siamo già nella tua zona.</p>
        </div>

        <div>
          <h2 className="text-xl font-bold text-ink-900 mb-2">Problemi con la consegna?</h2>
          <p>Se la consegna è in ritardo, il pacco è danneggiato o non arrivato, contatta il nostro supporto entro 48h:
          <Link href="/contact" className="text-primary-700 underline ml-1">vai ai contatti</Link>.</p>
        </div>
      </section>
    </div>
  );
}
