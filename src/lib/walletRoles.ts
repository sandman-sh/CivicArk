import type { UserRole } from '../types/civic';

const STORAGE_KEY = 'civicark_wallet_roles';
const ROLES: UserRole[] = ['citizen', 'engineer', 'contractor', 'auditor'];

function readWalletRoles(): Record<string, UserRole> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, UserRole] => typeof entry[0] === 'string' && ROLES.includes(entry[1] as UserRole)));
  } catch {
    return {};
  }
}

export function getWalletRole(address: string): UserRole | null {
  return readWalletRoles()[address.toLowerCase()] || null;
}

export function saveWalletRole(address: string, role: UserRole): UserRole {
  const roles = readWalletRoles();
  const normalized = address.toLowerCase();
  const savedRole = roles[normalized] || role;
  if (!roles[normalized]) {
    roles[normalized] = role;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(roles)); } catch { /* Session still works when browser storage is unavailable. */ }
  }
  return savedRole;
}
