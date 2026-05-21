'use client';

import Link from 'next/link';
import Image from 'next/image';
import { addToCart } from '@/lib/cart';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';

interface ProductCardProps {
  id: string;
  name: string;
  description?: string;
  price: number;
  images?: string[];
  rating?: number;
}

const ProductCard = ({ id, name, description, price, images, rating }: ProductCardProps) => {
  const img = images?.[0] ?? 'https://placehold.co/400x400/eee/aaa?text=Foto';

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    addToCart({ id, name, price, image: img });
    toast.success(`${name} aggiunto al carrello`);
  };

  return (
    <Link
      href={`/product/${id}`}
      className="group bg-white border rounded-lg overflow-hidden hover:shadow-lg transition-shadow flex flex-col"
    >
      <div className="relative w-full h-48 bg-gray-100 overflow-hidden">
        <Image
          src={img}
          alt={name}
          fill
          className="object-cover group-hover:scale-105 transition-transform"
          unoptimized
        />
      </div>
      <div className="p-3 flex flex-col flex-1">
        <h3 className="font-semibold text-gray-800 line-clamp-2 mb-1">{name}</h3>
        {rating !== undefined && (
          <p className="text-yellow-500 text-sm mb-1">
            {'★'.repeat(Math.round(rating))}{'☆'.repeat(5 - Math.round(rating))}
          </p>
        )}
        {description && <p className="text-gray-500 text-xs line-clamp-2 mb-2">{description}</p>}
        <div className="mt-auto flex justify-between items-center pt-2">
          <span className="text-lg font-bold text-indigo-700">{formatPrice(price)}</span>
          <button
            onClick={handleAdd}
            className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 text-xs font-bold px-3 py-1.5 rounded-full transition-colors"
          >
            + Carrello
          </button>
        </div>
      </div>
    </Link>
  );
};

export default ProductCard;
