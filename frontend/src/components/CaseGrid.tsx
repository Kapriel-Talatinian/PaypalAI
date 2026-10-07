import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { themeQuartz } from 'ag-grid-community';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { ArrowUpRight, Check, ChevronRight, Clock3 } from 'lucide-react';
import type { WorkspaceCase } from '../types';
import { ACTION_LABELS, STATUS_LABELS, caseCode, date, decision, money } from '../lib/format';

const gridTheme = themeQuartz.withParams({
  accentColor: '#0066f5',
  backgroundColor: '#ffffff',
  foregroundColor: '#000000',
  borderColor: '#ebeff5',
  browserColorScheme: 'light',
  fontFamily: 'PayPal Open, Arial, sans-serif',
  fontSize: 14,
  headerBackgroundColor: '#f5f7fa',
  headerTextColor: '#696969',
  headerFontSize: 12,
  headerFontWeight: 500,
  rowBorder: { color: '#ebeff5', width: 1 },
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  spacing: 6,
  selectedRowBackgroundColor: '#f0f2f9',
  rowHoverColor: '#f5f7fa',
  cellHorizontalPadding: 20,
});

export function StatusBadge({ status, executionMode }: { status: string; executionMode?: string }) {
  const tone = ['review_required', 'execution_uncertain'].includes(status)
    ? 'amber'
    : ['reviewed', 'executed', 'resolved', 'ready'].includes(status)
      ? 'green'
      : ['analyzing', 'executing'].includes(status)
        ? 'blue'
        : 'neutral';
  return (
    <span className={`status-badge status-${tone}`}>
      <i />
      {status === 'executed' && executionMode === 'dry_run'
        ? 'Simulated'
        : (STATUS_LABELS[status] ?? status.replaceAll('_', ' '))}
    </span>
  );
}

export default function CaseGrid({
  rows,
  onOpen,
  selectedId,
  dense = false,
}: {
  rows: WorkspaceCase[];
  onOpen: (item: WorkspaceCase) => void;
  selectedId?: string;
  dense?: boolean;
}) {
  const columns = useMemo<ColDef<WorkspaceCase>[]>(
    () => [
      {
        headerName: 'Customer',
        colId: 'customer',
        minWidth: 235,
        flex: 1.3,
        valueGetter: (p) =>
          p.data ? `${caseCode(p.data)} ${p.data.display.customer} ${p.data.display.email}` : '',
        cellRenderer: ({ data }: ICellRendererParams<WorkspaceCase>) =>
          data && (
            <div className="customer-cell">
              <span className={`avatar avatar-${data.display.initials.charCodeAt(0) % 5}`}>
                {data.display.initials}
              </span>
              <div>
                <strong>{data.display.customer}</strong>
                <span className="mono">{caseCode(data)}</span>
              </div>
            </div>
          ),
      },
      {
        headerName: 'Reason',
        minWidth: 158,
        flex: 1,
        valueGetter: (p) => p.data?.display.category,
        cellRenderer: ({ data }: ICellRendererParams<WorkspaceCase>) =>
          data && (
            <div className="two-line-cell">
              <span>{data.display.category}</span>
              <small>{data.display.product}</small>
            </div>
          ),
      },
      {
        headerName: 'Amount',
        minWidth: 102,
        maxWidth: 124,
        valueGetter: (p) => Number(p.data?.data.amount ?? 0),
        cellRenderer: ({ data }: ICellRendererParams<WorkspaceCase>) =>
          data && (
            <span className="amount-cell">{money(data.data.amount, data.data.currency)}</span>
          ),
      },
      {
        headerName: 'Status',
        minWidth: 132,
        maxWidth: 158,
        valueGetter: (p) => p.data?.status,
        cellRenderer: ({ data }: ICellRendererParams<WorkspaceCase>) =>
          data && <StatusBadge status={data.status} executionMode={data.execution?.mode} />,
      },
      ...(!dense
        ? [
            {
              headerName: 'Recommendation',
              minWidth: 155,
              flex: 1,
              valueGetter: (p: { data?: WorkspaceCase }) =>
                p.data && decision(p.data) ? ACTION_LABELS[decision(p.data)!] : 'Awaiting analysis',
              cellRenderer: ({ data }: ICellRendererParams<WorkspaceCase>) =>
                data && (
                  <span className="recommendation-cell">
                    {data.review || data.execution ? (
                      <Check size={13} />
                    ) : decision(data) ? (
                      <ArrowUpRight size={13} />
                    ) : (
                      <span className="cell-dash">—</span>
                    )}
                    {decision(data)
                      ? ACTION_LABELS[decision(data)!]
                      : data.latest_run?.result?.solver?.status === 'multiple'
                        ? 'Human review'
                        : 'Awaiting analysis'}
                  </span>
                ),
            },
          ]
        : []),
      {
        headerName: 'Response due',
        minWidth: 115,
        maxWidth: 137,
        valueGetter: (p) => p.data?.display.dueAt ?? '',
        cellRenderer: ({ data }: ICellRendererParams<WorkspaceCase>) =>
          data && (
            <span className={`due-cell ${data.status === 'review_required' ? 'due-soon' : ''}`}>
              <Clock3 size={12} />
              {data.display.dueAt ? date(data.display.dueAt) : 'Not provided'}
            </span>
          ),
      },
      {
        headerName: '',
        colId: 'open',
        sortable: false,
        resizable: false,
        width: 44,
        minWidth: 44,
        maxWidth: 44,
        cellRenderer: ({ data }: ICellRendererParams<WorkspaceCase>) =>
          data && (
            <button
              className="row-open"
              aria-label={`Open ${data.display.customer}'s case`}
              onClick={(event) => {
                event.stopPropagation();
                onOpen(data);
              }}
            >
              <ChevronRight size={15} />
            </button>
          ),
      },
    ],
    [dense, onOpen],
  );
  return (
    <div className="case-grid" data-testid="case-grid">
      <AgGridReact<WorkspaceCase>
        theme={gridTheme}
        rowData={rows}
        columnDefs={columns}
        defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
        getRowId={(p) => p.data.id}
        headerHeight={39}
        rowHeight={65}
        domLayout="autoHeight"
        onRowClicked={(event) => event.data && onOpen(event.data)}
        rowClassRules={{ 'case-grid-selected': (p) => p.data?.id === selectedId }}
        suppressCellFocus={false}
        animateRows={false}
        overlayNoRowsTemplate='<div class="grid-empty">No cases match this view.</div>'
      />
    </div>
  );
}
