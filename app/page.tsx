import Link from 'next/link';

export default function Home() {
  return (
    <div className="container mx-auto p-8 text-center space-y-6">
      <h1 className="text-4xl font-bold text-indigo-700">Benvenuto su Piacenza Market</h1>
      <p className="text-gray-600 text-lg max-w-xl mx-auto">
        Il mercato locale digitale di Piacenza. Trova prodotti locali o inizia a vendere.
      </p>
      <div className="flex justify-center gap-4">
        <Link
          href="/sell"
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
        >
          Inizia a vendere
        </Link>
        <Link
          href="/sign-up"
          className="border border-indigo-600 text-indigo-600 hover:bg-indigo-50 px-6 py-3 rounded-lg font-semibold transition-colors"
        >
          Registrati
        </Link>
      </div>
    </div>
  );
}
