import { useState, useEffect } from 'react';
import type { UserSession } from './types/civic';
import { Navbar } from './components/Navbar';
import { LandingPage } from './components/LandingPage';
import { MainApp } from './components/MainApp';
import { AuthModal } from './components/AuthModal';
import { getTiramisuNetworkInfo } from './lib/arkiv';
import { getWalletRole, saveWalletRole } from './lib/walletRoles';

function restoreSession(): UserSession | null {
  try {
    const stored = localStorage.getItem('civicark_user_session');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed?.address) return null;
    const roles = ['citizen', 'engineer', 'contractor', 'auditor'] as const;
    const role = roles.includes(parsed.role) ? parsed.role : 'citizen';
    if (parsed.isMetaMask === true) {
      const walletRole = saveWalletRole(parsed.address, getWalletRole(parsed.address) || role);
      return { ...parsed, role: walletRole, displayName: `${walletRole.toUpperCase()} (${parsed.address.slice(0, 6)}...${parsed.address.slice(-4)})` } as UserSession;
    }

    const address = role === 'engineer' ? '0x0000000000000000000000000000000000000001' : role === 'citizen' ? '0x0000000000000000000000000000000000000002' : role === 'contractor' ? '0x0000000000000000000000000000000000000003' : '0x0000000000000000000000000000000000000004';
    const label = role === 'engineer' ? 'Engineer' : role === 'citizen' ? 'Resident' : role === 'contractor' ? 'Contractor' : 'Auditor';
    const ward = role === 'contractor' ? 'All Wards' : role === 'auditor' ? 'Mumbai Metropolitan' : 'K/W';
    return { ...parsed, address, role, displayName: `${label} role preview`, ward, balanceGlm: 'Read-only role preview', isMetaMask: false } as UserSession;
  } catch {
    return null;
  }
}

export function App() {
  const [session, setSession] = useState<UserSession | null>(restoreSession);
  const [currentView, setCurrentView] = useState<'landing' | 'app'>('landing');
  const [isAuthOpen, setIsAuthOpen] = useState<boolean>(false);
  const [networkBlock, setNetworkBlock] = useState<bigint>(0n);
  const [networkLatency, setNetworkLatency] = useState<number>(0);
  const [networkStatus, setNetworkStatus] = useState<'checking' | 'connected' | 'offline'>('checking');

  // Restore session from localStorage if present
  useEffect(() => {
    // Fetch initial network stats
    getTiramisuNetworkInfo().then(info => {
      setNetworkBlock(info.blockNumber);
      setNetworkLatency(info.latencyMs);
      setNetworkStatus(info.blockNumber > 0n ? 'connected' : 'offline');
    });
  }, []);

  // Handle View Navigation with strict login check
  const handleNavigate = (view: 'landing' | 'app') => {
    if (view === 'app' && !session) {
      // Must login/authenticate before accessing main app
      setIsAuthOpen(true);
      return;
    }
    setCurrentView(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAuthSuccess = (newSession: UserSession) => {
    setSession(newSession);
    setCurrentView('app');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDisconnect = () => {
    localStorage.removeItem('civicark_user_session');
    setSession(null);
    setCurrentView('landing');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-primary)' }}>
      <Navbar
        session={session}
        onOpenAuth={() => setIsAuthOpen(true)}
        onDisconnect={handleDisconnect}
        currentView={currentView}
        onNavigate={handleNavigate}
      />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {currentView === 'landing' ? (
          <LandingPage
            session={session}
            onOpenAuth={() => setIsAuthOpen(true)}
            onLaunchApp={() => handleNavigate('app')}
            networkBlockNumber={networkBlock}
            networkLatency={networkLatency}
            networkStatus={networkStatus}
          />
        ) : session ? (
          <MainApp
            key={`${session.address}-${session.role}`}
            session={session}
            onOpenAuth={() => setIsAuthOpen(true)}
          />
        ) : null}
      </main>

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onSuccess={handleAuthSuccess}
      />
    </div>
  );
}

export default App;
