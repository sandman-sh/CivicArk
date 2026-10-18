import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
  jsonToPayload,
  str,
  u64,
  i32,
  addr,
} from '@arkiv-network/sdk';
import { tiramisu } from '@arkiv-network/sdk/chains';
import { eq } from '@arkiv-network/sdk/query';
import { http, custom } from 'viem';
import type { CivicTender, DefectChallenge, UserSession } from '../types/civic';

const env = import.meta.env;
export const TIRAMISU_CHAIN_ID = Number(env.VITE_ARKIV_CHAIN_ID || 7738577);
export const TIRAMISU_RPC_URL = env.VITE_ARKIV_RPC_URL || 'https://rpc.tiramisu.db-chain.testnet.arkiv.network';
export const TIRAMISU_EXPLORER_URL = env.VITE_ARKIV_EXPLORER_URL || 'https://tiramisu.explorer.arkiv.network';

// Standard Public Client querying live Tiramisu DB-Chain
export const publicClient = createPublicClient({
  chain: tiramisu,
  transport: http(TIRAMISU_RPC_URL),
});

// Storage keys for local session cache
const LOCAL_STORAGE_TENDERS_KEY = 'civicark_local_tenders_cache';
const LOCAL_STORAGE_DEFECTS_KEY = 'civicark_local_defects_cache';

/**
 * Get or initialize persistent local tenders cache (merging on-chain updates)
 */
export function getStoredTenders(): CivicTender[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_TENDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tender: CivicTender) => tender.isChainEntity === true) : [];
  } catch {
    return [];
  }
}

export function saveStoredTenders(tenders: CivicTender[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_TENDERS_KEY, JSON.stringify(tenders));
  } catch (err) {
    console.warn('Failed to cache tenders in localStorage:', err);
  }
}

export function getStoredDefects(): DefectChallenge[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_DEFECTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveStoredDefects(defects: DefectChallenge[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_DEFECTS_KEY, JSON.stringify(defects));
  } catch (err) {
    console.warn('Failed to cache defects in localStorage:', err);
  }
}

/** Read the public defect ledger from Arkiv. Local cache is only a continuity cache. */
export async function fetchDefectsFromArkiv(): Promise<DefectChallenge[]> {
  try {
    const result = await publicClient
      .select({ key: true, attributes: true, payload: true })
      .where(eq('app', str('civicark')), eq('type', str('defect')))
      .limit(100)
      .fetch();

    const defects = (result.entities || []).map((entity: any): DefectChallenge => {
      const attrs = entity.attributes || {};
      let payload: any = {};
      try { payload = entity.toJson() || {}; } catch { /* malformed payload stays visible through attributes */ }
      return {
        key: entity.key,
        tenderKey: attrs.tender_key?.value || payload.tenderKey || '',
        tenderId: attrs.tender_id?.value || payload.tenderId || '',
        ward: attrs.ward?.value || payload.ward || '',
        roadName: attrs.road_name?.value || payload.roadName || '',
        severity: (attrs.severity?.value || payload.severity || 'unknown') as DefectChallenge['severity'],
        description: payload.description || '',
        evidencePhotoCid: payload.evidencePhotoCid || '',
        reportedBy: payload.anonymousDisplay ? '' : (attrs.reporter?.value || payload.reportedBy || ''),
        reporterRole: payload.reporterRole || 'citizen',
        latitude: Number.isFinite(Number(payload.latitude)) ? Number(payload.latitude) : undefined,
        longitude: Number.isFinite(Number(payload.longitude)) ? Number(payload.longitude) : undefined,
        anonymousDisplay: Boolean(payload.anonymousDisplay),
        timestamp: Number(payload.timestamp || 0),
        status: (attrs.status?.value || payload.status || 'unknown') as DefectChallenge['status'],
        txHash: payload.txHash,
        rectificationDeadline: Number(attrs.rectification_deadline?.value || payload.rectificationDeadline || 0),
        events: Array.isArray(payload.events) ? payload.events : [],
        department: payload.department || 'Roads',
        assignedTo: payload.assignedTo || '',
        repairEvidenceCid: payload.repairEvidenceCid || '',
      };
    });
    saveStoredDefects(defects);
    return defects;
  } catch (err) {
    console.warn('Arkiv defect query failed; using cache:', err);
    return getStoredDefects();
  }
}

/**
 * Fetch live block number and network latency from Tiramisu RPC
 */
export async function getTiramisuNetworkInfo(): Promise<{
  blockNumber: bigint;
  latencyMs: number;
  chainId: number;
  rpc: string;
}> {
  const startTime = performance.now();
  try {
    const block = await publicClient.getBlockNumber();
    const latency = Math.round(performance.now() - startTime);
    return {
      blockNumber: block,
      latencyMs: latency,
      chainId: TIRAMISU_CHAIN_ID,
      rpc: TIRAMISU_RPC_URL,
    };
  } catch (err) {
    console.warn('Arkiv Tiramisu RPC ping failed:', err);
    return {
      blockNumber: 0n,
      latencyMs: 0,
      chainId: TIRAMISU_CHAIN_ID,
      rpc: TIRAMISU_RPC_URL,
    };
  }
}

/**
 * Query Tenders directly from Arkiv Tiramisu testnet with a confirmed-chain cache fallback
 */
export async function fetchTendersFromArkiv(wardFilter?: string): Promise<{
  tenders: CivicTender[];
  source: 'arkiv_chain' | 'synced_cache';
  chainCount: number;
}> {
  const localList = getStoredTenders();
  
  try {
    // Arkiv queries require at least one filter predicate
    const queryBuilder = publicClient
      .select({ key: true, attributes: true, payload: true })
      .where(eq('app', str('civicark')), eq('type', str('tender')));

    const result = await queryBuilder.limit(50).fetch();
    const chainEntities = result.entities || [];

    if (chainEntities.length > 0) {
      const parsedChainTenders: CivicTender[] = chainEntities.flatMap((ent: any): CivicTender[] => {
        const safeKey = typeof ent.key === 'string' ? ent.key : '';
        if (!safeKey) return [];
        let payloadData: any = {};
        try {
          payloadData = ent.toJson() || {};
        } catch {
          payloadData = {};
        }

        const attrs = ent.attributes || {};

        return [{
          key: safeKey,
          tenderId: attrs.tender_id?.value || payloadData.tenderId || `ARKIV-${safeKey.slice(2, 8).toUpperCase()}`,
          title: payloadData.projectTitle || 'Untitled Arkiv entity',
          city: attrs.city?.value || payloadData.city || '',
          ward: attrs.ward?.value || payloadData.ward || '',
          wardName: attrs.ward_name?.value || payloadData.wardName || '',
          roadName: attrs.road_name?.value || payloadData.roadName || '',
          category: (attrs.category?.value || payloadData.category || 'roadwork') as any,
          status: (attrs.status?.value || payloadData.status || 'unknown') as any,
          budgetInr: Number(attrs.budget_inr?.value ?? payloadData.budgetInr ?? 0),
          contractor: attrs.contractor?.value || payloadData.contractor || '',
          contractorName: payloadData.contractorName || '',
          engineer: attrs.engineer?.value || payloadData.engineer || '',
          engineerName: payloadData.engineerName || '',
          dlpYears: Number(attrs.dlp_years?.value ?? payloadData.dlpYears ?? 0),
          dlpExpiryTimestamp: Number(attrs.dlp_expiry?.value ?? payloadData.dlpExpiryTimestamp ?? 0),
          defectCount: Number(attrs.defect_count?.value || 0),
          awardedAt: Number(payloadData.awardedAt || 0),
          completedAt: payloadData.completedAt,
          specs: payloadData.technicalSpecs || {
            material: '',
            thicknessMm: 0,
            coreSampleLabCid: '',
            labAccreditation: '',
          },
          milestones: payloadData.milestones || [],
          isChainEntity: true,
        }];
      });

      // Merge chain records with local list without duplicates
      const chainKeys = new Set(parsedChainTenders.map(t => t.key));
      // Keep only cached records that were previously confirmed on-chain.
      const merged = [
        ...parsedChainTenders,
        ...localList.filter(t => t.isChainEntity && !chainKeys.has(t.key))
      ];

      saveStoredTenders(merged);
      const filtered = wardFilter ? merged.filter(t => t.ward === wardFilter) : merged;
      return {
        tenders: filtered,
        source: 'arkiv_chain',
        chainCount: chainEntities.length,
      };
    }
  } catch (err) {
    console.info('Arkiv chain query info:', err);
  }

  const confirmedCache = localList.filter(t => t.isChainEntity === true);
  const filtered = wardFilter ? confirmedCache.filter(t => t.ward === wardFilter) : confirmedCache;
  return {
    tenders: filtered,
    source: 'synced_cache',
    chainCount: 0,
  };
}

/**
 * Create a new Municipal Tender on Arkiv Tiramisu Testnet
 */
export async function createTenderOnArkiv(
  tenderData: Omit<CivicTender, 'key' | 'isChainEntity'>,
  userSession?: UserSession
): Promise<{
  success: boolean;
  entityKey: string;
  txHash: string;
  tender: CivicTender;
}> {
  // 1. Prepare typed payload
  const payloadObject = {
    tenderId: tenderData.tenderId,
    projectTitle: tenderData.title,
    municipalBody: 'Brihanmumbai Municipal Corporation (BMC)',
    city: tenderData.city,
    ward: tenderData.ward,
    wardName: tenderData.wardName,
    roadName: tenderData.roadName,
    budgetInr: tenderData.budgetInr,
    contractor: tenderData.contractor,
    contractorName: tenderData.contractorName,
    engineer: tenderData.engineer,
    engineerName: tenderData.engineerName,
    dlpYears: tenderData.dlpYears,
    awardedAt: tenderData.awardedAt,
    technicalSpecs: tenderData.specs,
    milestones: tenderData.milestones,
  };

  const payload = jsonToPayload(payloadObject);

  // 2. Prepare typed query attributes
  const attributes = {
    app: str('civicark'),
    type: str('tender'),
    tender_id: str(tenderData.tenderId),
    city: str(tenderData.city),
    ward: str(tenderData.ward),
    road_name: str(tenderData.roadName),
    category: str(tenderData.category),
    status: str(tenderData.status),
    budget_inr: u64(BigInt(Math.floor(tenderData.budgetInr))),
    contractor: addr(tenderData.contractor as `0x${string}`),
    engineer: addr(tenderData.engineer as `0x${string}`),
    dlp_years: i32(tenderData.dlpYears),
    defect_count: i32(0),
    dlp_expiry: u64(BigInt(Math.floor(tenderData.dlpExpiryTimestamp))),
  };

  // 3. Expiration based on Defect Liability Period (statutory warranty)
  const expires = ExpirationTime.fromDays(Math.min(tenderData.dlpYears * 365, 1000));

  let entityKey: string;
  let txHash: string;

  // Check if browser has MetaMask connected on Tiramisu
  if (typeof window !== 'undefined' && (window as any).ethereum && userSession?.isMetaMask) {
    try {
      const arkivWallet = createWalletClient({
        chain: tiramisu,
        transport: custom((window as any).ethereum),
        account: userSession.address as `0x${string}`,
      });

      const result = await arkivWallet.createEntity({
        payload,
        contentType: 'application/json',
        attributes,
        expires,
      });

      if (!result?.entityKey || !result?.txHash) throw new Error('Arkiv did not return an entity key and transaction hash');
      entityKey = result.entityKey;
      txHash = result.txHash;
    } catch (chainErr) {
      throw new Error(`Arkiv tender creation failed: ${chainErr instanceof Error ? chainErr.message : String(chainErr)}`);
    }
  } else {
    throw new Error('Connect a funded wallet on Arkiv Tiramisu to publish a tender.');
  }

  const createdTender: CivicTender = {
    ...tenderData,
    key: entityKey,
    txHash,
    isChainEntity: true,
  };

  // Cache only after the chain transaction succeeded.
  const currentList = getStoredTenders();
  const updated = [createdTender, ...currentList.filter(t => t.tenderId !== createdTender.tenderId)];
  saveStoredTenders(updated);

  return {
    success: true,
    entityKey,
    txHash,
    tender: createdTender,
  };
}

/**
 * Patch Tender Status or Milestones on Arkiv
 */
export async function patchTenderOnArkiv(
  tenderKey: string,
  updatedFields: Partial<CivicTender>,
  newMilestone?: any,
  userSession?: UserSession
): Promise<{ success: boolean; txHash: string; updatedTender: CivicTender }> {
  const currentList = getStoredTenders();
  const tender = currentList.find(t => t.key === tenderKey || t.tenderId === tenderKey);

  if (!tender) {
    throw new Error(`Tender ${tenderKey} not found in registry`);
  }

  const updatedMilestones = newMilestone 
    ? [...tender.milestones, newMilestone] 
    : tender.milestones;

  let txHash: string;

  // If connected via MetaMask, attempt on-chain patch
  if (typeof window !== 'undefined' && (window as any).ethereum && userSession?.isMetaMask) {
    try {
      const arkivWallet = createWalletClient({
        chain: tiramisu,
        transport: custom((window as any).ethereum),
        account: userSession.address as `0x${string}`,
      });

      const patchSet: Record<string, any> = {};
      if (updatedFields.status) patchSet.status = str(updatedFields.status);
      if (updatedFields.defectCount !== undefined) patchSet.defect_count = i32(updatedFields.defectCount);

      const patchResult = await arkivWallet.patchEntity({
        entityKey: tender.key as `0x${string}`,
        set: patchSet,
        payload: jsonToPayload({
          tenderId: tender.tenderId,
          projectTitle: tender.title,
          municipalBody: 'Brihanmumbai Municipal Corporation (BMC)',
          city: tender.city,
          ward: tender.ward,
          wardName: tender.wardName,
          roadName: tender.roadName,
          budgetInr: tender.budgetInr,
          contractor: tender.contractor,
          contractorName: tender.contractorName,
          engineer: tender.engineer,
          engineerName: tender.engineerName,
          dlpYears: tender.dlpYears,
          awardedAt: tender.awardedAt,
          technicalSpecs: tender.specs,
          milestones: updatedMilestones,
        }),
        contentType: 'application/json',
      });

      if (!patchResult?.txHash) throw new Error('Arkiv did not return a patch transaction hash');
      txHash = patchResult.txHash;
    } catch (err) {
      throw new Error(`Arkiv milestone patch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    throw new Error('Connect the owning wallet on Arkiv Tiramisu to patch this tender.');
  }

  const updatedTender: CivicTender = {
    ...tender,
    ...updatedFields,
    milestones: updatedMilestones,
    txHash,
  };

  const updatedList = currentList.map(t => t.key === tender.key ? updatedTender : t);
  saveStoredTenders(updatedList);

  return {
    success: true,
    txHash,
    updatedTender,
  };
}

/**
 * Citizen Defect / Pothole Challenge Submission
 */
export async function submitDefectChallenge(
  challengeData: Omit<DefectChallenge, 'timestamp' | 'status' | 'rectificationDeadline'>,
  userSession?: UserSession
): Promise<{ success: boolean; txHash: string; challenge: DefectChallenge }> {
  const deadline = Math.floor(Date.now() / 1000) + 86400 * 30; // 30-day statutory rectification window
  if (typeof window === 'undefined' || !(window as any).ethereum || !userSession?.isMetaMask) {
    throw new Error('Connect a funded wallet on Arkiv Tiramisu to publish a defect challenge.');
  }

  const payload = jsonToPayload({
    tenderId: challengeData.tenderId,
    tenderKey: challengeData.tenderKey,
    ward: challengeData.ward,
    roadName: challengeData.roadName,
    severity: challengeData.severity,
    description: challengeData.description,
    evidencePhotoCid: challengeData.evidencePhotoCid,
    ...(!challengeData.anonymousDisplay ? { reportedBy: challengeData.reportedBy } : {}),
    reporterRole: challengeData.reporterRole,
    latitude: challengeData.latitude,
    longitude: challengeData.longitude,
    anonymousDisplay: Boolean(challengeData.anonymousDisplay),
    timestamp: Math.floor(Date.now() / 1000),
    rectificationDeadline: deadline,
  });

  const wallet = createWalletClient({
    chain: tiramisu,
    transport: custom((window as any).ethereum),
    account: userSession.address as `0x${string}`,
  });

  let txHash: string;
  let entityKey: string;
  try {
    const result = await wallet.createEntity({
      payload,
      contentType: 'application/json',
      attributes: {
        app: str('civicark'),
        type: str('defect'),
        tender_id: str(challengeData.tenderId),
        tender_key: str(challengeData.tenderKey),
        road_name: str(challengeData.roadName),
        severity: str(challengeData.severity),
        status: str('open'),
        ...(!challengeData.anonymousDisplay ? { reporter: addr(userSession.address as `0x${string}`) } : {}),
        rectification_deadline: u64(BigInt(deadline)),
      },
      expires: ExpirationTime.fromDays(365),
    });
    if (!result?.entityKey || !result?.txHash) throw new Error('Arkiv did not return defect transaction evidence');
    entityKey = result.entityKey;
    txHash = result.txHash;
  } catch (err) {
    throw new Error(`Arkiv defect publication failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const challenge: DefectChallenge = {
    ...challengeData,
    timestamp: Math.floor(Date.now() / 1000),
    status: 'open',
    rectificationDeadline: deadline,
    txHash,
    key: entityKey,
  };

  // Update defect list
  const currentDefects = getStoredDefects();
  saveStoredDefects([challenge, ...currentDefects]);

  // Increment defect count on corresponding tender
  const currentTenders = getStoredTenders();
  const targetTender = currentTenders.find(t => t.key === challengeData.tenderKey || t.tenderId === challengeData.tenderId);
  if (targetTender) {
    targetTender.defectCount += 1;
    if (challengeData.severity === 'critical' || challengeData.severity === 'hazardous') {
      targetTender.status = 'breached';
    }
    saveStoredTenders(currentTenders);
  }

  return {
    success: true,
    txHash,
    challenge,
  };
}

export async function updateDefectOnArkiv(defect: DefectChallenge, status: DefectChallenge['status'], note: string, evidencePhotoCid: string, userSession: UserSession): Promise<DefectChallenge> {
  if (!defect.key || !userSession.isMetaMask || !(window as any).ethereum) throw new Error('A connected wallet and an on-chain report are required for workflow updates.');
  const timestamp = Math.floor(Date.now() / 1000);
  const event = { status, actor: userSession.address, role: userSession.role, timestamp, note, ...(evidencePhotoCid ? { evidencePhotoCid } : {}) };
  const updated = { ...defect, reportedBy: defect.anonymousDisplay ? '' : defect.reportedBy, status, department: defect.department || 'Roads', assignedTo: status === 'assigned' ? userSession.address : defect.assignedTo, repairEvidenceCid: evidencePhotoCid || defect.repairEvidenceCid, events: [...(defect.events || []), event] };
  const wallet = createWalletClient({ chain: tiramisu, transport: custom((window as any).ethereum), account: userSession.address as `0x${string}` });
  const result = await wallet.patchEntity({ entityKey: defect.key as `0x${string}`, set: { status: str(status) }, payload: jsonToPayload({ ...updated, txHash: undefined }) , contentType: 'application/json' });
  if (!result?.txHash) throw new Error('Arkiv did not return a workflow transaction hash.');
  const saved = { ...updated, txHash: result.txHash, events: updated.events?.map((entry, index) => index === updated.events!.length - 1 ? { ...entry, txHash: result.txHash } : entry) };
  const records = getStoredDefects().map(item => item.key === defect.key ? saved : item);
  saveStoredDefects(records);
  return saved;
}

/**
 * Prompt MetaMask to add and switch to Arkiv Tiramisu Testnet
 */
export async function switchToTiramisuNetwork(): Promise<boolean> {
  if (typeof window === 'undefined' || !(window as any).ethereum) {
    alert('No Web3 browser wallet detected. Install a compatible wallet to sign Arkiv transactions.');
    return false;
  }

  const eth = (window as any).ethereum;
  const hexChainId = `0x${TIRAMISU_CHAIN_ID.toString(16)}`;

  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
    return true;
  } catch (switchError: any) {
    if (switchError.code === 4902) {
      try {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: hexChainId,
              chainName: 'Arkiv Tiramisu Testnet',
              nativeCurrency: {
                name: 'Golem Token',
                symbol: 'GLM',
                decimals: 18,
              },
              rpcUrls: [TIRAMISU_RPC_URL],
              blockExplorerUrls: [TIRAMISU_EXPLORER_URL],
            },
          ],
        });
        return true;
      } catch (addError) {
        console.error('Failed to add Tiramisu network:', addError);
        return false;
      }
    }
    console.error('Failed to switch network:', switchError);
    return false;
  }
}
