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
    <div className="border rounded-lg p-4 space-y-2 hover:shadow-md transition-shadow">
      <h3 className="text-xl font-bold">{name}</h3>
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-indigo-600 hover:underline"
      >
        📍 {lat.toFixed(4)}, {lng.toFixed(4)}
      </a>
      <p className="text-gray-600">📞 {phone}</p>
    </div>
  );
};

export default StoreCard;
