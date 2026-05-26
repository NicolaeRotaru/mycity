interface CartItemProps {
  id: string;
  name: string;
  price: number;
  quantity: number;
  onRemove?: (id: string) => void;
  onQuantityChange?: (id: string, quantity: number) => void;
}

const CartItem = ({ id, name, price, quantity, onRemove, onQuantityChange }: CartItemProps) => {
  return (
    <div className="border rounded-lg p-4 flex justify-between items-center">
      <div>
        <h3 className="text-lg font-bold">{name}</h3>
        <span className="text-primary-700 font-semibold">€{price.toFixed(2)}</span>
      </div>
      <div className="flex items-center gap-3">
        {onQuantityChange && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onQuantityChange(id, Math.max(1, quantity - 1))}
              className="w-7 h-7 rounded-full border flex items-center justify-center hover:bg-cream-100"
            >
              −
            </button>
            <span className="font-semibold w-6 text-center">{quantity}</span>
            <button
              onClick={() => onQuantityChange(id, quantity + 1)}
              className="w-7 h-7 rounded-full border flex items-center justify-center hover:bg-cream-100"
            >
              +
            </button>
          </div>
        )}
        {onRemove && (
          <button
            onClick={() => onRemove(id)}
            className="text-red-500 hover:text-red-700 text-sm transition-colors"
          >
            Rimuovi
          </button>
        )}
      </div>
    </div>
  );
};

export default CartItem;
