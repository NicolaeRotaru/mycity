import SellerSidebar from '@/components/SellerSidebar';

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
      <SellerSidebar />
      <main>{children}</main>
    </div>
  );
}
