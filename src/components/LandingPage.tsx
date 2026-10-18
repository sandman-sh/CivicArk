import { useState } from 'react';
import { Activity, ArrowRight, BadgeCheck, Blocks, FileSearch, MapPinned, ShieldCheck, Wallet, Layers3, Camera, ClipboardCheck, Wrench, Check, MoveRight } from 'lucide-react';
import type { UserSession } from '../types/civic';
import { RealWardMap } from './RealWardMap';

interface LandingPageProps {
  session: UserSession | null;
  onOpenAuth: () => void;
  onLaunchApp: () => void;
  networkBlockNumber: bigint;
  networkLatency: number;
  networkStatus: 'checking' | 'connected' | 'offline';
}

export const LandingPage = ({ session, onOpenAuth, onLaunchApp, networkBlockNumber, networkLatency, networkStatus }: LandingPageProps) => {
  const [previewWard, setPreviewWard] = useState('All');
  const enterWorkspace = () => session ? onLaunchApp() : onOpenAuth();
  const networkAvailable = networkStatus === 'connected' && networkBlockNumber > 0n;

  return <div className="landing-page">
    <section className="landing-hero">
      <div className="landing-hero-copy">
        <div className="landing-eyebrow"><span className={networkAvailable ? 'pulse-dot' : 'status-dot-off'} /> Public infrastructure, with a verifiable history</div>
        <h1>Every public work deserves a <em>clear record.</em></h1>
        <p className="landing-lede">CivicArk brings municipal contracts, work milestones, warranties, and citizen reported defects into one transparent workspace. Follow a project from tender to repair, with changes recorded on Arkiv.</p>
        <div className="landing-actions"><button className="landing-primary" onClick={enterWorkspace}>{session ? 'Open your workspace' : 'Explore the workspace'}<ArrowRight size={16} /></button><a href="https://docs.arkiv.network" target="_blank" rel="noreferrer noopener" className="landing-secondary">How the record works</a></div>
        <div className="landing-trust-row"><span><ShieldCheck size={15} /> Wallet signed updates</span><span><Blocks size={15} /> Arkiv DB Chain</span><span><MapPinned size={15} /> OpenStreetMap</span></div>
      </div>
      <div className="landing-preview" aria-label="CivicArk workspace overview">
        <div className="preview-top"><div className="preview-brand"><span className="workspace-mark"><Layers3 size={17} /></span><span><strong>CivicArk</strong><small>Mumbai workspace</small></span></div><span className={`preview-status ${networkAvailable ? '' : 'offline'}`}><span />{networkAvailable ? 'Network connected' : networkStatus === 'checking' ? 'Checking network' : 'Network unavailable'}</span></div>
        <div className="preview-heading"><div><span className="preview-label">PUBLIC WORKS / OVERVIEW</span><h2>Infrastructure ledger</h2></div><Activity size={19} /></div>
        <div className="preview-stats"><div><span>Network block</span><strong>{networkAvailable ? `#${networkBlockNumber.toLocaleString()}` : '—'}</strong></div><div><span>RPC response</span><strong>{networkAvailable ? `${networkLatency} ms` : networkStatus === 'checking' ? 'Checking' : 'Unavailable'}</strong></div></div>
        <div className="preview-record"><div className="record-icon"><FileSearch size={17} /></div><div className="record-content"><strong>Works and warranties</strong><span>Search public contracts and their latest recorded milestones</span></div><ArrowRight size={15} /></div>
        <div className="preview-record"><div className="record-icon record-icon-green"><BadgeCheck size={17} /></div><div className="record-content"><strong>Defect follow up</strong><span>Connect a public report to the work and warranty it concerns</span></div><ArrowRight size={15} /></div>
        <div className="landing-map-preview"><RealWardMap selectedWard={previewWard} onSelect={setPreviewWard} /></div>
        <div className="preview-footer"><span><MapPinned size={13}/> OpenStreetMap geographic context</span><span>Ward markers are approximate</span></div>
      </div>
    </section>

    <section className="landing-journey" aria-labelledby="journey-title">
      <div className="journey-intro"><span className="landing-section-kicker">A clearer path from report to repair</span><h2 id="journey-title">One issue. A visible chain of accountability.</h2><p>See how a location-based report can become reviewed work, a documented repair, and a record residents can follow.</p></div>
      <div className="journey-board">
        <div className="journey-board-top"><span><Activity size={14}/> HOW CIVICARK WORKS</span><span className="journey-demo-label">Illustrative workflow</span></div>
        <div className="journey-track" aria-label="Report, review, repair, and verify">
          <div className="journey-progress"><span /></div>
          <article className="journey-step"><span className="journey-icon journey-citizen"><Camera size={18}/></span><small>01 · RESIDENT</small><strong>Report an issue</strong><span>Add a location, details, and optional photo.</span><i><Check size={12}/> Submitted</i></article>
          <article className="journey-step"><span className="journey-icon journey-review"><ClipboardCheck size={18}/></span><small>02 · REVIEW</small><strong>Review the evidence</strong><span>Inspect the report and link relevant public work.</span><i><Activity size={12}/> Reviewable</i></article>
          <article className="journey-step"><span className="journey-icon journey-repair"><Wrench size={18}/></span><small>03 · DELIVERY</small><strong>Document the repair</strong><span>Authorized participants add progress and evidence.</span><i><MoveRight size={12}/> Track progress</i></article>
          <article className="journey-step"><span className="journey-icon journey-verify"><ShieldCheck size={18}/></span><small>04 · PUBLIC RECORD</small><strong>Verify the history</strong><span>Follow signed updates and available transaction references.</span><i><BadgeCheck size={12}/> Inspect record</i></article>
        </div>
        <div className="journey-footnote"><ShieldCheck size={13}/> On-chain status is shown only when a transaction is returned; this diagram explains the intended workflow.</div>
      </div>
    </section>

    <section className="landing-content">
      <div className="landing-section-heading"><span className="landing-section-kicker">A shared civic record</span><h2>From award to aftercare, keep the details together.</h2><p>Public works involve residents, contractors, engineers, and auditors. CivicArk gives each role a focused view of the same project record.</p></div>
      <div className="landing-feature-grid">
        <article className="landing-feature"><div className="feature-icon feature-purple"><FileSearch size={19}/></div><span className="feature-index">01</span><h3>Find the work</h3><p>Search the tender ledger by work name, road, contractor, ward, or status. Inspect the project details and recorded history.</p><span className="feature-detail">Tender · budget · scope · contractor</span></article>
        <article className="landing-feature"><div className="feature-icon feature-blue"><Activity size={19}/></div><span className="feature-index">02</span><h3>Follow delivery</h3><p>Review milestones as authorized participants update them. Each change carries the signer and transaction reference.</p><span className="feature-detail">Milestones · signers · transaction links</span></article>
        <article className="landing-feature"><div className="feature-icon feature-green"><ShieldCheck size={19}/></div><span className="feature-index">03</span><h3>Track the warranty</h3><p>Keep the defect liability period attached to the project, so residents can see what is covered and when it expires.</p><span className="feature-detail">Warranty status · defects · deadlines</span></article>
        <article className="landing-feature"><div className="feature-icon feature-orange"><MapPinned size={19}/></div><span className="feature-index">04</span><h3>Understand the place</h3><p>Use a real OpenStreetMap base to explore Mumbai and view approximate ward locations alongside ledger information.</p><span className="feature-detail">OpenStreetMap · approximate ward markers</span></article>
      </div>
      <div className="landing-roles"><div><span className="landing-section-kicker">One record, role focused tools</span><h2>Built around how each participant works.</h2><p>Switch the active persona to see the right operations for residents, municipal engineers, contractors, and independent auditors.</p></div><div className="role-list"><div><span className="role-list-icon role-resident"><Wallet size={16}/></span><strong>Residents</strong><span>Inspect records and report a road defect</span></div><div><span className="role-list-icon role-engineer"><BadgeCheck size={16}/></span><strong>Engineers</strong><span>Create tenders and review delivery</span></div><div><span className="role-list-icon role-contractor"><Blocks size={16}/></span><strong>Contractors</strong><span>Record milestones for authorized work</span></div><div><span className="role-list-icon role-auditor"><FileSearch size={16}/></span><strong>Auditors</strong><span>Review the public ledger and evidence</span></div></div></div>
      <div className="landing-final-cta"><div><span className="landing-section-kicker">CivicArk · Mumbai</span><h2>Make the public record easier to follow.</h2><p>Open the live workspace and explore the records currently available on Arkiv.</p></div><button className="landing-primary" onClick={enterWorkspace}>{session ? 'Continue to workspace' : 'Connect or choose a role'}<ArrowRight size={16}/></button></div>
      <footer className="landing-footer"><span>CivicArk · Public infrastructure records</span><div><a href="https://hub.arkiv.network" target="_blank" rel="noreferrer noopener">Arkiv Hub</a><a href="https://docs.arkiv.network" target="_blank" rel="noreferrer noopener">Documentation</a><a href="https://tiramisu.explorer.arkiv.network" target="_blank" rel="noreferrer noopener">Network explorer</a></div></footer>
    </section>
  </div>;
};
