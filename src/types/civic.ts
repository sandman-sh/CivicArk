export type TenderCategory = 'roadwork' | 'drainage' | 'bridge' | 'footpath';

export type TenderStatus = 
  | 'unknown'
  | 'awarded' 
  | 'in_progress' 
  | 'completed' 
  | 'warranty_active' 
  | 'breached';

export type DefectSeverity = 'minor' | 'moderate' | 'critical' | 'hazardous' | 'unknown';

export type DefectStatus = 'open' | 'acknowledged' | 'assigned' | 'repair_submitted' | 'verified' | 'rectified' | 'breach_penalized' | 'unknown';

export interface DefectEvent { status: DefectStatus; actor: string; role: UserRole; timestamp: number; note: string; evidencePhotoCid?: string; txHash?: string; }

export type UserRole = 'citizen' | 'engineer' | 'contractor' | 'auditor';

export interface TenderMilestone {
  phase: string;
  signedBy: string;
  role: string;
  timestamp: number;
  status: 'done' | 'pending';
  txHash?: string;
  notes?: string;
}

export interface TechnicalSpecs {
  material: string;
  thicknessMm: number;
  coreSampleLabCid: string;
  labAccreditation: string;
}

export interface CivicTender {
  key: string;                    // Arkiv Entity Key (or local seed key)
  tenderId: string;               // e.g. "BMC-2026-KW-RD-042"
  title: string;
  city: string;                   // "Mumbai"
  ward: string;                   // "K-West", "H-West", etc.
  wardName: string;               // "Andheri West / Juhu"
  roadName: string;
  category: TenderCategory;
  status: TenderStatus;
  budgetInr: number;              // In INR
  contractor: string;             // EVM address
  contractorName: string;
  engineer: string;               // EVM address
  engineerName: string;
  dlpYears: number;               // Defect Liability Period (statutory warranty)
  dlpExpiryTimestamp: number;     // Expiration timestamp
  defectCount: number;
  awardedAt: number;
  completedAt?: number;
  specs: TechnicalSpecs;
  milestones: TenderMilestone[];
  txHash?: string;
  blockNumber?: number;
  isChainEntity?: boolean;        // Whether created on Arkiv testnet
}

export interface DefectChallenge {
  key?: string;
  tenderKey: string;
  tenderId: string;
  ward: string;
  roadName: string;
  severity: DefectSeverity;
  description: string;
  evidencePhotoCid: string;
  reportedBy: string;
  reporterRole: string;
  latitude?: number;
  longitude?: number;
  anonymousDisplay?: boolean;
  timestamp: number;
  status: DefectStatus;
  txHash?: string;
  rectificationDeadline: number;
  events?: DefectEvent[];
  department?: string;
  assignedTo?: string;
  repairEvidenceCid?: string;
}

export interface UserSession {
  address: string;
  role: UserRole;
  displayName: string;
  ward?: string;
  balanceGlm: string;
  isMetaMask: boolean;
  connectedAt: number;
}

export type WindowSize = '1x' | '2x' | 'full';

export interface DynamicWindowState {
  id: string;
  title: string;
  category: string;
  size: WindowSize;
  isMinimized: boolean;
  order: number;
  widthSpan?: number;
  heightPx?: number;
  columnStart?: number;
  offsetY?: number;
}
