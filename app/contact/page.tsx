'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import Honeypot from '@/components/Honeypot';
import { friendlyError } from '@/lib/errors';
import { Button } from '@/components/ui/Button';

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', subject: 'Domanda generale', message: '' });
  const [sending, setSending] = useState(false);
  const honeypotRef = useRef('');
  const startedAtRef = useRef(Date.now());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      toast.error('Compila tutti i campi obbligatori');
      return;
    }
    // Bot guards
    if (honeypotRef.current) { toast.success('Messaggio inviato! Ti risponderemo entro 24h.'); return; }
    if (Date.now() - startedAtRef.current < 2000) { toast.success('Messaggio inviato!'); return; }

    setSending(true);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, company: honeypotRef.current }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Invio non riuscito');
      }
      toast.success('Messaggio inviato! Ti risponderemo entro 24h lavorative.');
      setForm({ name: '', email: '', subject: 'Domanda generale', message: '' });
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="container mx-auto px-6 py-10 max-w-5xl">
      <div className="text-center mb-10">
        <h1 className="text-3xl md:text-4xl font-extrabold text-ink-900 mb-3">Contattaci</h1>
        <p className="text-ink-600">Siamo qui per aiutarti. Scegli il canale più comodo o usa il form qui sotto.</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-10">
        <a href="mailto:info@mycity.it" className="bg-white border border-cream-300 rounded-xl p-5 hover:shadow-md hover:border-primary-300 transition-all">
          <div className="text-3xl mb-2">📧</div>
          <div className="font-bold">Email</div>
          <div className="text-sm text-ink-600">info@mycity.it</div>
          <div className="text-xs text-ink-500 mt-1">Risposta entro 24h</div>
        </a>
        <a href="https://wa.me/393000000000" target="_blank" rel="noopener noreferrer" className="bg-white border border-cream-300 rounded-xl p-5 hover:shadow-md hover:border-green-300 transition-all">
          <div className="text-3xl mb-2">💬</div>
          <div className="font-bold">WhatsApp</div>
          <div className="text-sm text-ink-600">+39 300 000 0000</div>
          <div className="text-xs text-ink-500 mt-1">Lun-Ven 9–18</div>
        </a>
        <a href="tel:+390523000000" className="bg-white border border-cream-300 rounded-xl p-5 hover:shadow-md hover:border-primary-300 transition-all">
          <div className="text-3xl mb-2">📞</div>
          <div className="font-bold">Telefono</div>
          <div className="text-sm text-ink-600">+39 0523 000000</div>
          <div className="text-xs text-ink-500 mt-1">Lun-Ven 9–18</div>
        </a>
      </div>

      <div className="grid md:grid-cols-5 gap-8">
        <div className="md:col-span-3 bg-white border border-cream-300 rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-4">Scrivici un messaggio</h2>
          <form onSubmit={submit} className="space-y-4">
            <Honeypot value={honeypotRef.current} onChange={(v) => (honeypotRef.current = v)} name="company" />
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nome *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-primary-400"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full border rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-primary-400"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Argomento</label>
              <select
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="w-full border rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-primary-400"
              >
                <option>Domanda generale</option>
                <option>Problema con un ordine</option>
                <option>Voglio diventare venditore</option>
                <option>Voglio diventare rider</option>
                <option>Reclamo</option>
                <option>Privacy / GDPR</option>
                <option>Stampa e media</option>
                <option>Altro</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Messaggio *</label>
              <textarea
                rows={5}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                className="w-full border rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
                required
              />
            </div>
            <p className="text-xs text-ink-500">
              Inviando il messaggio accetti la nostra <Link href="/privacy" className="text-primary-700 underline">Privacy Policy</Link>.
            </p>
            <Button type="submit" loading={sending} fullWidth size="lg">
              {sending ? 'Invio in corso...' : '✉️ Invia messaggio'}
            </Button>
          </form>
        </div>

        <aside className="md:col-span-2 space-y-4">
          <div className="bg-gradient-to-br from-primary-50 to-purple-50 border border-primary-100 rounded-2xl p-6">
            <h3 className="font-bold text-ink-900 mb-2">📍 Sede</h3>
            <p className="text-sm text-ink-700 leading-relaxed">
              MyCity S.r.l.<br />
              Via Roma 1<br />
              29121 Piacenza (PC)<br />
              Italia
            </p>
            <hr className="my-4 border-primary-100" />
            <p className="text-xs text-ink-600">
              P.IVA / C.F. IT00000000000<br />
              REA PC-000000<br />
              PEC: mycity@pec.it
            </p>
          </div>

          <div className="bg-white border border-cream-300 rounded-2xl p-6">
            <h3 className="font-bold text-ink-900 mb-3">🕐 Orari assistenza</h3>
            <ul className="text-sm text-ink-700 space-y-1">
              <li className="flex justify-between"><span>Lunedì - Venerdì</span><span className="font-semibold">9:00 - 18:00</span></li>
              <li className="flex justify-between"><span>Sabato</span><span className="font-semibold">10:00 - 14:00</span></li>
              <li className="flex justify-between text-ink-400"><span>Domenica</span><span>Chiuso</span></li>
            </ul>
          </div>

          <Link href="/faq" className="block bg-accent-50 border border-accent-200 rounded-2xl p-5 hover:bg-accent-100 transition-colors">
            <div className="font-bold text-ink-900 mb-1">💡 Forse trovi prima qui</div>
            <div className="text-sm text-ink-700">Consulta le domande frequenti →</div>
          </Link>
        </aside>
      </div>
    </div>
  );
}
