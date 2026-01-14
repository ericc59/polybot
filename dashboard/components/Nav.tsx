'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Nav() {
  const pathname = usePathname();

  const links = [
    { href: '/', label: 'Overview' },
    { href: '/wallets', label: 'Wallets' },
    { href: '/trades', label: 'Live Trades' },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded bg-[var(--accent-primary)] flex items-center justify-center">
            <span className="text-black font-bold text-sm">PS</span>
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors">
              POLYSPY
            </span>
            <span className="ml-2 text-xs text-[var(--text-muted)] font-mono">DASHBOARD</span>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link ${pathname === link.href ? 'active' : ''}`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)]">
            <span className="w-2 h-2 rounded-full bg-[var(--positive)] pulse"></span>
            LIVE
          </div>
        </div>
      </div>
    </nav>
  );
}
