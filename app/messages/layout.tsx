import AccountShell from '@/components/account/AccountShell';

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
