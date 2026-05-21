import './globals.css';
import { Inter } from 'next/font/google';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import QueryProvider from '@/components/providers/QueryProvider';
import ToastProvider from '@/components/providers/ToastProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'Piacenza Market',
  description: 'Il mercato locale di Piacenza',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body className={inter.className}>
        <QueryProvider>
          <Navbar />
          <main className="min-h-screen">{children}</main>
          <Footer />
        </QueryProvider>
        <ToastProvider />
      </body>
    </html>
  );
}
