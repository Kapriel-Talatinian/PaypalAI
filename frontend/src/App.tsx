import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useWorkspace } from './lib/store';
import type { WorkspaceCase, WorkspacePolicy } from './types';
import { ACTION_LABELS, caseCode, decision, exportFile } from './lib/format';
import CaseGrid from './components/CaseGrid';
import CaseDetail from './components/CaseDetail';
import AuditTimeline from './components/AuditTimeline';
import { ConnectionDialog, NewCaseDialog } from './components/Dialogs';
import ValueDashboard, { createValueDraft } from './components/ValueDashboard';

const DeadlinePlanner = lazy(() => import('./components/DeadlinePlanner'));
type View = 'overview' | 'cases' | 'reviews' | 'planner' | 'policies' | 'audit';
const titles: Record<View, string> = {
  overview: 'Dispute overview',
  cases: 'All disputes',
  reviews: 'Review queue',
  planner: 'Response planner',
  policies: 'Policy library',
  audit: 'Audit trail',
};
const descriptions: Record<View, string> = {
  overview: 'Challenge unsupported refund claims with verified evidence.',
  cases: 'Track every dispute from the first claim to the final response.',
  reviews: 'The decisions that need your attention, with the evidence to make them.',
  planner: 'Keep upcoming response deadlines in view.',
  policies: 'The exact clauses behind every recommendation.',
  audit: 'A complete, verifiable record of what happened and why.',
};
const safe = (promise: Promise<unknown>) => {
  void promise.catch(() => undefined);
};

function Brand() {
  return (
    <div className="brand">
      <strong>DisputeFlow</strong>
      <span>PayPal disputes</span>
    </div>
  );
}

function PolicyLibrary({
  selected,
  onSelect,
}: {
  selected: WorkspacePolicy | undefined;
  onSelect: (p: WorkspacePolicy) => void;
}) {
  const workspace = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  function sectionView(sections: WorkspacePolicy['sections'], level = 0) {
    return sections.map((section) => (
      <div key={section.id} className={`policy-section policy-depth-${Math.min(level, 2)}`}>
        <h3>{section.title}</h3>
        {section.text && <p>{section.text}</p>}
        {section.children.length > 0 && sectionView(section.children, level + 1)}
      </div>
    ));
  }
  return (
    <div className="policy-layout">
      <aside className="policy-list">
        <div className="section-heading">
          <h2>Documents</h2>
          <span className="section-count">{workspace.policies.length}</span>
        </div>
        {workspace.policies.map((policy) => (
          <button
            className={`policy-document ${selected?.id === policy.id ? 'active' : ''}`}
            key={policy.id}
            onClick={() => onSelect(policy)}
          >
            <FileText size={21} />
            <span>
              <strong>{policy.title}</strong>
              <small>{policy.version}</small>
              <em>{policy.synthetic ? 'Demonstration policy' : 'Imported policy'}</em>
            </span>
            <ChevronRight size={13} />
          </button>
        ))}
        <button
          className="button secondary full"
          onClick={() => input.current?.click()}
          disabled={workspace.busy}
        >
          <Plus size={13} />
          Import policy document
        </button>
        <input
          type="file"
          accept="application/json,.json"
          ref={input}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              setError('');
              safe(
                file
                  .text()
                  .then((text) => workspace.importPolicy(JSON.parse(text)))
                  .catch((err) => {
                    setError(err instanceof Error ? err.message : 'Invalid policy document.');
                  }),
              );
              event.target.value = '';
            }
          }}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="library-note">
          <ShieldCheck size={16} />
          <p>
            Policy versions are immutable. An update gets a new document ID and preserves the
            previous version.
          </p>
        </div>
      </aside>
      <article className="policy-reader">
        {selected ? (
          <>
            <header>
              <span className="eyebrow">POLICY DOCUMENT</span>
              <h2>{selected.title}</h2>
              <div>
                <span className="mono">{selected.version}</span>
                <span className="status-badge status-neutral">
                  {selected.synthetic ? 'Synthetic demo' : 'Policy source'}
                </span>
              </div>
              <p className="policy-source">{selected.source_url}</p>
            </header>
            {selected.synthetic && (
              <div className="policy-notice">
                <FileText size={16} />
                <p>
                  This document demonstrates the reasoning system. It is not a PayPal agreement or
                  an interpretation of PayPal's terms.
                </p>
              </div>
            )}
            {selected.sections.length ? (
              sectionView(selected.sections)
            ) : (
              <p className="muted">Section contents are not available for this document.</p>
            )}
          </>
        ) : (
          <div className="empty-state">
            <FileText size={30} />
            <h3>Select a policy document</h3>
            <p>Inspect the exact clauses used in your case analysis.</p>
          </div>
        )}
      </article>
    </div>
  );
}

export default function App() {
  const workspace = useWorkspace();
  const [view, setView] = useState<View>('overview');
  const [detail, setDetail] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState('all');
  const [dialog, setDialog] = useState<'connect' | 'new' | null>(null);
  const [sidebar, setSidebar] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState<string | null>(null);
  const [valueDraft, setValueDraft] = useState(createValueDraft);
  const search = useRef<HTMLInputElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebarPanel = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width:850px)').matches);
  const reviewCount = workspace.cases.filter((c) => c.status === 'review_required').length;
  const openCase = useCallback(
    (item: WorkspaceCase) => {
      workspace.selectCase(item.id);
      setDetail(true);
      setSidebar(false);
      window.scrollTo({ top: 0, behavior: 'instant' });
    },
    [workspace],
  );
  const closeSidebar = () => {
    setSidebar(false);
    menuButton.current?.focus();
  };
  const navigate = (next: View) => {
    setView(next);
    setDetail(false);
    setFilter('all');
    setQuery('');
    if (sidebar) closeSidebar();
    else setSidebar(false);
  };
  useEffect(() => {
    const media = window.matchMedia('(max-width:850px)');
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (sidebar && compact)
      (
        sidebarPanel.current?.querySelector<HTMLButtonElement>('nav button[aria-current="page"]') ??
        sidebarPanel.current?.querySelector<HTMLButtonElement>('nav button')
      )?.focus();
  }, [sidebar, compact]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const inDialog = Boolean(document.querySelector('[role="dialog"]'));
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!inDialog) {
          setSidebar(false);
          search.current?.focus();
        }
      }
      if (event.key === 'Escape' && sidebar && !inDialog) {
        setSidebar(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [sidebar]);
  useEffect(() => {
    if (workspace.toast) {
      const timeout = setTimeout(workspace.clearToast, 5000);
      return () => clearTimeout(timeout);
    }
  }, [workspace.toast, workspace.clearToast]);
  const baseline =
    workspace.connection.mode === 'demo' ? new Date('2026-10-06T12:00:00+02:00') : new Date();
  const periodCases = workspace.cases.filter(
    (item) =>
      period === 'all' ||
      new Date(item.created_at).getTime() >= baseline.getTime() - Number(period) * 86400000,
  );
  const searched = periodCases.filter((item) =>
    `${item.display.customer} ${item.external_id} ${item.display.email} ${item.display.category} ${item.display.product}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const visible = searched.filter((item) =>
    view === 'reviews'
      ? item.status === 'review_required'
      : filter === 'review'
        ? item.status === 'review_required'
        : filter === 'open'
          ? item.status === 'open'
          : true,
  );
  const rows = view === 'overview' ? visible.slice(0, 6) : visible;
  const policy = workspace.policies.find((p) => p.id === selectedPolicy) ?? workspace.policies[0];
  function exportCases() {
    const data = [
      ['Case ID', 'Customer', 'Reason', 'Amount', 'Currency', 'Status', 'Decision'],
      ...visible.map((c) => [
        caseCode(c),
        c.display.customer,
        c.display.category,
        c.data.amount,
        c.data.currency,
        c.status,
        decision(c) ? ACTION_LABELS[decision(c)!] : 'Pending',
      ]),
    ];
    exportFile(
      'disputeflow-cases.csv',
      data
        .map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','))
        .join('\n'),
      'text/csv',
    );
  }
  const navigation = [
    { id: 'overview' as View, label: 'Overview', icon: LayoutDashboard },
    { id: 'cases' as View, label: 'All disputes', icon: FolderOpen },
    { id: 'reviews' as View, label: 'Review queue', icon: ShieldCheck },
  ];

  return (
    <div className="app-shell">
      {sidebar && <div className="sidebar-scrim" aria-hidden="true" onClick={closeSidebar} />}
      <aside
        id="workspace-sidebar"
        ref={sidebarPanel}
        className={`sidebar ${sidebar ? 'sidebar-open' : ''}`}
        inert={compact && !sidebar}
        aria-hidden={compact && !sidebar ? true : undefined}
        style={{ visibility: compact && !sidebar ? 'hidden' : undefined }}
      >
        <Brand />
        <nav aria-label="Workspace navigation">
          {navigation.map((link) => (
            <button
              className={`nav-link ${view === link.id ? 'active' : ''}`}
              key={link.id}
              aria-current={view === link.id ? 'page' : undefined}
              onClick={() => navigate(link.id)}
            >
              <link.icon size={17} />
              <span>{link.label}</span>
              {link.id === 'reviews' && reviewCount > 0 && (
                <span className="nav-count">{reviewCount}</span>
              )}
              {view === link.id && <span className="nav-active-mark" />}
            </button>
          ))}
        </nav>
        <details className="more-tools">
          <summary>
            More tools <ChevronDown size={13} />
          </summary>
          <nav aria-label="Governance navigation">
            {[
              { id: 'planner' as View, label: 'Response planner', icon: Clock3 },
              { id: 'policies' as View, label: 'Policy library', icon: FileText },
              { id: 'audit' as View, label: 'Audit trail', icon: Activity },
            ].map((link) => (
              <button
                key={link.id}
                className={`nav-link ${view === link.id ? 'active' : ''}`}
                aria-current={view === link.id ? 'page' : undefined}
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  navigate(link.id);
                }}
              >
                <link.icon size={17} />
                <span>{link.label}</span>
              </button>
            ))}
          </nav>
        </details>
        <button className="sidebar-settings" onClick={() => setDialog('connect')}>
          <Settings2 size={16} />
          <span>{workspace.connection.mode === 'demo' ? 'Connect API' : 'API connected'}</span>
        </button>
      </aside>
      <div className="workspace-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              ref={menuButton}
              className="icon-button mobile-menu"
              onClick={() => (sidebar ? closeSidebar() : setSidebar(true))}
              aria-label={sidebar ? 'Close navigation' : 'Open navigation'}
              aria-expanded={sidebar}
              aria-controls="workspace-sidebar"
            >
              <Menu size={19} />
            </button>
            <span className="topbar-workspace">PayPal dispute workspace</span>
          </div>
          <div className="topbar-right">
            <div className="global-search">
              <Search size={15} />
              <input
                ref={search}
                placeholder="Search cases"
                aria-label="Search cases"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setDetail(false);
                  if (!['overview', 'cases', 'reviews'].includes(view)) setView('cases');
                }}
              />
              <kbd>Ctrl K</kbd>
            </div>
            <span
              className={`environment-pill ${workspace.connection.mode === 'api' ? 'api-mode' : ''}`}
            >
              <i />
              {workspace.connection.mode === 'demo'
                ? 'Demo workspace'
                : workspace.connection.executionMode === 'live'
                  ? 'Live workspace'
                  : 'API workspace'}
            </span>
          </div>
        </header>
        <main className="main-content">
          {workspace.error && (
            <div className="error-banner" role="alert">
              <span>{workspace.error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={workspace.clearError}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {detail && workspace.selectedCase ? (
            <CaseDetail
              key={workspace.selectedCase.id}
              item={workspace.selectedCase}
              onBack={() => setDetail(false)}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <h1>{titles[view]}</h1>
                  <p>{descriptions[view]}</p>
                </div>
                <div className="page-actions">
                  {workspace.connection.mode === 'api' ? (
                    <button
                      className="icon-button refresh-button"
                      aria-label="Refresh workspace"
                      disabled={workspace.busy}
                      onClick={() => safe(workspace.refresh())}
                    >
                      <RefreshCw size={16} />
                    </button>
                  ) : null}
                  {['overview', 'cases', 'reviews'].includes(view) && (
                    <button className="button secondary" onClick={() => setDialog('new')}>
                      <Plus size={15} />
                      Add dispute
                    </button>
                  )}
                </div>
              </div>
              {workspace.loading ? (
                <div className="workspace-loading" role="status">
                  <span className="loading-ring" />
                  <h2>Preparing your workspace</h2>
                  <p>Loading cases and their evidence trails.</p>
                </div>
              ) : (
                <>
                  {view === 'overview' && (
                    <ValueDashboard
                      draft={valueDraft}
                      onDraftChange={setValueDraft}
                      cases={periodCases}
                      mode={workspace.connection.mode}
                      onOpen={openCase}
                      onReviewQueue={() => navigate('reviews')}
                    />
                  )}
                  {['overview', 'cases', 'reviews'].includes(view) && (
                    <div className="operations-layout operations-full">
                      <section className="panel cases-panel">
                        <div className="cases-panel-heading">
                          <div>
                            <h2>
                              {view === 'overview'
                                ? 'Your dispute queue'
                                : view === 'reviews'
                                  ? 'Awaiting your review'
                                  : 'Dispute register'}
                            </h2>
                            <span className="section-count">
                              {visible.length} {visible.length === 1 ? 'case' : 'cases'}
                            </span>
                          </div>
                          <div className="table-actions">
                            <label className="period-filter">
                              <Clock3 size={12} />
                              <select
                                aria-label="Case date range"
                                value={period}
                                onChange={(event) => setPeriod(event.target.value)}
                              >
                                <option value="all">All dates</option>
                                <option value="7">Last 7 days</option>
                                <option value="30">Last 30 days</option>
                              </select>
                              <ChevronDown size={11} />
                            </label>
                            <button
                              className="icon-button export-table"
                              aria-label="Export cases as CSV"
                              onClick={exportCases}
                            >
                              <ArrowDownToLine size={15} />
                            </button>
                          </div>
                        </div>
                        <div className="table-toolbar">
                          {view === 'reviews' ? (
                            <div className="queue-note">
                              <ShieldCheck size={13} />
                              Review each recommendation before submitting a response.
                            </div>
                          ) : (
                            <div className="queue-tabs">
                              <button
                                className={filter === 'all' ? 'active' : ''}
                                onClick={() => setFilter('all')}
                              >
                                All cases<span>{searched.length}</span>
                              </button>
                              <button
                                className={filter === 'review' ? 'active' : ''}
                                onClick={() => setFilter('review')}
                              >
                                Needs review
                                <span>
                                  {searched.filter((c) => c.status === 'review_required').length}
                                </span>
                              </button>
                              <button
                                className={filter === 'open' ? 'active' : ''}
                                onClick={() => setFilter('open')}
                              >
                                Unprocessed
                                <span>{searched.filter((c) => c.status === 'open').length}</span>
                              </button>
                            </div>
                          )}
                        </div>
                        <CaseGrid rows={rows} onOpen={openCase} dense={view === 'overview'} />
                        <div className="table-footer">
                          <span>
                            Showing {rows.length} of {visible.length} cases
                          </span>
                          {view === 'overview' ? (
                            <button className="text-button" onClick={() => navigate('cases')}>
                              View all disputes
                              <ArrowRight size={13} />
                            </button>
                          ) : (
                            <span className="table-backed">
                              <ShieldCheck size={12} />
                              {workspace.connection.mode === 'demo'
                                ? 'Synthetic demonstration data'
                                : 'Sourced from your API'}
                            </span>
                          )}
                        </div>
                      </section>
                    </div>
                  )}
                  {view === 'planner' && (
                    <Suspense
                      fallback={
                        <div className="workspace-loading">
                          <span className="loading-ring" />
                          Loading response planner…
                        </div>
                      }
                    >
                      <DeadlinePlanner
                        cases={workspace.cases}
                        onSelect={(id) => {
                          const item = workspace.cases.find((c) => c.id === id);
                          if (item) openCase(item);
                        }}
                      />
                    </Suspense>
                  )}
                  {view === 'policies' && (
                    <PolicyLibrary selected={policy} onSelect={(p) => setSelectedPolicy(p.id)} />
                  )}
                  {view === 'audit' && (
                    <div className="audit-layout">
                      <aside className="audit-cases">
                        <div className="section-heading">
                          <h2>Case records</h2>
                          <span className="section-count">{workspace.cases.length}</span>
                        </div>
                        {workspace.cases.map((item) => (
                          <button
                            className={`audit-case-link ${workspace.selectedId === item.id ? 'active' : ''}`}
                            key={item.id}
                            onClick={() => workspace.selectCase(item.id)}
                          >
                            <span
                              className={`avatar avatar-${item.display.initials.charCodeAt(0) % 5}`}
                            >
                              {item.display.initials}
                            </span>
                            <span>
                              <strong>{item.display.customer}</strong>
                              <small className="mono">{caseCode(item)}</small>
                            </span>
                            {item.audit.verified && <ShieldCheck size={14} />}
                          </button>
                        ))}
                      </aside>
                      <div className="audit-main">
                        {workspace.selectedCase && (
                          <div className="audit-main-heading">
                            <div>
                              <span className="eyebrow">CASE RECORD</span>
                              <h2>{workspace.selectedCase.display.customer}</h2>
                              <span className="mono">{caseCode(workspace.selectedCase)}</span>
                            </div>
                            <button
                              className="button secondary"
                              onClick={() =>
                                exportFile(
                                  `${caseCode(workspace.selectedCase!)}-audit.json`,
                                  JSON.stringify(workspace.selectedCase!.audit, null, 2),
                                )
                              }
                            >
                              <ArrowDownToLine size={14} />
                              Export record
                            </button>
                          </div>
                        )}
                        <AuditTimeline audit={workspace.selectedCase?.audit ?? null} />
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          <footer className="workspace-footer">
            <div>
              <span>DisputeFlow</span>
              <i />
              Hackathon demo
            </div>
            <span>
              {workspace.connection.mode === 'demo'
                ? 'Synthetic cases · No external payments'
                : `${workspace.connection.executionMode === 'dry_run' ? 'Dry-run execution' : workspace.connection.executionMode === 'sandbox' ? 'PayPal sandbox' : 'Live PayPal execution'} · Connected API`}
              <ShieldCheck size={12} />
            </span>
          </footer>
        </main>
      </div>
      {workspace.toast && (
        <div className="toast" role="status">
          <span>
            <Check size={14} />
          </span>
          {workspace.toast}
          <button aria-label="Dismiss notification" onClick={workspace.clearToast}>
            <X size={14} />
          </button>
        </div>
      )}
      {dialog === 'connect' && <ConnectionDialog onClose={() => setDialog(null)} />}
      {dialog === 'new' && (
        <NewCaseDialog
          onClose={() => setDialog(null)}
          onCreated={(id) => {
            workspace.selectCase(id);
            setDetail(true);
          }}
        />
      )}
    </div>
  );
}
