import { useEffect, useMemo, useRef, useState } from 'react';
import { Scheduler, StringHelper } from '@bryntum/scheduler';
import type { ColumnConfig } from '@bryntum/scheduler';
import { CalendarDays } from 'lucide-react';
import type { WorkspaceCase } from '../types';
import { caseCode } from '../lib/format';
import { caseOpenedAt } from '../lib/cases';
import '@bryntum/scheduler/fontawesome/css/fontawesome.css';
import '@bryntum/scheduler/fontawesome/css/solid.css';
import '@bryntum/scheduler/scheduler.css';
import '@bryntum/scheduler/stockholm-light.css';
import './deadline-planner.css';

const dateLabel = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  timeZone: 'Europe/Paris',
});
const completedStatuses = new Set(['executed', 'resolved', 'held']);

export default function DeadlinePlanner({
  cases,
  onSelect,
}: {
  cases: WorkspaceCase[];
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const [failed, setFailed] = useState(false);
  const scheduled = useMemo(
    () =>
      cases
        .filter((item) => {
          if (completedStatuses.has(item.status) || !item.display.dueAt) return false;
          const start = Date.parse(caseOpenedAt(item));
          const end = Date.parse(item.display.dueAt);
          return Number.isFinite(start) && Number.isFinite(end) && end > start;
        })
        .sort((a, b) => Date.parse(a.display.dueAt!) - Date.parse(b.display.dueAt!)),
    [cases],
  );
  const pendingWithoutDates = cases.filter(
    (item) => !completedStatuses.has(item.status) && !item.display.dueAt,
  ).length;

  useEffect(() => {
    if (!host.current || !scheduled.length) return;
    let scheduler: Scheduler | undefined;
    setFailed(false);
    const firstDate = new Date(
      Math.min(...scheduled.map((item) => Date.parse(caseOpenedAt(item)))),
    );
    const lastDate = new Date(
      Math.max(...scheduled.map((item) => Date.parse(item.display.dueAt!))),
    );
    firstDate.setUTCHours(0, 0, 0, 0);
    lastDate.setUTCHours(0, 0, 0, 0);
    lastDate.setUTCDate(lastDate.getUTCDate() + 2);
    try {
      scheduler = new Scheduler({
        appendTo: host.current,
        cls: 'df-deadline-scheduler',
        height: '100%',
        readOnly: true,
        startDate: firstDate,
        endDate: lastDate,
        timeZone: 'Europe/Paris',
        viewPreset: {
          base: 'weekAndDayLetter',
          tickWidth: 85,
          headers: [
            { unit: 'week', dateFormat: 'ddd, DD MMM YYYY' },
            { unit: 'day', dateFormat: 'ddd D' },
          ],
        },
        rowHeight: 68,
        barMargin: 17,
        eventStyle: 'rounded',
        eventColor: '#0066f5',
        useInitialAnimation: false,
        features: {
          eventDrag: false,
          eventDragCreate: false,
          eventResize: false,
          eventEdit: false,
          eventMenu: false,
          eventTooltip: false,
          scheduleMenu: false,
          scheduleTooltip: false,
          cellEdit: false,
          cellMenu: false,
          headerMenu: false,
          columnReorder: false,
          regionResize: false,
          timeAxisHeaderMenu: false,
          timeRanges: { showCurrentTimeLine: true },
        },
        columns: [
          {
            text: 'CASE / CUSTOMER',
            field: 'name',
            width: 244,
            renderer: ({ record }) =>
              `<div class="planner-resource"><strong>${StringHelper.encodeHtml(String(record.get('name')))}</strong><span>${StringHelper.encodeHtml(String(record.get('caseCode')))}</span></div>`,
          },
        ] satisfies ColumnConfig[],
        resources: scheduled.map((item) => ({
          id: item.id,
          name: item.display.customer,
          caseCode: caseCode(item),
        })),
        events: scheduled.map((item) => ({
          id: `deadline-${item.id}`,
          resourceId: item.id,
          startDate: new Date(caseOpenedAt(item)),
          endDate: new Date(item.display.dueAt!),
          name: `Due ${dateLabel.format(new Date(item.display.dueAt!))}`,
          cls:
            item.status === 'review_required' || item.status === 'execution_uncertain'
              ? 'df-window-review'
              : 'df-window-ready',
          eventColor:
            item.status === 'review_required' || item.status === 'execution_uncertain'
              ? '#785000'
              : '#0066f5',
        })),
        eventRenderer: ({ eventRecord, renderData }) => {
          renderData.ariaLabel = `${eventRecord.name}. Open case review.`;
          return StringHelper.encodeHtml(eventRecord.name);
        },
        listeners: {
          eventClick: ({ resourceRecord }) => select.current(String(resourceRecord.id)),
          cellClick: ({ record }) => select.current(String(record.id)),
          eventKeyDown: ({ eventRecords, event }) => {
            if (event.key === 'Enter' && eventRecords[0]) {
              event.preventDefault();
              select.current(String(eventRecords[0].resourceId));
            }
          },
        },
      });
    } catch {
      setFailed(true);
    }
    return () => scheduler?.destroy();
  }, [scheduled]);

  const firstDue = scheduled[0]?.display.dueAt;
  const lastDue = scheduled.at(-1)?.display.dueAt;
  return (
    <section className="deadline-planner" aria-label="Response deadline planner">
      <div className="planner-heading">
        <div>
          <span className="planner-eyebrow">RESPONSE WINDOWS</span>
          <h2>Keep every deadline in view.</h2>
          <p>Plan the next response and open any case to inspect its evidence.</p>
        </div>
        <div className="planner-range">
          <CalendarDays size={15} />
          {firstDue && lastDue
            ? `${dateLabel.format(new Date(firstDue))} – ${dateLabel.format(new Date(lastDue))}`
            : 'No dates provided'}
        </div>
      </div>
      {scheduled.length > 0 ? (
        <>
          <div
            className="planner-timeline"
            ref={host}
            hidden={failed}
            data-testid="deadline-scheduler"
            style={{ height: Math.min(600, Math.max(320, scheduled.length * 68 + 108)) }}
          />
          {failed && (
            <div className="planner-empty" role="status">
              <CalendarDays size={26} />
              <h3>Timeline unavailable</h3>
              <p>The response calendar could not be loaded.</p>
            </div>
          )}
        </>
      ) : (
        <div className="planner-empty">
          <CalendarDays size={26} />
          <h3>No response windows to display</h3>
          <p>Pending cases will appear here when a response deadline is provided.</p>
        </div>
      )}
      <div className="planner-footer">
        <div className="planner-legend">
          <span>
            <i className="planner-dot-ready" />
            Ready for response
          </span>
          <span>
            <i className="planner-dot-review" />
            Human review
          </span>
        </div>
        <span>
          {pendingWithoutDates > 0
            ? `${pendingWithoutDates} pending ${pendingWithoutDates === 1 ? 'case has' : 'cases have'} no response date`
            : 'Select a window to review its case'}
        </span>
      </div>
      <p className="planner-license">Bryntum Scheduler · Evaluation license</p>
    </section>
  );
}
