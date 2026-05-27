'use client';

import Link from 'next/link';
import type { ChangeEvent, FormEvent } from 'react';

/**
 * Form indirizzo di consegna per checkout.
 *
 * Estratto da app/checkout/page.tsx per ridurre il monolite.
 * Riceve form state + handlers come props (controlled component).
 */

export type AddressForm = {
  fullName: string;
  address: string;
  city: string;
  zip: string;
  phone: string;
  notes: string;
};

export type SavedAddress = {
  id: string;
  label?: string;
  address: string;
  city: string;
  is_default: boolean;
  // Campi opzionali (presenti quando l'address arriva da user_addresses)
  full_name?: string;
  zip?: string;
  phone?: string;
  notes?: string | null;
  lat?: number | null;
  lng?: number | null;
};

type Props = {
  form: AddressForm;
  savedAddresses: SavedAddress[];
  onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onSubmit: (e: FormEvent) => void;
  onApplySavedAddress: (id: string) => void;
};

export function ShippingAddressForm({
  form,
  savedAddresses,
  onChange,
  onSubmit,
  onApplySavedAddress,
}: Props) {
  return (
    <div className="bg-white border rounded-xl p-6 space-y-4">
      <h2 className="text-xl font-bold flex items-center gap-2">📍 Indirizzo di consegna</h2>

      {savedAddresses.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-1">
            Indirizzo salvato
          </label>
          <select
            onChange={(e) => onApplySavedAddress(e.target.value)}
            className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400"
          >
            {savedAddresses.map((a) => (
              <option key={a.id} value={a.id}>
                📍 {a.label} — {a.address}, {a.city}
                {a.is_default ? ' (predefinito)' : ''}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-400 mt-1">
            Oppure modifica i campi sotto. <Link href="/profile/addresses" className="text-primary-700 hover:underline">Gestisci indirizzi</Link>
          </p>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4" id="checkout-form">
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-1">Nome e cognome</label>
          <input type="text" name="fullName" value={form.fullName} onChange={onChange}
            placeholder="Mario Rossi"
            className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400" />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-1">Indirizzo</label>
          <input type="text" name="address" value={form.address} onChange={onChange}
            placeholder="Via Roma 1"
            className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">Città</label>
            <input type="text" name="city" value={form.city} onChange={onChange}
              className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">CAP</label>
            <input type="text" name="zip" value={form.zip} onChange={onChange}
              className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-1">Telefono</label>
          <input type="tel" name="phone" value={form.phone} onChange={onChange}
            placeholder="3331234567"
            className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400" />
          <p className="text-xs text-ink-400 mt-1">Il rider ti chiamerà se serve per la consegna</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-1">
            Note per il rider <span className="text-ink-400 font-normal">(opzionale)</span>
          </label>
          <textarea name="notes" value={form.notes} onChange={onChange}
            rows={2}
            placeholder="Es. citofono Rossi, suonare al 2° piano…"
            className="w-full border p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none" />
        </div>
      </form>
    </div>
  );
}
