import { ExternalLink, LogOut, Wallet, MapPinned } from 'lucide-react';
import type { UserSession } from '../types/civic';
import { ThemeToggle } from './ThemeToggle';
import { TIRAMISU_CHAIN_ID } from '../lib/arkiv';

interface NavbarProps {
  session: UserSession | null;
  onOpenAuth: () => void;
  onDisconnect: () => void;
  currentView: 'landing' | 'app';
  onNavigate: (view: 'landing' | 'app') => void;
}

export const Navbar = ({
  session,
  onOpenAuth,
  onDisconnect,
  currentView,
  onNavigate,
}: NavbarProps) => {
  return (
    <header style={{
      position: 'sticky',
      top: 0,
      zIndex: 50,
      backgroundColor: 'var(--bg-card)',
      borderBottom: '1px solid var(--border-medium)',
      backdropFilter: 'blur(8px)',
      width: '100%',
    }}>
      <div style={{
        maxWidth: '1440px',
        margin: '0 auto',
        padding: '0 20px',
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
      }}>
        {/* Left: Brand & Network Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          <div
            onClick={() => onNavigate('landing')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '9px',
              background: 'linear-gradient(145deg, #7569ed, #5146bd)',
              color: '#ffffff',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              fontFamily: 'var(--font-mono)',
              fontSize: '0.85rem',
            }}>
              <MapPinned size={17} strokeWidth={2.4} />
            </div>
            <div>
              <div style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 800,
                fontSize: '1.05rem',
                letterSpacing: '-0.03em',
                lineHeight: 1,
                color: 'var(--text-primary)',
              }}>
                CIVIC<span style={{ color: 'var(--text-muted)' }}>ARK</span>
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.58rem',
                letterSpacing: '0.14em',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                marginTop: '3px',
              }}>
                MUMBAI · PUBLIC WORKS
              </div>
            </div>
          </div>

          {/* Network Live Pill */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 10px',
            border: '1px solid var(--border-light)',
            backgroundColor: 'var(--bg-secondary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.68rem',
            letterSpacing: '0.08em',
          }}>
            <span style={{ fontWeight: 600 }}>TIRAMISU {TIRAMISU_CHAIN_ID}</span>
          </div>
        </div>

        {/* Center: Navigation Links */}
        <nav style={{
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
        }} className="hidden md:flex">
          <button
            onClick={() => onNavigate('landing')}
            style={{
              background: 'none',
              border: 'none',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.74rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: currentView === 'landing' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: currentView === 'landing' ? 700 : 500,
              cursor: 'pointer',
              borderBottom: currentView === 'landing' ? '2px solid var(--accent-primary)' : '2px solid transparent',
              paddingBottom: '4px',
            }}
          >
            Overview
          </button>

          <button
            onClick={() => {
              if (session) {
                onNavigate('app');
              } else {
                onOpenAuth();
              }
            }}
            style={{
              background: 'none',
              border: 'none',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.74rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: currentView === 'app' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: currentView === 'app' ? 700 : 500,
              cursor: 'pointer',
              borderBottom: currentView === 'app' ? '2px solid var(--accent-primary)' : '2px solid transparent',
              paddingBottom: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>Live Workspace</span>
            {session && <span className="badge badge-success" style={{ fontSize: '0.58rem' }}>ACTIVE</span>}
          </button>

          <a
            href="https://tiramisu.explorer.arkiv.network"
            target="_blank"
            rel="noreferrer noopener"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.74rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>Explorer</span>
            <ExternalLink size={10} />
          </a>
        </nav>

        {/* Right: Theme Toggle & Session Auth Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ThemeToggle />

          {session ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                onClick={() => onNavigate('app')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 12px',
                  border: '1px solid var(--border-medium)',
                  backgroundColor: 'var(--bg-secondary)',
                  cursor: 'pointer',
                }}
                title={session.isMetaMask ? session.address : 'Read-only role preview'}
              >
                <span className={`badge ${session.role === 'engineer' ? 'badge-warning' : session.role === 'contractor' ? 'badge-danger' : 'badge-success'}`}>
                  {session.role.toUpperCase()}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 600 }}>
                  {session.isMetaMask ? `${session.address.slice(0, 6)}…${session.address.slice(-4)}` : 'PREVIEW'}
                </span>
              </div>

              <button
                onClick={onDisconnect}
                className="btn btn-ghost btn-sm"
                title="Disconnect Session"
                style={{ padding: '6px 8px' }}
              >
                <LogOut size={13} />
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuth}
              className="btn btn-primary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Wallet size={13} />
              <span>Connect / Launch</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
