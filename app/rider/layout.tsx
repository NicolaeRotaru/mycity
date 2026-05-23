import RiderSidebar from '@/components/RiderSidebar';

export default function RiderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
      <RiderSidebar />
      <main>{children}</main>
    </div>
  );
}
