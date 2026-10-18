import { useState, useEffect, useCallback } from 'react';
import confetti from 'canvas-confetti';
import {
  Search, ExternalLink, ShieldCheck, Activity, Copy, Check, MapPinned,
  LayoutDashboard, ClipboardList, AlertTriangle, Map, ChevronRight,
  Plus, BriefcaseBusiness, Eye, HardHat, Crosshair, ImagePlus, Download, X, CalendarDays, MapPin
} from 'lucide-react';
import type {
  CivicTender, DefectChallenge, UserSession, WindowSize,
  DynamicWindowState, DefectSeverity
} from '../types/civic';
import { WindowFrame } from './WindowFrame';
import { NagrikSaathi } from './NagrikSaathi';
import { RealWardMap } from './RealWardMap';
import { MUMBAI_WARDS, normalizeWardCode } from '../data/wardDirectory';
import {
  fetchTendersFromArkiv,
  createTenderOnArkiv,
  patchTenderOnArkiv,
  submitDefectChallenge,
  fetchDefectsFromArkiv,
  updateDefectOnArkiv,
  getTiramisuNetworkInfo,
  TIRAMISU_CHAIN_ID,
  TIRAMISU_EXPLORER_URL
} from '../lib/arkiv';

interface MainAppProps {
  session: UserSession;
  onOpenAuth: () => void;
}

async function uploadSignedEvidence(file: File, session: UserSession): Promise<string> {
  if (file.size > 3 * 1024 * 1024) throw new Error('Photo must be smaller than 3 MB.');
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file for evidence.');
  const timestamp = Date.now().toString();
  const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  const digest = Array.from(digestBytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const message = `CivicArk evidence upload\n${session.address}\n${digest}\n${timestamp}`;
  const signature = await (window as any).ethereum.request({ method: 'personal_sign', params: [message, session.address] });
  const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('Could not read photo.')); reader.readAsDataURL(file); });
  const response = await fetch('/api/evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ base64, name: file.name, contentType: file.type, address: session.address, timestamp, digest, signature }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Photo upload failed.');
  return result.cid as string;
}

export const MainApp = ({ session, onOpenAuth }: MainAppProps) => {
  // Data state
  const [tenders, setTenders] = useState<CivicTender[]>([]);
  const [tenderSource, setTenderSource] = useState<'loading' | 'arkiv_chain' | 'synced_cache'>('loading');
  const [defects, setDefects] = useState<DefectChallenge[]>([]);
  const [selectedTender, setSelectedTender] = useState<CivicTender | null>(null);
  const [selectedWard, setSelectedWard] = useState<string>(() => MUMBAI_WARDS.some(ward => ward.code === normalizeWardCode(session.ward || '')) ? normalizeWardCode(session.ward || '') : 'All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(true);
  const [networkBlock, setNetworkBlock] = useState<bigint>(0n);
  const [networkLatency, setNetworkLatency] = useState<number>(0);
  const [networkStatus, setNetworkStatus] = useState<'checking' | 'connected' | 'offline'>('checking');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'overview' | 'work' | 'map' | 'activity' | 'reports' | 'operations' | 'audit' | 'areas'>('overview');
  const [closedWindows, setClosedWindows] = useState<string[]>([]);
  const [maximizedWindow, setMaximizedWindow] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());

  // Form states for new Tender
  const [newTenderTitle, setNewTenderTitle] = useState('');
  const [newTenderWard, setNewTenderWard] = useState('K/W');
  const [newTenderRoad, setNewTenderRoad] = useState('');
  const [newTenderBudget, setNewTenderBudget] = useState('');
  const [newTenderDlpYears, setNewTenderDlpYears] = useState(3);
  const [newTenderMaterial, setNewTenderMaterial] = useState('');
  const [newTenderThickness, setNewTenderThickness] = useState('');
  const [newTenderContractor, setNewTenderContractor] = useState('');
  const [newTenderContractorName, setNewTenderContractorName] = useState('');
  const [newTenderLabCid, setNewTenderLabCid] = useState('');
  const [newTenderLabName, setNewTenderLabName] = useState('');
  const [isSubmittingTender, setIsSubmittingTender] = useState(false);

  // Form states for new Defect Challenge
  const [defectTargetKey, setDefectTargetKey] = useState('');
  const [defectRoad, setDefectRoad] = useState('');
  const [defectSeverity, setDefectSeverity] = useState<DefectSeverity>('moderate');
  const [defectDescription, setDefectDescription] = useState('');
  const [defectEvidenceCid, setDefectEvidenceCid] = useState('');
  const [defectPhoto, setDefectPhoto] = useState<File | null>(null);
  const [defectWard, setDefectWard] = useState(() => MUMBAI_WARDS.some(ward => ward.code === normalizeWardCode(session.ward || '')) ? normalizeWardCode(session.ward || '') : 'K/W');
  const [defectLatitude, setDefectLatitude] = useState('');
  const [defectLongitude, setDefectLongitude] = useState('');
  const [anonymousDisplay, setAnonymousDisplay] = useState(false);
  const [isSubmittingDefect, setIsSubmittingDefect] = useState(false);
  const [reportSearch, setReportSearch] = useState('');
  const [selectedReport, setSelectedReport] = useState<DefectChallenge | null>(null);
  const [reportEvidenceCid, setReportEvidenceCid] = useState('');
  const [reportEvidencePhoto, setReportEvidencePhoto] = useState<File | null>(null);
  const [updatingReportKey, setUpdatingReportKey] = useState<string | null>(null);

  // Form state for milestone patch
  const [milestonePhase, setMilestonePhase] = useState('Core Sample Quality Verified');
  const [milestoneNotes, setMilestoneNotes] = useState('');
  const [isPatching, setIsPatching] = useState(false);

  // User-controlled dashboard panels
  const [windows, setWindows] = useState<DynamicWindowState[]>(() => {
    const defaults: DynamicWindowState[] = [
      { id: 'w-tenders', title: 'Municipal Tenders & Warranties', category: 'LEDGER', size: '2x', isMinimized: false, order: 1 },
      { id: 'w-real-map', title: 'Mumbai geographic view', category: 'OPENSTREETMAP', size: '2x', isMinimized: false, order: 2 },
      { id: 'w-wards', title: 'Mumbai ward work summary', category: 'WORK SUMMARY', size: '1x', isMinimized: false, order: 3 },
      { id: 'w-inspector', title: 'Cryptographic Tender Inspector', category: 'AUDIT', size: '1x', isMinimized: false, order: 4 },
      { id: 'w-defect', title: 'Report Defect & Challenge DLP', category: 'CITIZEN', size: '1x', isMinimized: false, order: 5 },
      { id: 'w-mutations', title: 'Sanction Tender & Patch Milestones', category: 'GOVERNANCE', size: '1x', isMinimized: false, order: 6 },
      { id: 'w-network', title: 'Arkiv network status', category: 'NETWORK', size: 'full', isMinimized: false, order: 7 },
    ];
    try {
      const saved = JSON.parse(localStorage.getItem('civicark_dashboard_layout') || 'null') as Partial<DynamicWindowState>[] | null;
      if (!Array.isArray(saved)) return defaults;
      return defaults.map(panel => {
        const previous = saved.find(item => item.id === panel.id);
        if (!previous) return panel;
        const widthSpan = Number(previous.widthSpan);
        const heightPx = Number(previous.heightPx);
        const savedColumnStart = Number(previous.columnStart);
        const columnStart = Number.isFinite(savedColumnStart) ? Math.max(1, Math.min(10, savedColumnStart)) : undefined;
        return {
          ...panel,
          size: previous.size === '1x' || previous.size === '2x' || previous.size === 'full' ? previous.size : panel.size,
          order: Number.isFinite(previous.order) ? previous.order! : panel.order,
          isMinimized: Boolean(previous.isMinimized),
          widthSpan: Number.isFinite(widthSpan) ? Math.max(3, Math.min(columnStart ? 13 - columnStart : 12, widthSpan)) : undefined,
          columnStart,
          offsetY: Number.isFinite(Number(previous.offsetY)) ? Math.max(-500, Math.min(500, Number(previous.offsetY))) : undefined,
          heightPx: Number.isFinite(heightPx) ? Math.max(180, Math.min(1000, heightPx)) : undefined,
        };
      });
    } catch { return defaults; }
  });

  useEffect(() => {
    const saveTimer = window.setTimeout(() => localStorage.setItem('civicark_dashboard_layout', JSON.stringify(windows)), 250);
    return () => window.clearTimeout(saveTimer);
  }, [windows]);

  // Load Initial Data
  const loadData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const tenderRes = await fetchTendersFromArkiv();
      setTenders(tenderRes.tenders);
      setTenderSource(tenderRes.source);
      if (!selectedTender && tenderRes.tenders.length > 0) {
        setSelectedTender(tenderRes.tenders[0]);
      }

      const chainDefects = await fetchDefectsFromArkiv();
      setDefects(chainDefects);

      const netInfo = await getTiramisuNetworkInfo();
      setNetworkBlock(netInfo.blockNumber);
      setNetworkLatency(netInfo.latencyMs);
      setNetworkStatus(netInfo.blockNumber > 0n ? 'connected' : 'offline');
    } catch (err) {
      console.warn('Load data error:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedTender]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void loadData(); }, 0);
    const interval = setInterval(async () => {
      try {
        const netInfo = await getTiramisuNetworkInfo();
        setNetworkBlock(netInfo.blockNumber);
        setNetworkLatency(netInfo.latencyMs);
        setNetworkStatus(netInfo.blockNumber > 0n ? 'connected' : 'offline');
      } catch {}
    }, 12000);
    return () => { window.clearTimeout(initialLoad); clearInterval(interval); };
  }, [loadData]);

  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Window control helpers
  const handleWindowSizeChange = (id: string, newSize: WindowSize) => {
    const widthSpan = newSize === '1x' ? 4 : newSize === '2x' ? 8 : 12;
    setWindows(prev => prev.map(w => w.id === id ? { ...w, size: newSize, widthSpan, heightPx: undefined, columnStart: undefined, offsetY: undefined } : w));
  };

  const handlePanelResize = (id: string, widthSpan: number, heightPx: number, columnStart: number, offsetY: number) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, widthSpan, heightPx, columnStart, offsetY } : w));
  };

  const handleMoveWindow = (sourceId: string, targetId: string) => {
    setWindows(prev => {
      const ordered = [...prev].sort((a, b) => a.order - b.order);
      const from = ordered.findIndex(panel => panel.id === sourceId);
      const to = ordered.findIndex(panel => panel.id === targetId);
      if (from < 0 || to < 0) return prev;
      const [moving] = ordered.splice(from, 1);
      ordered.splice(to, 0, moving);
      const orderMap = new globalThis.Map(ordered.map((panel, index) => [panel.id, index + 1]));
      return prev.map(panel => ({ ...panel, order: orderMap.get(panel.id) || panel.order }));
    });
  };

  const handleToggleMinimize = (id: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, isMinimized: !w.isMinimized } : w));
  };

  const handleCloseWindow = (id: string) => {
    setClosedWindows(prev => prev.includes(id) ? prev : [...prev, id]);
    if (maximizedWindow === id) setMaximizedWindow(null);
  };

  const handleRestoreWindow = (id: string) => setClosedWindows(prev => prev.filter(windowId => windowId !== id));
  const handleToggleMaximize = (id: string) => setMaximizedWindow(prev => prev === id ? null : id);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Filtered tenders calculation
  const filteredTenders = tenders.filter(t => {
    const matchesWard = selectedWard === 'All' || normalizeWardCode(t.ward) === selectedWard;
    const matchesContractor = session.role !== 'contractor' || (session.isMetaMask && t.contractor.toLowerCase() === session.address.toLowerCase());
    const matchesStatus = selectedStatus === 'All' || t.status === selectedStatus;
    const query = searchQuery.toLowerCase();
    const matchesSearch = !query || 
      t.title.toLowerCase().includes(query) ||
      t.tenderId.toLowerCase().includes(query) ||
      t.roadName.toLowerCase().includes(query) ||
      t.contractorName.toLowerCase().includes(query);
    return matchesWard && matchesContractor && matchesStatus && matchesSearch;
  });

  // Calculate formatters
  const formatInr = (amount: number) => {
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)} Lakh`;
    return `₹${amount.toLocaleString('en-IN')}`;
  };

  const calculateDaysRemaining = (expiryTimestamp: number) => {
    const diffSeconds = expiryTimestamp - Math.floor(clockNow / 1000);
    if (diffSeconds <= 0) return { days: 0, isExpired: true };
    const days = Math.floor(diffSeconds / 86400);
    return { days, isExpired: false };
  };

  const roleConfig = {
    engineer: { label: 'Executive engineer', eyebrow: 'Operations control', action: 'Create tender', icon: ShieldCheck, color: 'warning', focus: 'Sanction tenders, monitor delivery and issue breach notices.' },
    contractor: { label: 'Road contractor', eyebrow: 'Delivery workspace', action: 'Update milestone', icon: HardHat, color: 'danger', focus: 'Track awarded work, upload evidence and keep milestones current.' },
    citizen: { label: 'Citizen auditor', eyebrow: 'Public transparency', action: 'Report defect', icon: Eye, color: 'success', focus: 'Inspect public works, report defects and follow rectification.' },
    auditor: { label: 'Independent auditor', eyebrow: 'Evidence review', action: 'Review ledger', icon: ClipboardList, color: 'success', focus: 'Review the full municipal ledger and verify on-chain evidence.' },
  }[session.role];
  const RoleIcon = roleConfig.icon;
  const activeCount = filteredTenders.filter(t => t.status === 'in_progress' || t.status === 'warranty_active').length;
  const openDefects = defects.filter(d => d.status === 'open' || d.status === 'acknowledged').length;
  const exportVisibleReports = () => {
    const rows = defects.filter(d => `${d.ward} ${d.roadName} ${d.description} ${d.status} ${d.department || ''}`.toLowerCase().includes(reportSearch.toLowerCase()));
    const columns: (keyof DefectChallenge)[] = ['key', 'tenderId', 'ward', 'roadName', 'severity', 'description', 'status', 'timestamp', 'latitude', 'longitude', 'rectificationDeadline', 'txHash', 'evidencePhotoCid', 'repairEvidenceCid'];
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [columns.map(quote).join(','), ...rows.map(report => columns.map(column => quote(report[column])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `civicark-public-reports-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const reportResponseByWard = MUMBAI_WARDS.map(ward => {
    const acknowledged = defects.filter(defect => normalizeWardCode(defect.ward) === ward.code).flatMap(defect => {
      const firstResponse = defect.events?.find(event => event.status === 'acknowledged');
      return firstResponse && firstResponse.timestamp >= defect.timestamp ? [(firstResponse.timestamp - defect.timestamp) / 3600] : [];
    });
    return { ...ward, count: acknowledged.length, avgHours: acknowledged.length ? acknowledged.reduce((sum, hours) => sum + hours, 0) / acknowledged.length : null };
  }).filter(ward => ward.count > 0).sort((a, b) => (a.avgHours || 0) - (b.avgHours || 0));
  const wardMetrics = MUMBAI_WARDS.map(ward => {
    const wardTenders = tenders.filter(tender => normalizeWardCode(tender.ward) === ward.code);
    const wardDefects = defects.filter(defect => normalizeWardCode(defect.ward) === ward.code && (defect.status === 'open' || defect.status === 'acknowledged'));
    return {
      ...ward,
      totalTenders: wardTenders.length,
      activeWarrantyCount: wardTenders.filter(tender => tender.status === 'warranty_active').length,
      breachedCount: wardTenders.filter(tender => tender.status === 'breached').length,
      openDefects: wardDefects.length,
      totalBudgetInt: wardTenders.reduce((sum, tender) => sum + tender.budgetInr, 0),
    };
  });
  const navItems = [
    { id: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
    { id: 'work' as const, label: session.role === 'citizen' ? 'Public works' : session.role === 'contractor' ? 'Assigned works' : session.role === 'auditor' ? 'Audit ledger' : 'Work orders', icon: ClipboardList },
    { id: 'reports' as const, label: 'Issue reports', icon: ImagePlus },
    ...(session.role === 'engineer' || session.role === 'contractor' ? [{ id: 'operations' as const, label: 'Operations', icon: BriefcaseBusiness }] : []),
    ...(session.role === 'engineer' || session.role === 'auditor' ? [{ id: 'audit' as const, label: 'Evidence review', icon: ShieldCheck }] : []),
    ...(session.role === 'engineer' || session.role === 'auditor' ? [{ id: 'areas' as const, label: 'Ward coverage', icon: MapPinned }] : []),
    { id: 'map' as const, label: 'Live map', icon: Map },
    { id: 'activity' as const, label: 'Network status', icon: Activity },
  ];

  // Submit New Tender
  const handleCreateTender = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTenderTitle || !newTenderRoad || !/^0x[a-fA-F0-9]{40}$/.test(newTenderContractor) || !Number.isFinite(Number(newTenderBudget)) || Number(newTenderBudget) <= 0) {
      alert('Enter a project title, road name, positive budget, and valid contractor wallet address.');
      return;
    }

    setIsSubmittingTender(true);
    try {
      const budgetNum = Number(newTenderBudget);
      const targetWardInfo = MUMBAI_WARDS.find(w => w.code === newTenderWard);
      const tenderId = `BMC-${new Date().getFullYear()}-${newTenderWard.replace(/[^A-Z]/g, '')}-RD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

      const res = await createTenderOnArkiv({
        tenderId,
        title: newTenderTitle,
        city: 'Mumbai',
        ward: newTenderWard,
        wardName: targetWardInfo?.name || newTenderWard,
        roadName: newTenderRoad,
        category: 'roadwork',
        status: 'warranty_active',
        budgetInr: budgetNum,
        contractor: newTenderContractor,
        contractorName: newTenderContractorName || 'Contractor',
        engineer: session.address,
        engineerName: session.displayName,
        dlpYears: newTenderDlpYears,
        dlpExpiryTimestamp: Math.floor(Date.now() / 1000) + 86400 * 365 * newTenderDlpYears,
        defectCount: 0,
        awardedAt: Math.floor(Date.now() / 1000),
        specs: {
          material: newTenderMaterial,
          thicknessMm: Number(newTenderThickness) || 0,
          coreSampleLabCid: newTenderLabCid,
          labAccreditation: newTenderLabName,
        },
        milestones: [
          {
            phase: 'Tender Sanctioned on Arkiv Tiramisu',
            signedBy: session.address,
            role: session.role,
            timestamp: Math.floor(Date.now() / 1000),
            status: 'done',
            notes: 'Statutory Defect Liability Period locked with Arkiv TTL.',
          },
        ],
      }, session);

      // Trigger Confetti
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 },
      });

      // Update UI
      setTenders(prev => [res.tender, ...prev]);
      setSelectedTender(res.tender);
      setNewTenderTitle('');
      setNewTenderRoad('');
      setNewTenderBudget('');
      setNewTenderContractor('');
      setNewTenderContractorName('');
      setNewTenderLabCid('');
      setNewTenderLabName('');
      setNewTenderMaterial('');
      setNewTenderThickness('');
      alert(`✅ Municipal Tender minted on Arkiv!\n\nEntity Key: ${res.entityKey}\nTx Hash: ${res.txHash}`);
    } catch (err: any) {
      alert('Error creating tender: ' + err.message);
    } finally {
      setIsSubmittingTender(false);
    }
  };

  // Submit Defect Challenge
  const handleDefectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!defectDescription || (!defectRoad.trim() && !defectLatitude)) {
      alert('Describe the issue and add a road/landmark or GPS location.');
      return;
    }

    const targetTender = tenders.find(t => t.key === defectTargetKey || t.tenderId === defectTargetKey);
    if (Boolean(defectLatitude) !== Boolean(defectLongitude)) { alert('Enter both latitude and longitude, or leave both blank.'); return; }
    if (defectLatitude && (Number(defectLatitude) < 18.8 || Number(defectLatitude) > 19.5 || Number(defectLongitude) < 72.7 || Number(defectLongitude) > 73.1)) { alert('Enter a valid latitude and longitude within Mumbai.'); return; }

    setIsSubmittingDefect(true);
    try {
      let uploadedCid = defectEvidenceCid.trim();
      if (defectPhoto) {
        uploadedCid = await uploadSignedEvidence(defectPhoto, session);
      }
      const res = await submitDefectChallenge({
        tenderKey: targetTender?.key || 'unlinked',
        tenderId: targetTender?.tenderId || 'UNLINKED',
        ward: defectWard,
        roadName: defectRoad || targetTender?.roadName || 'Location not specified',
        severity: defectSeverity,
        description: defectDescription,
        evidencePhotoCid: uploadedCid,
        reportedBy: anonymousDisplay ? '' : session.address,
        reporterRole: session.role,
        latitude: defectLatitude ? Number(defectLatitude) : undefined,
        longitude: defectLongitude ? Number(defectLongitude) : undefined,
        anonymousDisplay,
        department: targetTender?.category === 'drainage' ? 'Storm Water Drains' : targetTender?.category === 'bridge' ? 'Bridges' : /drain|sewer|water|flood/i.test(defectDescription) ? 'Storm Water Drains' : /footpath|sidewalk|pedestrian/i.test(defectDescription) ? 'Footpaths' : /light|electric|street lamp/i.test(defectDescription) ? 'Road Lighting' : 'Roads',
      }, session);

      confetti({
        particleCount: 50,
        spread: 45,
        origin: { y: 0.7 },
      });

      setDefects(prev => [res.challenge, ...prev]);
      setDefectDescription('');
      setDefectEvidenceCid('');
      setDefectPhoto(null);
      
      // Update tender defect count in UI
      if (targetTender) setTenders(prev => prev.map(t => {
        if (t.key === targetTender.key) {
          return {
            ...t,
            defectCount: t.defectCount + 1,
            status: defectSeverity === 'critical' || defectSeverity === 'hazardous' ? 'breached' : t.status,
          };
        }
        return t;
      }));

      alert(`Defect report logged on Arkiv.\n\n${targetTender ? 'The linked contract has a 30-day rectification window.' : 'This report is public but is not linked to a registered Arkiv contract.'}\nTx Hash: ${res.txHash}`);
    } catch (err: any) {
      alert('Error logging defect: ' + err.message);
    } finally {
      setIsSubmittingDefect(false);
    }
  };

  const handleReportWorkflow = async (defect: DefectChallenge, status: DefectChallenge['status'], note: string, cid = '') => {
    if (!session.isMetaMask) { alert('Connect a wallet to sign a report update.'); return; }
    if (status === 'repair_submitted' && !cid.trim() && !reportEvidencePhoto) { alert('Upload a repair photo or add its IPFS CID before submitting.'); return; }
    const tender = tenders.find(item => item.key === defect.tenderKey || item.tenderId === defect.tenderId);
    if (session.role === 'contractor' && (!tender || tender.contractor.toLowerCase() !== session.address.toLowerCase())) { alert('Only the awarded contractor wallet can submit repair evidence for this work.'); return; }
    setUpdatingReportKey(defect.key || defect.txHash || defect.roadName);
    try {
      const evidenceCid = reportEvidencePhoto ? await uploadSignedEvidence(reportEvidencePhoto, session) : cid.trim();
      const updated = await updateDefectOnArkiv(defect, status, note, evidenceCid, session);
      setDefects(previous => previous.map(item => item.key === defect.key ? updated : item));
      setReportEvidenceCid('');
      setReportEvidencePhoto(null);
      alert(`Report workflow updated on Arkiv.\nTransaction: ${updated.txHash}`);
    } catch (error) { alert(`Could not update this report: ${error instanceof Error ? error.message : String(error)}. The entity may be writable only by its creator wallet.`); }
    finally { setUpdatingReportKey(null); }
  };

  // Submit Milestone Patch
  const handlePatchMilestone = async () => {
    if (!selectedTender) return;
    if (session.role === 'contractor' && (!session.isMetaMask || selectedTender.contractor.toLowerCase() !== session.address.toLowerCase())) { alert('This connected wallet is not the awarded contractor for the selected work.'); return; }
    setIsPatching(true);

    try {
      const newMilestone = {
        phase: milestonePhase,
        signedBy: session.address,
        role: session.role,
        timestamp: Math.floor(Date.now() / 1000),
        status: 'done' as const,
        notes: milestoneNotes,
      };

      const res = await patchTenderOnArkiv(
        selectedTender.key,
        { status: 'warranty_active' },
        newMilestone,
        session
      );

      confetti({ particleCount: 60, spread: 50 });
      setSelectedTender(res.updatedTender);
      setTenders(prev => prev.map(t => t.key === selectedTender.key ? res.updatedTender : t));
      alert(`✅ Milestone patched on Arkiv!\n\nTx Hash: ${res.txHash}`);
    } catch (err: any) {
      alert('Error patching milestone: ' + err.message);
    } finally {
      setIsPatching(false);
    }
  };

  return (
    <div className="app-shell product-shell">
      <NagrikSaathi key={`${session.role}:${session.address.toLowerCase()}`} session={session} onNavigate={page => setActiveSection(page)} onRefresh={() => { void loadData(); }} />
      <aside className="product-sidebar">
        <div className="sidebar-section-label">Workspace</div>
        <nav className="product-nav">
          {navItems.map(item => { const Icon = item.icon; return <button key={item.id} className={activeSection === item.id ? 'active' : ''} onClick={() => setActiveSection(item.id)}><Icon size={16} /><span>{item.label}</span>{activeSection === item.id && <span className="nav-active-dot" />}</button>; })}
        </nav>
        <div className="sidebar-section-label">Your role</div>
        <div className="role-card"><RoleIcon size={16} /><div><strong>{roleConfig.label}</strong><span>{session.ward || 'Mumbai'}</span></div></div>
      <div className="sidebar-bottom"><div className="sidebar-network">Tiramisu testnet</div><div className="sidebar-identity"><span>{session.displayName}</span><code>{session.isMetaMask ? `${session.address.slice(0, 6)}…${session.address.slice(-4)}` : 'Read-only preview'}</code></div></div>
      </aside>
      <main className="product-content">
        <div className="product-topbar"><div><span className="breadcrumb">Workspace <ChevronRight size={13} /> {roleConfig.eyebrow}</span><h1>{activeSection === 'overview' ? 'Good morning, {name}'.replace('{name}', session.displayName.split(' ')[0]) : navItems.find(item => item.id === activeSection)?.label}</h1></div><div className="topbar-actions"><button className="primary-action" onClick={() => onOpenAuth()}><Plus size={16} /> Switch role</button></div></div>
        {activeSection === 'overview' && <div className="role-context"><div className={`role-icon role-${roleConfig.color}`}><RoleIcon size={18} /></div><div><strong>{roleConfig.focus}</strong><span>Use the role-specific workspace pages to review live records and take action. Role labels are not municipal identity verification.</span></div><button className="context-link" onClick={() => setActiveSection(session.role === 'citizen' ? 'reports' : session.role === 'auditor' ? 'audit' : 'work')}>{roleConfig.action} <ChevronRight size={14} /></button></div>}
        {activeSection === 'overview' && <div className="metric-strip"><div className="metric-card"><span>Active works</span><strong>{activeCount}</strong><small><BriefcaseBusiness size={12} /> {tenderSource === 'arkiv_chain' ? 'Live Arkiv' : tenderSource === 'synced_cache' ? 'Cached snapshot' : 'Loading records'}</small></div><div className="metric-card"><span>Open defects</span><strong>{openDefects}</strong><small className={openDefects > 0 ? 'metric-warning' : ''}><AlertTriangle size={12} /> Current reports</small></div><div className="metric-card"><span>Areas covered</span><strong>{MUMBAI_WARDS.length}</strong><small><MapPinned size={12} /> Mumbai wards</small></div></div>}
        {closedWindows.length > 0 && <div className="closed-windows"><span>Closed panels</span>{closedWindows.map(id => { const panel = windows.find(window => window.id === id); return panel ? <button key={id} onClick={() => handleRestoreWindow(id)}>{panel.title}<Plus size={13}/></button> : null; })}</div>}
      {/* Dynamic Windows Grid */}
      <div className="windows-grid" data-view={activeSection}>
        {/* =========================================================================
            WINDOW 1: Active Municipal Tenders & Warranties Ledger
            ========================================================================= */}
        <WindowFrame
          id="w-tenders"
          title="Active Municipal Tenders & Warranties"
          category="LEDGER"
          size={windows.find(w => w.id === 'w-tenders')?.size || '2x'}
          isMinimized={windows.find(w => w.id === 'w-tenders')?.isMinimized || false}
          onSizeChange={handleWindowSizeChange}
          onToggleMinimize={handleToggleMinimize}
          onClose={handleCloseWindow}
          isMaximized={maximizedWindow === 'w-tenders'}
          onToggleMaximize={handleToggleMaximize}
          isClosed={closedWindows.includes('w-tenders')}
          view={activeSection}
          role={session.role}
          onMove={handleMoveWindow}
          order={windows.find(w => w.id === 'w-tenders')?.order}
          widthSpan={windows.find(w => w.id === 'w-tenders')?.widthSpan}
          heightPx={windows.find(w => w.id === 'w-tenders')?.heightPx}
          columnStart={windows.find(w => w.id === 'w-tenders')?.columnStart}
          offsetY={windows.find(w => w.id === 'w-tenders')?.offsetY}
          onResize={handlePanelResize}
          onRefresh={loadData}
          isRefreshing={isRefreshing}
          badge={<span className="badge badge-success">{filteredTenders.length} works</span>}
        >
          {/* Filters Bar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
            {/* Search */}
            <div style={{ flex: '1 1 200px', position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search by road, contractor, tender ID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="tech-input"
                style={{ paddingLeft: '32px' }}
              />
            </div>

            {/* Ward Select */}
            <select
              value={selectedWard}
              onChange={e => setSelectedWard(e.target.value)}
              className="tech-input"
              style={{ flex: '0 1 170px' }}
            >
              <option value="All">All Wards (Mumbai)</option>
              {MUMBAI_WARDS.map(w => (
                <option key={w.code} value={w.code}>{w.code} - {w.name.split('/')[0]}</option>
              ))}
            </select>

            {/* Status Select */}
            <select
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
              className="tech-input"
              style={{ flex: '0 1 170px' }}
            >
              <option value="All">All Statuses</option>
              <option value="warranty_active">Warranty Active</option>
              <option value="in_progress">In Progress</option>
              <option value="breached">Breached (Notice)</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          {/* Tenders Table / List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredTenders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                No municipal tenders matching the selected filters.
              </div>
            ) : (
              filteredTenders.map(t => {
                const daysInfo = calculateDaysRemaining(t.dlpExpiryTimestamp);
                const isSelected = selectedTender?.key === t.key;

                return (
                  <div
                    key={t.key}
                    onClick={() => {
                      setSelectedTender(t);
                      setDefectTargetKey(t.key);
                      setDefectRoad(t.roadName);
                    }}
                    style={{
                      border: isSelected ? '2px solid var(--accent-primary)' : '1px solid var(--border-light)',
                      backgroundColor: isSelected ? 'var(--bg-secondary)' : 'var(--bg-card)',
                      padding: '14px 16px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    className="hover-card pixel-corner"
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.72rem', color: 'var(--accent-primary)' }}>
                            {t.tenderId}
                          </span>
                          <span className="badge" style={{ fontSize: '0.65rem' }}>
                            WARD {t.ward}
                          </span>
                          {t.status === 'warranty_active' && (
                            <span className="badge badge-success">DLP ACTIVE</span>
                          )}
                          {t.status === 'breached' && (
                            <span className="badge badge-danger">WARRANTY BREACH</span>
                          )}
                          {t.status === 'in_progress' && (
                            <span className="badge badge-warning">IN PROGRESS</span>
                          )}
                        </div>

                        <div style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '6px' }}>
                          {t.title}
                        </div>

                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          📍 {t.roadName}
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '0.95rem' }}>
                          {formatInr(t.budgetInr)}
                        </div>
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.68rem',
                          marginTop: '4px',
                          color: t.status === 'breached' ? 'var(--accent-rose)' : 'var(--accent-emerald)',
                          fontWeight: 600,
                        }}>
                          {t.status === 'breached'
                            ? `${t.defectCount} Defect Challenge Active`
                            : `🛡️ ${daysInfo.days} Days Warranty Left`}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </WindowFrame>

        <WindowFrame
          id="w-real-map"
          title="Mumbai geographic view"
          category="OPENSTREETMAP"
          size={windows.find(w => w.id === 'w-real-map')?.size || '2x'}
          isMinimized={windows.find(w => w.id === 'w-real-map')?.isMinimized || false}
          onSizeChange={handleWindowSizeChange}
          onToggleMinimize={handleToggleMinimize}
          onClose={handleCloseWindow}
          isMaximized={maximizedWindow === 'w-real-map'}
          onToggleMaximize={handleToggleMaximize}
          isClosed={closedWindows.includes('w-real-map')}
          view={activeSection}
          role={session.role}
          onMove={handleMoveWindow}
          order={windows.find(w => w.id === 'w-real-map')?.order}
          widthSpan={windows.find(w => w.id === 'w-real-map')?.widthSpan}
          heightPx={windows.find(w => w.id === 'w-real-map')?.heightPx}
          columnStart={windows.find(w => w.id === 'w-real-map')?.columnStart}
          offsetY={windows.find(w => w.id === 'w-real-map')?.offsetY}
          onResize={handlePanelResize}
          badge={<span className="badge">OPENSTREETMAP</span>}
        >
          <RealWardMap selectedWard={selectedWard} onSelect={setSelectedWard} tenders={tenders} defects={defects} />
        </WindowFrame>

        {/* =========================================================================
            WINDOW 4: Mumbai ward work summary
            ========================================================================= */}
        <WindowFrame
          id="w-wards"
          title="Mumbai ward work summary"
          category="WORK SUMMARY"
          size={windows.find(w => w.id === 'w-wards')?.size || '1x'}
          isMinimized={windows.find(w => w.id === 'w-wards')?.isMinimized || false}
          onSizeChange={handleWindowSizeChange}
          onToggleMinimize={handleToggleMinimize}
          onClose={handleCloseWindow}
          isMaximized={maximizedWindow === 'w-wards'}
          onToggleMaximize={handleToggleMaximize}
          isClosed={closedWindows.includes('w-wards')}
          view={activeSection}
          role={session.role}
          onMove={handleMoveWindow}
          order={windows.find(w => w.id === 'w-wards')?.order}
          widthSpan={windows.find(w => w.id === 'w-wards')?.widthSpan}
          heightPx={windows.find(w => w.id === 'w-wards')?.heightPx}
          columnStart={windows.find(w => w.id === 'w-wards')?.columnStart}
          offsetY={windows.find(w => w.id === 'w-wards')?.offsetY}
          onResize={handlePanelResize}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {wardMetrics.map(w => {
              const isSelected = selectedWard === w.code;
              return (
                <div
                  key={w.code}
                  onClick={() => setSelectedWard(isSelected ? 'All' : w.code)}
                  style={{
                    border: isSelected ? '2px solid var(--accent-primary)' : '1px solid var(--border-light)',
                    backgroundColor: isSelected ? 'var(--bg-secondary)' : 'var(--bg-card)',
                    padding: '10px 12px',
                    cursor: 'pointer',
                  }}
                  className="hover-card"
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="tag-dot" />
                      <span style={{ fontWeight: 700, fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                        {w.code}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        ({w.area})
                      </span>
                    </div>

                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>{w.totalTenders} recorded works</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                    <span>Recorded budget: {formatInr(w.totalBudgetInt)}</span>
                    <span>Warranties: {w.activeWarrantyCount}</span>
                    <span style={{ color: w.openDefects > 0 ? 'var(--accent-rose)' : 'inherit' }}>
                      Defects: {w.openDefects}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </WindowFrame>

        {/* =========================================================================
            WINDOW 3: Cryptographic Tender Inspector
            ========================================================================= */}
        <WindowFrame
          id="w-inspector"
          title="Cryptographic Tender Inspector"
          category="AUDIT"
          size={windows.find(w => w.id === 'w-inspector')?.size || '1x'}
          isMinimized={windows.find(w => w.id === 'w-inspector')?.isMinimized || false}
          onSizeChange={handleWindowSizeChange}
          onToggleMinimize={handleToggleMinimize}
          onClose={handleCloseWindow}
          isMaximized={maximizedWindow === 'w-inspector'}
          onToggleMaximize={handleToggleMaximize}
          isClosed={closedWindows.includes('w-inspector')}
          view={activeSection}
          role={session.role}
          onMove={handleMoveWindow}
          order={windows.find(w => w.id === 'w-inspector')?.order}
          widthSpan={windows.find(w => w.id === 'w-inspector')?.widthSpan}
          heightPx={windows.find(w => w.id === 'w-inspector')?.heightPx}
          columnStart={windows.find(w => w.id === 'w-inspector')?.columnStart}
          offsetY={windows.find(w => w.id === 'w-inspector')?.offsetY}
          onResize={handlePanelResize}
        >
          {selectedTender ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <span className="tag-label" style={{ marginBottom: '4px' }}>INSPECTING ON-CHAIN ENTITY</span>
                <h4 style={{ fontSize: '0.98rem' }}>{selectedTender.title}</h4>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                  {selectedTender.tenderId} · Ward {selectedTender.ward}
                </div>
              </div>

              {/* Entity Key Box */}
              <div style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-light)',
                padding: '10px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.68rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', color: 'var(--text-muted)' }}>
                  <span>ARKIV ENTITY KEY (KECCAK)</span>
                  <button
                    onClick={() => copyToClipboard(selectedTender.key, 'key')}
                    className="window-btn"
                    style={{ width: 'auto', padding: '0 4px', height: '18px', fontSize: '0.62rem' }}
                  >
                    {copiedKey === 'key' ? <Check size={10} /> : <Copy size={10} />}
                  </button>
                </div>
                <div style={{ wordBreak: 'break-all', fontWeight: 600 }}>
                  {selectedTender.key}
                </div>
              </div>

              {/* Warranty & Contractor Info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                <div style={{ padding: '8px', border: '1px solid var(--border-light)', backgroundColor: 'var(--bg-secondary)' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.62rem' }}>CONTRACTOR WALLET</div>
                  <div style={{ fontWeight: 600, marginTop: '2px' }}>
                    {selectedTender.contractor.slice(0, 8)}...{selectedTender.contractor.slice(-4)}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                    {selectedTender.contractorName}
                  </div>
                </div>

                <div style={{ padding: '8px', border: '1px solid var(--border-light)', backgroundColor: 'var(--bg-secondary)' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.62rem' }}>ENGINEER WALLET</div>
                  <div style={{ fontWeight: 600, marginTop: '2px' }}>
                    {selectedTender.engineer.slice(0, 8)}...{selectedTender.engineer.slice(-4)}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                    {selectedTender.engineerName.split(' ')[0]} {selectedTender.engineerName.split(' ')[1] || ''}
                  </div>
                </div>
              </div>

              {/* Material Specs */}
              <div style={{ border: '1px solid var(--border-light)', padding: '10px', fontSize: '0.72rem' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, marginBottom: '4px', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  LAB SPECIFICATION & ACCREDITATION
                </div>
                <div>{selectedTender.specs.material || 'Material not provided'}{selectedTender.specs.thicknessMm ? ` (${selectedTender.specs.thicknessMm}mm)` : ''}</div>
                <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)', marginTop: '4px', wordBreak: 'break-all' }}>
                  {selectedTender.specs.coreSampleLabCid || 'No lab report linked'}
                </div>
              </div>

              {/* Milestones History */}
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.7rem', marginBottom: '8px', color: 'var(--text-muted)' }}>
                  ON-CHAIN AUDIT TRAIL ({selectedTender.milestones.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {selectedTender.milestones.map((m, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '6px 8px',
                        borderLeft: '2px solid var(--accent-primary)',
                        backgroundColor: 'var(--bg-secondary)',
                        fontSize: '0.7rem',
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{m.phase}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        Signed by {m.signedBy.slice(0, 8)}... ({m.role})
                      </div>
                      {m.notes && <div style={{ fontSize: '0.65rem', marginTop: '2px' }}>{m.notes}</div>}
                    </div>
                  ))}
                </div>
              </div>

              {/* External Explorer Link */}
              <a
                href={`${TIRAMISU_EXPLORER_URL}/address/${selectedTender.key}`}
                target="_blank"
                rel="noreferrer noopener"
                className="btn btn-ghost btn-sm"
                style={{ width: '100%' }}
              >
                <span>View on Tiramisu Explorer</span>
                <ExternalLink size={12} />
              </a>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Select a tender from the ledger to inspect its Keccak cryptographic state.
            </div>
          )}
        </WindowFrame>

        {/* =========================================================================
            WINDOW 4: Citizen Defect Reporter & Pothole Challenge
            ========================================================================= */}
        <WindowFrame
          id="w-defect"
          title="Report Defect & Challenge DLP"
          category="CITIZEN"
          size={windows.find(w => w.id === 'w-defect')?.size || '1x'}
          isMinimized={windows.find(w => w.id === 'w-defect')?.isMinimized || false}
          onSizeChange={handleWindowSizeChange}
          onToggleMinimize={handleToggleMinimize}
          onClose={handleCloseWindow}
          isMaximized={maximizedWindow === 'w-defect'}
          onToggleMaximize={handleToggleMaximize}
          isClosed={closedWindows.includes('w-defect')}
          view={activeSection}
          role={session.role}
          onMove={handleMoveWindow}
          order={windows.find(w => w.id === 'w-defect')?.order}
          widthSpan={windows.find(w => w.id === 'w-defect')?.widthSpan}
          heightPx={windows.find(w => w.id === 'w-defect')?.heightPx}
          columnStart={windows.find(w => w.id === 'w-defect')?.columnStart}
          offsetY={windows.find(w => w.id === 'w-defect')?.offsetY}
          onResize={handlePanelResize}
        >
          <form onSubmit={handleDefectSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Report a pothole, broken footpath, drainage issue or other public-space problem. Reports can be linked to a registered work contract or submitted without one.
            </p>

            <div>
              <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', marginBottom: '4px' }}>
                TARGET TENDER / ROAD:
              </label>
              <select
                value={defectTargetKey}
                onChange={e => {
                  setDefectTargetKey(e.target.value);
                  const match = tenders.find(t => t.key === e.target.value);
                  setDefectRoad(match?.roadName || '');
                }}
                className="tech-input"
              >
                <option value="">No matching contract · general civic report</option>
                {tenders.map(t => (
                  <option key={t.key} value={t.key}>
                    {t.tenderId} - {t.roadName.slice(0, 32)}...
                  </option>
                ))}
              </select>
            </div>

            <div className="form-grid-two">
              <label className="form-field">BMC WARD<select className="tech-input" value={defectWard} onChange={event => setDefectWard(event.target.value)}>{MUMBAI_WARDS.map(ward => <option key={ward.code} value={ward.code}>{ward.code} · {ward.name}</option>)}</select></label>
              <label className="form-field">ROAD / LANDMARK<input className="tech-input" value={defectRoad} onChange={event => setDefectRoad(event.target.value)} placeholder="Street, junction or nearby landmark" /></label>
            </div>

            <div className="form-location-row"><div className="form-grid-two"><label className="form-field">LATITUDE<input className="tech-input" inputMode="decimal" value={defectLatitude} onChange={event => setDefectLatitude(event.target.value)} placeholder="19.0760" /></label><label className="form-field">LONGITUDE<input className="tech-input" inputMode="decimal" value={defectLongitude} onChange={event => setDefectLongitude(event.target.value)} placeholder="72.8777" /></label></div><button type="button" className="location-action" onClick={() => { if (!navigator.geolocation) { alert('Location access is not supported by this browser.'); return; } navigator.geolocation.getCurrentPosition(position => { setDefectLatitude(position.coords.latitude.toFixed(6)); setDefectLongitude(position.coords.longitude.toFixed(6)); }, error => alert(`Could not access location: ${error.message}`), { enableHighAccuracy: true, timeout: 10000 }); }}><Crosshair size={14} /> Use my location</button></div>

            <div>
              <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', marginBottom: '4px' }}>
                SEVERITY CLASSIFICATION:
              </label>
              <select
                value={defectSeverity}
                onChange={e => setDefectSeverity(e.target.value as DefectSeverity)}
                className="tech-input"
              >
                <option value="minor">Minor (Surface ravelling &lt; 20mm)</option>
                <option value="moderate">Moderate (Cracking / small potholes)</option>
                <option value="critical">Critical (Severe crater / settlement)</option>
                <option value="hazardous">Hazardous (Immediate traffic fatality risk)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', marginBottom: '4px' }}>
                DEFECT DESCRIPTION & EVIDENCE NOTE:
              </label>
              <textarea
                rows={3}
                placeholder="e.g. 8-inch deep crater near JVPD junction causing two-wheeler skids. Rainwater accumulation..."
                value={defectDescription}
                onChange={e => setDefectDescription(e.target.value)}
                className="tech-input"
              />
            </div>
            <label className="form-field">PHOTO EVIDENCE<input type="file" accept="image/jpeg,image/png,image/webp,image/heic" onChange={event => setDefectPhoto(event.target.files?.[0] || null)} className="tech-input" />{defectPhoto && <span className="photo-selected"><ImagePlus size={13} /> {defectPhoto.name} · {(defectPhoto.size / 1024 / 1024).toFixed(1)} MB</span>}<span className="field-hint">Up to 3 MB. Upload uses the server-configured IPFS provider; without it, paste an existing CID below.</span></label>
            <label className="form-field">EXISTING IPFS CID (OPTIONAL)<input value={defectEvidenceCid} onChange={e => setDefectEvidenceCid(e.target.value)} className="tech-input" placeholder="bafy…" /></label>
            <label className="anonymous-toggle"><input type="checkbox" checked={anonymousDisplay} onChange={event => setAnonymousDisplay(event.target.checked)} /><span>Hide my identity in the public report display</span></label>
            <p className="privacy-note">On-chain activity is public: this hides your name/address from the report payload and app list, but the signing wallet can still be visible in transaction metadata. True anonymity needs a privacy-preserving relayer.</p>

            <button
              type="submit"
                disabled={isSubmittingDefect || !session.isMetaMask}
              className="btn btn-primary"
              style={{ width: '100%', padding: '10px' }}
            >
                {isSubmittingDefect ? 'Publishing report…' : !session.isMetaMask ? 'Connect a wallet to publish' : 'Publish public report on Arkiv'}
            </button>
          </form>

          {/* Active Defects List */}
          {defects.length > 0 ? (
            <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-light)', paddingTop: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontFamily: 'var(--font-mono)', fontSize: '0.68rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-muted)' }}>
                <span>PUBLIC REPORT LEDGER ({defects.length})</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={exportVisibleReports} title="Export filtered public reports as CSV"><Download size={13}/> Export CSV</button>
              </div>
              <div className="report-insights"><div><span>Awaiting action</span><strong>{defects.filter(item => ['open', 'acknowledged', 'assigned'].includes(item.status)).length}</strong></div><div><span>Repair submitted</span><strong>{defects.filter(item => item.status === 'repair_submitted').length}</strong></div><div><span>Verified repairs</span><strong>{defects.filter(item => ['verified', 'rectified'].includes(item.status)).length}</strong></div><div><span>Avg. first response</span><strong>{reportResponseByWard.length ? `${(reportResponseByWard.reduce((sum, ward) => sum + ward.avgHours! * ward.count, 0) / reportResponseByWard.reduce((sum, ward) => sum + ward.count, 0)).toFixed(1)}h` : '—'}</strong></div></div>
              {reportResponseByWard.length > 0 && <div className="response-trends"><span>FIRST RESPONSE BY WARD · REPORTED WORKFLOW DATA</span>{reportResponseByWard.slice(0, 5).map(ward => <div key={ward.code}><span>{ward.code}</span><div><i style={{ width: `${Math.max(4, Math.min(100, (ward.avgHours! / Math.max(...reportResponseByWard.map(item => item.avgHours || 1))) * 100))}%` }} /></div><strong>{ward.avgHours!.toFixed(1)}h</strong><small>{ward.count} reports</small></div>)}</div>}
              <input className="tech-input" value={reportSearch} onChange={event => setReportSearch(event.target.value)} placeholder="Filter reports by ward, road, issue or status" aria-label="Filter public reports" />
              <label className="form-field" style={{ margin: '8px 0' }}>REPAIR PHOTO EVIDENCE<input className="tech-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setReportEvidencePhoto(event.target.files?.[0] || null)} /><span className="field-hint">Signed upload to configured IPFS provider; max 3 MB. {reportEvidencePhoto?.name || 'You can alternatively paste an existing CID.'}</span><input className="tech-input" value={reportEvidenceCid} onChange={event => setReportEvidenceCid(event.target.value)} placeholder="Existing IPFS CID (optional)" /></label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 8 }}>
                {defects.filter(d => `${d.ward} ${d.roadName} ${d.description} ${d.status} ${d.department || ''}`.toLowerCase().includes(reportSearch.toLowerCase())).map((d, i) => {
                  const nearby = d.latitude && d.longitude ? defects.filter(other => other !== d && other.latitude && other.longitude && Math.hypot((other.latitude! - d.latitude!) * 111, (other.longitude! - d.longitude!) * 105) < .1).length : 0;
                  const canAcknowledge = session.role === 'engineer' && d.status === 'open';
                  const canAssign = session.role === 'engineer' && d.status === 'acknowledged';
                  const canRepair = session.role === 'contractor' && d.status === 'assigned';
                  const canVerify = (session.role === 'auditor' || session.role === 'citizen') && d.status === 'repair_submitted';
                  return <article key={d.key || d.txHash || i} style={{ padding: '10px', border: '1px solid var(--border-light)', borderRadius: 7, background: 'var(--bg-secondary)', fontSize: '.7rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 700 }}><span>{d.ward} · {d.roadName || 'Location pending'}</span><span className="badge badge-danger">{d.severity}</span></div>
                    <p style={{ color: 'var(--text-secondary)', margin: '5px 0' }}>{d.description}</p>
                    <div style={{ color: 'var(--text-muted)' }}>Suggested route: {d.department || 'Roads'} · {d.status.replaceAll('_', ' ')}{nearby ? ` · ${nearby} nearby report${nearby === 1 ? '' : 's'} within ~100 m` : ''}{d.tenderId !== 'UNLINKED' ? ` · ${d.tenderId}` : ''}</div>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setSelectedReport(d)}>Open full report</button>
                    {d.evidencePhotoCid && <a href={`https://ipfs.io/ipfs/${encodeURIComponent(d.evidencePhotoCid)}`} target="_blank" rel="noreferrer">View original photo evidence</a>}
                    {d.repairEvidenceCid && <a href={`https://ipfs.io/ipfs/${encodeURIComponent(d.repairEvidenceCid)}`} target="_blank" rel="noreferrer" style={{ marginLeft: 10 }}>View repair evidence</a>}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>{(d.events || []).map((event, eventIndex) => <span key={eventIndex} title={`${event.role} · ${new Date(event.timestamp * 1000).toLocaleString()} · ${event.note}`} className="badge">{event.status.replaceAll('_', ' ')}</span>)}</div>
                    {(canAcknowledge || canAssign || canRepair || canVerify) && <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      {canAcknowledge && <button className="btn btn-ghost btn-sm" disabled={!!updatingReportKey} onClick={() => void handleReportWorkflow(d, 'acknowledged', 'Reviewed by municipal engineer')}>Acknowledge</button>}
                      {canAssign && <button className="btn btn-ghost btn-sm" disabled={!!updatingReportKey} onClick={() => void handleReportWorkflow(d, 'assigned', `Suggested routing: ${d.department || 'Roads'} · ${d.ward}`)}>Route to ward</button>}
                      {canRepair && <button className="btn btn-primary btn-sm" disabled={!!updatingReportKey} onClick={() => void handleReportWorkflow(d, 'repair_submitted', 'Contractor submitted repair evidence', reportEvidenceCid)}>Submit repair proof</button>}
                      {canVerify && <button className="btn btn-primary btn-sm" disabled={!!updatingReportKey} onClick={() => void handleReportWorkflow(d, 'verified', 'Repair evidence reviewed and verified')}>Verify repair</button>}
                    </div>}
                  </article>;
                })}
              </div>
            </div>
          ) : <div className="report-empty-state"><div className="report-empty-icon"><ImagePlus size={18}/></div><strong>No public reports loaded</strong><span>Reports appear here after they are published on Arkiv. Check the live map or refresh the workspace if you expected to see a report.</span></div>}
        </WindowFrame>

        {/* =========================================================================
            WINDOW 5: Sanction Tender & Patch Milestones
            ========================================================================= */}
        <WindowFrame
          id="w-mutations"
          title="Sanction Tender & Patch Milestones"
          category="GOVERNANCE"
          size={windows.find(w => w.id === 'w-mutations')?.size || '1x'}
          isMinimized={windows.find(w => w.id === 'w-mutations')?.isMinimized || false}
          onSizeChange={handleWindowSizeChange}
          onToggleMinimize={handleToggleMinimize}
          onClose={handleCloseWindow}
          isMaximized={maximizedWindow === 'w-mutations'}
          onToggleMaximize={handleToggleMaximize}
          isClosed={closedWindows.includes('w-mutations')}
          view={activeSection}
          role={session.role}
          onMove={handleMoveWindow}
          order={windows.find(w => w.id === 'w-mutations')?.order}
          widthSpan={windows.find(w => w.id === 'w-mutations')?.widthSpan}
          heightPx={windows.find(w => w.id === 'w-mutations')?.heightPx}
          columnStart={windows.find(w => w.id === 'w-mutations')?.columnStart}
          offsetY={windows.find(w => w.id === 'w-mutations')?.offsetY}
          onResize={handlePanelResize}
        >
          {session.role === 'engineer' ? (
            /* Municipal Engineer View: Sanction New Tender */
            <form onSubmit={handleCreateTender} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div className="tag-label" style={{ marginBottom: '4px' }}>
                <span>SANCTION NEW ROADWORK TENDER</span>
              </div>

              <div>
                <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', marginBottom: '2px' }}>
                  PROJECT TITLE:
                </label>
                <input
                  type="text"
                  placeholder="e.g. Juhu Circle Mastic Asphalt Resurfacing"
                  value={newTenderTitle}
                  onChange={e => setNewTenderTitle(e.target.value)}
                  className="tech-input"
                  style={{ padding: '8px 10px', fontSize: '0.75rem' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', marginBottom: '2px' }}>
                    WARD:
                  </label>
                  <select
                    value={newTenderWard}
                    onChange={e => setNewTenderWard(e.target.value)}
                    className="tech-input"
                    style={{ padding: '8px', fontSize: '0.75rem' }}
                  >
                    {MUMBAI_WARDS.map(w => (
                      <option key={w.code} value={w.code}>{w.code}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', marginBottom: '2px' }}>
                    STATUTORY DLP:
                  </label>
                  <select
                    value={newTenderDlpYears}
                    onChange={e => setNewTenderDlpYears(Number(e.target.value))}
                    className="tech-input"
                    style={{ padding: '8px', fontSize: '0.75rem' }}
                  >
                    <option value={3}>3 Years (Asphalt)</option>
                    <option value={5}>5 Years (Concrete)</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', marginBottom: '2px' }}>
                  TARGET CORRIDOR / ROAD NAME:
                </label>
                <input
                  type="text"
                  placeholder="e.g. Juhu Tara Road, Hotel Sea Princess to Moragaon"
                  value={newTenderRoad}
                  onChange={e => setNewTenderRoad(e.target.value)}
                  className="tech-input"
                  style={{ padding: '8px 10px', fontSize: '0.75rem' }}
                />
              </div>

              <div className="form-grid-two">
                <label className="form-field">CONTRACTOR WALLET ADDRESS<input value={newTenderContractor} onChange={e => setNewTenderContractor(e.target.value)} className="tech-input" placeholder="0x…" autoComplete="off" /></label>
                <label className="form-field">CONTRACTOR / ORGANIZATION<input value={newTenderContractorName} onChange={e => setNewTenderContractorName(e.target.value)} className="tech-input" placeholder="Registered name (optional)" /></label>
              </div>
              <div className="form-grid-two">
                <label className="form-field">LAB REPORT CID<input value={newTenderLabCid} onChange={e => setNewTenderLabCid(e.target.value)} className="tech-input" placeholder="ipfs://… (optional)" /></label>
                <label className="form-field">LAB / ACCREDITATION<input value={newTenderLabName} onChange={e => setNewTenderLabName(e.target.value)} className="tech-input" placeholder="Verified lab details" /></label>
              </div>
              <div className="form-grid-two">
                <label className="form-field">MATERIAL<input value={newTenderMaterial} onChange={e => setNewTenderMaterial(e.target.value)} className="tech-input" placeholder="Project specification (optional)" /></label>
                <label className="form-field">LAYER THICKNESS (MM)<input type="number" min="0" value={newTenderThickness} onChange={e => setNewTenderThickness(e.target.value)} className="tech-input" placeholder="As specified (optional)" /></label>
              </div>

              <div>
                <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', marginBottom: '2px' }}>
                  BUDGET (INR):
                </label>
                <input
                  type="number"
                  value={newTenderBudget}
                  onChange={e => setNewTenderBudget(e.target.value)}
                  className="tech-input"
                  style={{ padding: '8px 10px', fontSize: '0.75rem' }}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingTender || !session.isMetaMask}
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '6px' }}
              >
                {isSubmittingTender ? 'Submitting to Tiramisu...' : session.isMetaMask ? 'Sanction & record on Arkiv' : 'Connect a wallet to submit'}
              </button>
            </form>
          ) : session.role === 'contractor' ? (
            /* Contractor View: Patch Milestones */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="tag-label">
                <span>CONTRACTOR MILESTONE SIGN-OFF</span>
              </div>

              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                As the awarded contractor, call <code>patchEntity</code> on Arkiv to append verified compaction test certificates.
              </p>

              <div>
                <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', marginBottom: '4px' }}>
                  TARGET TENDER:
                </label>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700 }}>
                  {selectedTender?.tenderId || 'No Tender Selected'}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', marginBottom: '4px' }}>
                  MILESTONE PHASE:
                </label>
                <input
                  type="text"
                  value={milestonePhase}
                  onChange={e => setMilestonePhase(e.target.value)}
                  className="tech-input"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', marginBottom: '4px' }}>
                  COMPACTION & LAB TEST REPORT NOTES:
                </label>
                <textarea
                  rows={2}
                  value={milestoneNotes}
                  onChange={e => setMilestoneNotes(e.target.value)}
                  className="tech-input"
                />
              </div>

              <button
                onClick={handlePatchMilestone}
                disabled={isPatching || !selectedTender || !session.isMetaMask}
                className="btn btn-primary"
                style={{ width: '100%' }}
              >
                {isPatching ? 'Submitting update...' : !session.isMetaMask ? 'Connect a wallet to submit' : 'Sign & record milestone'}
              </button>
            </div>
          ) : (
            /* Citizen / Auditor View */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'center', padding: '20px 0' }}>
              <ShieldCheck size={32} style={{ margin: '0 auto', color: 'var(--accent-emerald)' }} />
              <div>
                <h4 style={{ fontSize: '0.9rem', marginBottom: '4px' }}>Citizen Public Inspection Mode</h4>
                <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                  You are in public auditor mode. To sanction new road tenders or upload tarmac compaction lab tests, switch your role to <strong>Municipal Engineer</strong> or <strong>Contractor</strong>.
                </p>
              </div>
              <button onClick={onOpenAuth} className="btn btn-ghost" style={{ alignSelf: 'center' }}>
                Switch to Authority Role
              </button>
            </div>
          )}
        </WindowFrame>

        {/* =========================================================================
            WINDOW 6: Arkiv RPC status
            ========================================================================= */}
        <WindowFrame
          id="w-network"
          title="Arkiv network status"
          category="NETWORK"
          size={windows.find(w => w.id === 'w-network')?.size || 'full'}
          isMinimized={windows.find(w => w.id === 'w-network')?.isMinimized || false}
          onSizeChange={handleWindowSizeChange}
          onToggleMinimize={handleToggleMinimize}
          onClose={handleCloseWindow}
          isMaximized={maximizedWindow === 'w-network'}
          onToggleMaximize={handleToggleMaximize}
          isClosed={closedWindows.includes('w-network')}
          view={activeSection}
          role={session.role}
          onMove={handleMoveWindow}
          order={windows.find(w => w.id === 'w-network')?.order}
          widthSpan={windows.find(w => w.id === 'w-network')?.widthSpan}
          heightPx={windows.find(w => w.id === 'w-network')?.heightPx}
          columnStart={windows.find(w => w.id === 'w-network')?.columnStart}
          offsetY={windows.find(w => w.id === 'w-network')?.offsetY}
          onResize={handlePanelResize}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <Activity size={14} style={{ color: 'var(--accent-emerald)' }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase' }}>
                  ARKIV TIRAMISU L3 DB-CHAIN TELEMETRY
                </span>
              </div>

              <div style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-light)',
                padding: '12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.72rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>NETWORK:</span>
                  <strong>Arkiv Tiramisu Testnet (ID: {TIRAMISU_CHAIN_ID})</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>CURRENT BLOCK HEIGHT:</span>
                  <strong style={{ color: 'var(--accent-primary)' }}>{networkStatus === 'connected' ? `#${networkBlock.toString()}` : networkStatus === 'checking' ? 'Checking' : 'Unavailable'}</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>DIRECT JSON-RPC LATENCY:</span>
                  <strong style={{ color: 'var(--accent-emerald)' }}>{networkStatus === 'connected' ? `${networkLatency} ms` : networkStatus === 'checking' ? 'Checking' : 'Unavailable'}</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>DATA STORAGE ENGINE:</span>
                  <strong>Keccak Merkle-Patricia Trie on DB-Chain</strong>
                </div>
              </div>
            </div>
          </div>
        </WindowFrame>
      </div>
      {selectedReport && <div className="report-detail-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedReport(null); }}>
        <section className="report-detail-panel" role="dialog" aria-modal="true" aria-labelledby="report-detail-title">
          <header className="report-detail-header"><div><span className="landing-section-kicker">Public issue report</span><h2 id="report-detail-title">{selectedReport.roadName || 'Location pending'}</h2><p>{selectedReport.ward} · {selectedReport.severity} severity · {selectedReport.status.replaceAll('_', ' ')}</p></div><button className="window-btn" onClick={() => setSelectedReport(null)} aria-label="Close report details"><X size={16}/></button></header>
          <div className="report-detail-content">
            <div className="report-detail-description"><span>REPORT DETAILS</span><p>{selectedReport.description || 'No description was supplied.'}</p></div>
            <div className="report-detail-facts"><div><CalendarDays size={15}/><span>Reported<strong>{selectedReport.timestamp ? new Date(selectedReport.timestamp * 1000).toLocaleString() : 'Date unavailable'}</strong></span></div><div><MapPin size={15}/><span>Coordinates<strong>{selectedReport.latitude != null && selectedReport.longitude != null ? `${selectedReport.latitude.toFixed(5)}, ${selectedReport.longitude.toFixed(5)}` : 'Not provided'}</strong></span></div><div><Activity size={15}/><span>Linked work<strong>{selectedReport.tenderId && selectedReport.tenderId !== 'UNLINKED' ? selectedReport.tenderId : 'No linked tender'}</strong></span></div><div><CalendarDays size={15}/><span>Rectification deadline<strong>{selectedReport.rectificationDeadline ? new Date(selectedReport.rectificationDeadline * 1000).toLocaleDateString() : 'Not recorded'}</strong></span></div></div>
            {(selectedReport.evidencePhotoCid || selectedReport.repairEvidenceCid) && <div className="report-detail-evidence"><span>EVIDENCE</span><div>{selectedReport.evidencePhotoCid && <a href={`https://ipfs.io/ipfs/${encodeURIComponent(selectedReport.evidencePhotoCid)}`} target="_blank" rel="noreferrer noopener">Open original report photo <ExternalLink size={13}/></a>}{selectedReport.repairEvidenceCid && <a href={`https://ipfs.io/ipfs/${encodeURIComponent(selectedReport.repairEvidenceCid)}`} target="_blank" rel="noreferrer noopener">Open repair evidence <ExternalLink size={13}/></a>}</div></div>}
            <div className="report-detail-timeline"><span>WORKFLOW HISTORY</span>{(selectedReport.events || []).length ? selectedReport.events!.map((event, index) => <article key={`${event.timestamp}-${index}`}><i/><div><strong>{event.status.replaceAll('_', ' ')}</strong><small>{event.role} · {new Date(event.timestamp * 1000).toLocaleString()}</small>{event.note && <p>{event.note}</p>}{event.txHash && <code title={event.txHash}>{event.txHash}</code>}</div></article>) : <p>No workflow updates have been recorded yet.</p>}</div>
            <div className="report-detail-chain"><span>CHAIN REFERENCES</span><dl><dt>Entity key</dt><dd>{selectedReport.key || 'Unavailable'}</dd><dt>Latest transaction</dt><dd>{selectedReport.txHash || 'Unavailable'}</dd><dt>Reporter</dt><dd>{selectedReport.anonymousDisplay ? 'Hidden in public report' : selectedReport.reportedBy || 'Not supplied'}</dd></dl><small>Public chain metadata may identify the signing wallet even when the report display is anonymous.</small></div>
          </div>
          <footer className="report-detail-footer"><button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText([`CivicArk report · ${selectedReport.ward} · ${selectedReport.roadName}`, selectedReport.description, `Status: ${selectedReport.status}`, `Entity: ${selectedReport.key || 'unavailable'}`, `Transaction: ${selectedReport.txHash || 'unavailable'}`].join('\n')); }}>Copy report summary</button><button className="btn btn-primary btn-sm" onClick={() => setSelectedReport(null)}>Done</button></footer>
        </section>
      </div>}
        </main>
    </div>
  );
};
