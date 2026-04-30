import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Providers } from './providers';
import { WalletButton } from '@/components/WalletButton';

export const metadata: Metadata = {
  title: 'DeFund — Decentralized Crowdfunding',
  description: 'A hybrid DApp built for CN6035 — pledge ETH on Sepolia.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Providers>
          <header className="border-b border-gray-200 dark:border-gray-800">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                DeFund
              </Link>
              <nav className="flex items-center gap-4 text-sm">
                <Link href="/campaigns/new" className="hover:underline">
                  New campaign
                </Link>
                <WalletButton />
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-5xl px-4 py-6 text-xs text-gray-500">
            DeFund — CN6035 coursework. Source on{' '}
            <a className="underline" href="https://github.com/">
              GitHub
            </a>
            .
          </footer>
        </Providers>
      </body>
    </html>
  );
}
