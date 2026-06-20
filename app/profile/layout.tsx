import AccountShell from '@/components/account/AccountShell';

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
