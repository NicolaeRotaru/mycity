import { VALUE_PROPS } from '@/lib/constants';

const ValueProps = () => (
  <div className="bg-white border-y">
    <div className="container mx-auto px-4 py-6 grid grid-cols-2 md:grid-cols-4 gap-4">
      {VALUE_PROPS.map((v) => (
        <div key={v.title} className="flex items-center gap-3">
          <div className="text-3xl shrink-0">{v.icon}</div>
          <div>
            <p className="font-bold text-gray-800 text-sm">{v.title}</p>
            <p className="text-xs text-gray-500">{v.subtitle}</p>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default ValueProps;
