'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';

type Bot = {
  id: string;
  name: string;
  icon: string;
  basePath: string;
  links: { href: string; label: string }[];
};

const bots: Bot[] = [
  {
    id: 'copy-trading',
    name: 'Copy Trading',
    icon: '📋',
    basePath: '',
    links: [
      { href: '/', label: 'Overview' },
      { href: '/wallets', label: 'Wallets' },
      { href: '/trades', label: 'Live Trades' },
    ],
  },
  {
    id: 'tennis',
    name: 'Tennis Walkover',
    icon: '🎾',
    basePath: '/tennis',
    links: [
      { href: '/tennis', label: 'Overview' },
      { href: '/tennis/matches', label: 'Matches' },
      { href: '/tennis/trades', label: 'Trades' },
      { href: '/tennis/api', label: 'Odds API' },
    ],
  },
  {
    id: 'sports',
    name: 'Sports Betting',
    icon: '🏀',
    basePath: '/sports',
    links: [
      { href: '/sports', label: 'Overview' },
      { href: '/sports/positions', label: 'Positions' },
      { href: '/sports/value', label: 'Value Bets' },
      { href: '/sports/history', label: 'History' },
    ],
  },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Determine current bot from pathname
  const currentBot = pathname.startsWith('/tennis')
    ? bots[1]
    : pathname.startsWith('/sports')
    ? bots[2]
    : bots[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const handleBotSwitch = (bot: Bot) => {
    setDropdownOpen(false);
    setMobileMenuOpen(false);
    router.push(bot.basePath || '/');
  };

  const isLinkActive = (href: string) => {
    if (href === '/' || href === '/tennis') {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
        {/* Logo + Bot Selector */}
        <div className="flex items-center gap-2 sm:gap-4">
          <Link href={currentBot.basePath || '/'} className="flex items-center gap-2 sm:gap-3 group">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded bg-[var(--accent-primary)] flex items-center justify-center flex-shrink-0">
              <span className="text-black font-bold text-xs sm:text-sm">PS</span>
            </div>
            <div className="hidden sm:block">
              <span className="text-xl font-bold tracking-tight text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors">
                POLYSPY
              </span>
              <span className="ml-2 text-xs text-[var(--text-muted)] font-mono">DASHBOARD</span>
            </div>
          </Link>

          {/* Bot Selector Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="bot-selector text-sm sm:text-base"
            >
              <span className="text-base sm:text-lg">{currentBot.icon}</span>
              <span className="hidden xs:inline">{currentBot.name}</span>
              <svg
                className={`w-4 h-4 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {dropdownOpen && (
              <div className="bot-dropdown">
                {bots.map((bot) => (
                  <button
                    key={bot.id}
                    onClick={() => handleBotSwitch(bot)}
                    className={`bot-dropdown-item ${bot.id === currentBot.id ? 'active' : ''}`}
                  >
                    <span className="text-lg">{bot.icon}</span>
                    <span>{bot.name}</span>
                    {bot.id === currentBot.id && (
                      <svg className="w-4 h-4 ml-auto text-[var(--accent-primary)]" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Desktop Navigation Links */}
        <div className="hidden md:flex items-center gap-2">
          {currentBot.links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link ${isLinkActive(link.href) ? 'active' : ''}`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Status + Mobile Menu Button */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)]">
            <span className="w-2 h-2 rounded-full bg-[var(--positive)] pulse"></span>
            <span className="hidden sm:inline">LIVE</span>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[var(--border-color)] bg-[var(--bg-primary)]/98 backdrop-blur-sm">
          <div className="px-4 py-3 space-y-1">
            {currentBot.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`block px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  isLinkActive(link.href)
                    ? 'bg-[rgba(0,255,136,0.1)] text-[var(--accent-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[rgba(0,255,136,0.05)] hover:text-[var(--text-primary)]'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Bot switcher in mobile menu */}
          <div className="border-t border-[var(--border-color)] px-4 py-3">
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2 px-4">Switch Bot</div>
            {bots.filter(b => b.id !== currentBot.id).map((bot) => (
              <button
                key={bot.id}
                onClick={() => handleBotSwitch(bot)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:bg-[rgba(0,255,136,0.05)] hover:text-[var(--text-primary)] transition-colors"
              >
                <span className="text-lg">{bot.icon}</span>
                <span>{bot.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
