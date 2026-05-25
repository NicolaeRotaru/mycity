import { MapPin, Phone } from 'lucide-react';

interface StoreCardProps {
  id: string;
  name: string;
  lat: number;
  lng: number;
  phone: string;
}

const StoreCard = ({ id, name, lat, lng, phone }: StoreCardProps) => {
  const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

  return (
    <div className="border border-cream-300 rounded-xl p-4 space-y-2 hover:shadow-warm transition-shadow bg-white">
      <h3 className="text-xl font-serif font-bold text-ink-900">{name}</h3>
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-primary-700 hover:underline"
      >
        <MapPin size={14} strokeWidth={2.2} />
        {lat.toFixed(4)}, {lng.toFixed(4)}
      </a>
      <p className="inline-flex items-center gap-1.5 text-ink-600">
        <Phone size={14} strokeWidth={2.2} />
        {phone}
      </p>
    </div>
  );
};

export default StoreCard;
