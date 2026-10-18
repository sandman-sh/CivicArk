import { useEffect, useState } from 'react';
import { ShieldCheck, HardHat, User, Wallet, ArrowRight, X, ExternalLink } from 'lucide-react';
import type { UserRole, UserSession } from '../types/civic';
import { switchToTiramisuNetwork, TIRAMISU_CHAIN_ID } from '../lib/arkiv';
import { getWalletRole, saveWalletRole } from '../lib/walletRoles';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (session: UserSession) => void;
}

export const AuthModal = ({ isOpen, onClose, onSuccess }: AuthModalProps) => {
  const [selectedRole, setSelectedRole] = useState<UserRole>('citizen');
  const [isConnectingMetaMask, setIsConnectingMetaMask] = useState(false);
  const [connectedWallet, setConnectedWallet] = useState('');
  const [roleLocked, setRoleLocked] = useState(false);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined' || !(window as any).ethereum) return;
    const wallet = (window as any).ethereum;
    let active = true;
    const syncAccount = (accounts?: string[]) => {
      const sync = async () => {
        const available = accounts || await wallet.request({ method: 'eth_accounts' });
        if (!active) return;
        const address = Array.isArray(available) && typeof available[0] === 'string' ? available[0] : '';
        setConnectedWallet(address);
        const savedRole = address ? getWalletRole(address) : null;
        setRoleLocked(Boolean(savedRole));
        setSelectedRole(savedRole || 'citizen');
      };
      void sync().catch(() => { if (active) { setConnectedWallet(''); setRoleLocked(false); setSelectedRole('citizen'); } });
    };
    syncAccount();
    wallet.on?.('accountsChanged', syncAccount);
    return () => { active = false; wallet.removeListener?.('accountsChanged', syncAccount); };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleMetaMaskConnect = async () => {
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      alert('No wallet extension was detected. You can connect a wallet or open a read-only role preview.');
      return;
    }

    setIsConnectingMetaMask(true);
    try {
      const accounts = await (window as any).ethereum.request({
        method: 'eth_requestAccounts',
      });

      if (accounts && accounts.length > 0) {
        // Ensure network is Tiramisu
        await switchToTiramisuNetwork();

        const address = accounts[0] as string;
        const role = saveWalletRole(address, getWalletRole(address) || selectedRole);
        const session: UserSession = {
          address,
          role,
          displayName: `${role.toUpperCase()} (${address.slice(0, 6)}...${address.slice(-4)})`,
          ward: 'K/W',
          balanceGlm: 'Wallet connected',
          isMetaMask: true,
          connectedAt: Date.now(),
        };

        localStorage.setItem('civicark_user_session', JSON.stringify(session));
        onSuccess(session);
        onClose();
      }
    } catch (err: any) {
      console.error('MetaMask connection rejected:', err);
      alert('Connection failed or rejected: ' + (err.message || err));
    } finally {
      setIsConnectingMetaMask(false);
    }
  };

  const handleSelectPresetRole = (role: UserRole) => {
    setSelectedRole(role);
    let address = '0x0000000000000000000000000000000000000001';
    let name = 'Engineer role preview';
    let ward = 'K/W';

    if (role === 'contractor') {
      address = '0x0000000000000000000000000000000000000003';
      name = 'Contractor role preview';
      ward = 'All Wards';
    } else if (role === 'citizen') {
      address = '0x0000000000000000000000000000000000000002';
      name = 'Resident role preview';
      ward = 'K/W';
    } else if (role === 'auditor') {
      address = '0x0000000000000000000000000000000000000004';
      name = 'Auditor role preview';
      ward = 'Mumbai Metropolitan';
    }

    const session: UserSession = {
      address,
      role,
      displayName: name,
      ward,
      balanceGlm: 'Read-only role preview',
      isMetaMask: false,
      connectedAt: Date.now(),
    };

    localStorage.setItem('civicark_user_session', JSON.stringify(session));
    onSuccess(session);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content pixel-corner" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-medium)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'var(--bg-secondary)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="tag-dot" />
            <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
              Authentication & Role Gateway
            </h3>
          </div>
          <button onClick={onClose} className="window-btn" title="Close">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 20px' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '20px' }}>
            Explore public records on <strong>Arkiv Tiramisu (Chain ID: {TIRAMISU_CHAIN_ID})</strong>. Connect a wallet to sign real updates, or choose a read-only role preview.
          </p>

          {/* Option A: Connect MetaMask */}
          <div style={{
            border: '1px solid var(--border-medium)',
            padding: '16px',
            marginBottom: '24px',
            backgroundColor: 'var(--bg-card)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Wallet size={16} />
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.82rem' }}>
                  CONNECT A WALLET
                </span>
              </div>
              <span className="badge badge-success">Live RPC</span>
            </div>

            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
              Choose your workspace role before connecting. This choice is remembered for this wallet on this device.
            </p>

            <label style={{ display: 'grid', gap: 6, marginBottom: 12, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              {roleLocked ? `Saved role for ${connectedWallet.slice(0, 6)}…${connectedWallet.slice(-4)}` : 'Choose your role for this wallet'}
              <select value={selectedRole} disabled={roleLocked || isConnectingMetaMask} onChange={event => setSelectedRole(event.target.value as UserRole)} className="tech-input">
                <option value="citizen">Citizen — public reports and records</option>
                <option value="engineer">Engineer — municipal work operations</option>
                <option value="contractor">Contractor — assigned work updates</option>
                <option value="auditor">Auditor — evidence and public ledger review</option>
              </select>
            </label>
            {roleLocked && <p style={{ fontSize: '0.68rem', color: 'var(--accent-emerald)', margin: '0 0 12px' }}>This wallet’s role is locked to {selectedRole}. Reconnecting will keep this role.</p>}
            <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
              Role choice is stored in this browser. It does not prove municipal employment or contractor authorization; protected agent tools still require server allowlisting.
            </p>

            <button
              onClick={handleMetaMaskConnect}
              disabled={isConnectingMetaMask}
              className="btn btn-primary"
              style={{ width: '100%', padding: '10px' }}
            >
              {isConnectingMetaMask ? (
                <span>Switching to Tiramisu...</span>
              ) : (
                <>
                  <span>{roleLocked ? `Continue as ${selectedRole}` : `Connect as ${selectedRole}`}</span>
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>

          {/* Option B: One-Click Personas for Judges */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span className="tag-dot" />
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.82rem', textTransform: 'uppercase' }}>
                READ-ONLY ROLE PREVIEW
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Persona 1: Municipal Engineer */}
              <div
                onClick={() => handleSelectPresetRole('engineer')}
                style={{
                  border: '1px solid var(--border-light)',
                  padding: '12px 14px',
                  backgroundColor: 'var(--bg-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s ease',
                }}
                className="hover-card"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <ShieldCheck size={20} style={{ color: 'var(--accent-primary)' }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>Municipal Executive Engineer</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      Preview identity • Inspect records and explore engineer workflows
                    </div>
                  </div>
                </div>
                <ArrowRight size={14} />
              </div>

              {/* Persona 2: Road Contractor */}
              <div
                onClick={() => handleSelectPresetRole('contractor')}
                style={{
                  border: '1px solid var(--border-light)',
                  padding: '12px 14px',
                  backgroundColor: 'var(--bg-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s ease',
                }}
                className="hover-card"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <HardHat size={20} style={{ color: 'var(--accent-amber)' }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>Authorized Road Contractor</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      Preview identity • Explore contractor workflow (writes need a wallet)
                    </div>
                  </div>
                </div>
                <ArrowRight size={14} />
              </div>

              {/* Persona 3: Citizen Auditor */}
              <div
                onClick={() => handleSelectPresetRole('citizen')}
                style={{
                  border: '1px solid var(--border-light)',
                  padding: '12px 14px',
                  backgroundColor: 'var(--bg-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s ease',
                }}
                className="hover-card"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <User size={20} style={{ color: 'var(--accent-emerald)' }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>Citizen & RTI Public Auditor</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      Preview identity • Browse records and explore defect reporting
                    </div>
                  </div>
                </div>
                <ArrowRight size={14} />
              </div>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--border-light)',
          backgroundColor: 'var(--bg-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.7rem',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)',
        }}>
          <span>NETWORK: TIRAMISU TESTNET ({TIRAMISU_CHAIN_ID})</span>
          <a
            href="https://hub.arkiv.network/faucet"
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: 'var(--text-primary)', textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <span>Hub Faucet</span>
            <ExternalLink size={10} />
          </a>
        </div>
      </div>
    </div>
  );
};
