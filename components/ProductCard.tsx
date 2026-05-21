import Image from 'next/image';

interface ProductCardProps {
  id: string;
  name: string;
  description: string;
  price: number;
  images?: string[];
  onAddToCart?: (id: string) => void;
}

const ProductCard = ({ id, name, description, price, images, onAddToCart }: ProductCardProps) => {
  return (
    <div className="border rounded-lg p-4 space-y-2 hover:shadow-md transition-shadow">
      {images && images.length > 0 && (
        <div className="relative w-full h-48">
          <Image src={images[0]} alt={name} fill className="object-cover rounded" />
        </div>
      )}
      <h3 className="text-xl font-bold">{name}</h3>
      <p className="text-gray-600 text-sm">{description}</p>
      <div className="flex justify-between items-center pt-2">
        <span className="text-lg font-semibold text-indigo-600">€{price.toFixed(2)}</span>
        {onAddToCart && (
          <button
            onClick={() => onAddToCart(id)}
            className="bg-pink-500 hover:bg-pink-600 text-white px-3 py-1 rounded text-sm transition-colors"
          >
            Aggiungi al carrello
          </button>
        )}
      </div>
    </div>
  );
};

export default ProductCard;
