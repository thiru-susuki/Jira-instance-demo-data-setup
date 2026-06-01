import React, { useEffect, useState } from 'react';
import { invoke, router, view } from '@forge/bridge';

const industries = ['Banking', 'Healthcare', 'Retail', 'Insurance', 'Telecom', 'E-commerce', 'SaaS', 'Manufacturing'];

const opsDashboardOptions = [
  {
    value: '',
    label: 'Default ITSM Dashboard',
    prompt: '',
  },
  { value: 'enterprise-service-health', label: 'Executive Dashboard (Cross-project)', prompt: 'Executive Dashboard for service management leadership. Show service health, total requests raised, open vs resolved requests, ticket trend over time, SLA compliance, tickets nearing SLA breach, breached ticket count, CSAT, escalation trend, major incidents, high-priority open issues, tickets by team/project, and workload distribution. Answer: How healthy are our services? Are commitments being met? Are customers satisfied? Which teams require attention? KPIs: SLA compliance %, MTTR, CSAT, resolution rate %.' },
  { value: 'service-desk-operations', label: 'Project-Level Dashboard (Single Service Project)', prompt: 'Project-Level Dashboard for a single service project. Show queue health, open tickets, aging tickets, tickets by priority, active incidents, escalated incidents, incident trend, tickets approaching SLA breach, breached tickets, tickets by assignee, agent workload, and knowledge/customer signals where available. Answer: What needs immediate action? Which tickets are at risk? Is work balanced? KPIs: first response time, resolution rate %, MTTR, SLA achievement %.' },
];

const baseSoftwareDashboardOptions = [
  {
    value: '',
    label: 'Default Software Dashboard',
    prompt: '',
  },
  { value: 'engineering-portfolio-health', label: 'Executive Dashboard (Cross-project)', prompt: 'Executive Dashboard for software development leadership. Show delivery health, projects on track vs at risk, delivery trend, upcoming releases, release readiness, critical defects, defect trend, work completed by team, team workload, blocked items, and high-priority risks. Answer: Which projects need intervention? Are releases on schedule? Are quality issues increasing? KPIs: on-time delivery %, defect leakage %, release success %, project health score.' },
];

const scrumSoftwareDashboardOption = {
  value: 'scrum-sprint-health',
  label: 'Project-Level Dashboard - Scrum Project',
  prompt: 'Project-Level Dashboard for a Scrum project. Show sprint progress %, story points committed, story points completed, sprint burndown, scope changes, velocity trend, open defects, critical defects, blocked stories, and work by status. Answer: Is the sprint on track? What work is blocked? Can the team meet commitments? KPIs: sprint completion %, velocity, burndown adherence %, defect leakage %.',
};

const kanbanSoftwareDashboardOption = {
  value: 'kanban-flow-health',
  label: 'Project-Level Dashboard - Kanban Project',
  prompt: 'Project-Level Dashboard for a Kanban project. Show work by status, active work items, throughput, cycle time, lead time, blocked items, aging work items, open defects, critical defects, and WIP status. Answer: Is work flowing smoothly? Where are bottlenecks? Is delivery stable? KPIs: throughput, flow efficiency %, average cycle time, WIP compliance %.',
};

function buildDashboardPromptFromValues(options, values) {
  return values
    .map(value => options.find(option => option.value === value)?.prompt)
    .filter(Boolean)
    .join('\n\n');
}

function getSoftwareDashboardOptions(softwareProjects = []) {
  const hasScrumProject = softwareProjects.some(project => project.softwareTemplate === 'scrum');
  const hasKanbanProject = softwareProjects.some(project => project.softwareTemplate === 'kanban');

  return [
    ...baseSoftwareDashboardOptions,
    ...(hasScrumProject ? [scrumSoftwareDashboardOption] : []),
    ...(hasKanbanProject ? [kanbanSoftwareDashboardOption] : []),
  ];
}

function filterDashboardValues(options, values) {
  const allowedValues = new Set(options.map(option => option.value).filter(Boolean));
  return (values || []).filter(value => allowedValues.has(value));
}

const chartColors = ['#6b9fe8', '#ef5b52', '#c29500', '#2ca46f', '#2f9db7', '#a957dc', '#f5c04d', '#43328a'];

function formatDisplayDate(dateValue) {
  if (!dateValue) {
    return 'today';
  }

  const date = new Date(`${dateValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getRetainUntilDate(generatedAt, retentionPeriodDays) {
  const startDate = generatedAt ? new Date(`${generatedAt}T00:00:00`) : new Date();

  if (Number.isNaN(startDate.getTime())) {
    return null;
  }

  startDate.setDate(startDate.getDate() + retentionPeriodDays);
  return startDate.toISOString().split('T')[0];
}

function DashboardGadget({ context }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [hoveredChartItem, setHoveredChartItem] = useState(null);

  useEffect(() => {
    const dashboardId = context?.extension?.dashboard?.id;
    const gadgetId = context?.extension?.gadget?.id;

    invoke('getDemoDashboardGadgetData', { dashboardId, gadgetId })
      .then((response) => {
        if (!response.success) {
          setError(response.message || 'Unable to load dashboard gadget data.');
          return;
        }
        setData(response);
      })
      .catch((err) => setError(err.message));
  }, [context]);

  if (error) {
    return <div style={{ padding: '16px', color: '#bf2600', fontSize: '13px' }}>{error}</div>;
  }

  if (!data) {
    return <div style={{ padding: '16px', color: '#5e6c84', fontSize: '13px' }}>Loading...</div>;
  }

  const config = data.config || {};
  const viewType = config.viewType || 'open-work';
  const visualType = config.visualType || 'standard';
  const issues = data.issues || [];
  const retentionPeriodDays = config.retentionPeriodDays || 180;
  const generatedAt = config.generatedAt || new Date().toISOString().split('T')[0];
  const retainUntil = getRetainUntilDate(generatedAt, retentionPeriodDays);

  const shellStyle = {
    border: '1px solid #dfe1e6',
    borderRadius: '3px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#172b4d',
    fontSize: '13px',
    background: '#ffffff',
    overflow: 'hidden',
  };

  const titleStyle = {
    margin: '0',
    fontSize: '14px',
    fontWeight: 800,
    lineHeight: '20px',
    color: '#172b4d',
  };

  const sectionLabelStyle = {
    color: '#0052cc',
    fontSize: '10px',
    fontWeight: 800,
    letterSpacing: '0.4px',
    textTransform: 'uppercase',
  };

  const mutedStyle = {
    color: '#5e6c84',
    fontSize: '12px',
    lineHeight: '16px',
  };

  const bodyStyle = {
    padding: '14px 16px 16px',
  };

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '12px 14px 8px',
    background: '#ffffff',
    borderTop: '3px solid #36b37e',
    borderBottom: '1px solid #ebecf0',
  };

  const headerSubtitleStyle = {
    padding: '8px 14px',
    borderBottom: '1px solid #dfe1e6',
    background: '#fafbfc',
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'center',
  };

  const headerActionStyle = {
    border: '1px solid #b3d4ff',
    borderRadius: '3px',
    color: '#0052cc',
    fontSize: '11px',
    fontWeight: 700,
    padding: '2px 6px',
    textDecoration: 'none',
    cursor: 'pointer',
    background: '#deebff',
  };

  const badgeStyle = {
    borderRadius: '3px',
    background: '#e3fcef',
    color: '#006644',
    fontSize: '11px',
    fontWeight: 700,
    padding: '3px 8px',
    whiteSpace: 'nowrap',
  };

  const profilePanelStyle = {
    border: '1px solid #dfe1e6',
    borderTop: '3px solid #0052cc',
    background: '#f4f8ff',
    borderRadius: '3px',
    padding: '10px 12px',
    marginBottom: '14px',
  };

  const chipRowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginTop: '8px',
  };

  const chipStyle = {
    borderRadius: '3px',
    background: '#deebff',
    color: '#0747a6',
    fontSize: '11px',
    fontWeight: 700,
    padding: '3px 8px',
  };

  const retentionPanelStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    alignItems: 'center',
    gap: '12px',
    border: '1px solid #c1f0d4',
    borderRadius: '6px',
    background: '#f3fff7',
    padding: '10px 12px',
    marginBottom: '14px',
  };

  const retentionValueStyle = {
    color: '#006644',
    fontSize: '18px',
    fontWeight: 700,
    lineHeight: '22px',
    whiteSpace: 'nowrap',
  };

  const cardGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px',
    margin: '0 16px 14px',
  };

  const metricCardStyle = {
    border: '1px solid #dfe1e6',
    borderTop: '3px solid #0052cc',
    borderRadius: '3px',
    padding: '11px',
    background: '#ffffff',
    boxShadow: '0 1px 2px rgba(9, 30, 66, 0.08)',
  };

  const compactRowStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '9px 12px',
    borderTop: '1px solid #ebecf0',
  };

  const timelineRowStyle = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    columnGap: '14px',
    minHeight: '38px',
    padding: '9px 12px',
    borderTop: '1px solid #ebecf0',
  };

  const timelineTitleStyle = {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: '18px',
  };

  const tableHeaderStyle = {
    display: 'grid',
    gridTemplateColumns: '48px 78px minmax(260px, 1fr) 48px',
    gap: '10px',
    padding: '7px 10px',
    background: '#f4f5f7',
    borderBottom: '1px solid #dfe1e6',
    color: '#42526e',
    fontSize: '10px',
    fontWeight: 800,
    textTransform: 'uppercase',
  };

  const tableRowStyle = {
    display: 'grid',
    gridTemplateColumns: '48px 78px minmax(260px, 1fr) 48px',
    gap: '10px',
    alignItems: 'center',
    padding: '8px 10px',
    borderBottom: '1px solid #ebecf0',
    color: '#172b4d',
    textDecoration: 'none',
    cursor: 'pointer',
    minHeight: '36px',
  };

  const visualPanelStyle = {
    border: '1px solid #dfe1e6',
    borderRadius: '3px',
    background: '#ffffff',
    padding: '12px',
    boxShadow: '0 1px 2px rgba(9, 30, 66, 0.08)',
  };

  const signalPanelStyle = {
    border: '1px solid #dfe1e6',
    borderRadius: '6px',
    background: '#ffffff',
    padding: '10px',
    marginTop: '12px',
  };

  const chartTooltipStyle = {
    position: 'absolute',
    left: '50%',
    top: '-2px',
    transform: 'translate(-50%, -100%)',
    zIndex: 2,
    background: '#172b4d',
    color: '#ffffff',
    borderRadius: '4px',
    padding: '6px 8px',
    fontSize: '12px',
    lineHeight: '16px',
    fontWeight: 600,
    boxShadow: '0 4px 10px rgba(9, 30, 66, 0.24)',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  };

  const formatPercent = (count, total) => {
    if (!total) {
      return '0%';
    }

    const percent = (count / total) * 100;
    return `${percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10}%`;
  };

  const getChartTooltipText = (item, total) => (
    `${item.name}: ${item.count} (${formatPercent(item.count, total)})`
  );

  const clearChartTooltip = () => {
    setHoveredChartItem(null);
  };

  const showChartTooltip = (item, total) => {
    setHoveredChartItem({
      name: item.name,
      count: item.count,
      percent: formatPercent(item.count, total),
      label: getChartTooltipText(item, total),
    });
  };

  const getStatusColor = (statusName) => {
    const normalized = (statusName || '').toLowerCase();
    if (normalized.includes('done') || normalized.includes('closed') || normalized.includes('resolved')) return '#00875a';
    if (normalized.includes('progress') || normalized.includes('review') || normalized.includes('waiting')) return '#ff991f';
    if (normalized.includes('reopen') || normalized.includes('blocked')) return '#de350b';
    return '#0052cc';
  };

  const renderStatusMatrix = () => {
    const statuses = (data.statusCounts || [])
      .filter(status => status.count > 0)
      .map(status => status.name)
      .slice(0, 4);
    const visibleStatuses = statuses.length > 0 ? statuses : ['To Do', 'In Progress', 'Done'];
    const assignees = Array.from(new Set(issues.map(issue => issue.assignee || 'Unassigned'))).slice(0, 5);
    const rowNames = assignees.length > 0 ? assignees : ['Unassigned'];
    const gridTemplateColumns = `minmax(150px, 1.4fr) repeat(${visibleStatuses.length}, minmax(86px, 1fr)) 76px`;
    const matrixCellStyle = {
      minHeight: '20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    };
    const statusTotals = visibleStatuses.map(status => issues.filter(issue => issue.status === status).length);
    const grandTotal = statusTotals.reduce((sum, value) => sum + value, 0);

    return (
      <div style={{ margin: '0 16px 14px', border: '1px solid #dfe1e6', borderRadius: '3px', overflowX: 'auto', overflowY: 'hidden', background: '#ffffff' }}>
        <div style={{ minWidth: '720px' }}>
          <div style={{ display: 'grid', gridTemplateColumns, gap: '8px', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #dfe1e6', background: '#ffffff' }}>
            <strong>Assignee</strong>
            {visibleStatuses.map(status => (
              <span key={status} style={{ ...badgeStyle, ...matrixCellStyle, justifySelf: 'center', background: '#f4f5f7', color: getStatusColor(status), border: `1px solid ${getStatusColor(status)}33` }}>
                {status}
              </span>
            ))}
            <strong style={{ ...matrixCellStyle, justifyContent: 'center' }}>Total</strong>
          </div>
          {rowNames.map(assignee => {
            const cells = visibleStatuses.map(status => issues.filter(issue => (issue.assignee || 'Unassigned') === assignee && issue.status === status).length);
            const rowTotal = cells.reduce((sum, value) => sum + value, 0);

            return (
              <div key={assignee} style={{ display: 'grid', gridTemplateColumns, gap: '8px', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #ebecf0' }}>
                <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{assignee}</span>
                {cells.map((count, index) => renderDrilldownLink(getItemDrilldownUrl('status', { name: visibleStatuses[index] }), (
                  <span key={visibleStatuses[index]} style={{ ...matrixCellStyle, color: '#0052cc', fontWeight: 700, cursor: 'pointer' }}>{count}</span>
                ), { display: 'block' }))}
                <strong style={{ ...matrixCellStyle, justifyContent: 'center', color: '#0747a6' }}>{rowTotal}</strong>
              </div>
            );
          })}
          <div style={{ display: 'grid', gridTemplateColumns, gap: '8px', alignItems: 'center', padding: '10px 12px', background: '#f4f5f7' }}>
            <strong>Total Unique Issues:</strong>
            {statusTotals.map((count, index) => <strong key={visibleStatuses[index]} style={{ ...matrixCellStyle, color: '#0052cc' }}>{count}</strong>)}
            <strong style={{ ...matrixCellStyle, justifyContent: 'center', color: '#0747a6' }}>{grandTotal}</strong>
          </div>
        </div>
      </div>
    );
  };

  const renderProfileContext = () => {
    return null;
  };

  const renderHeader = (title, subtitle) => (
    <>
      <div style={headerStyle}>
        <div style={{ minWidth: 0 }}>
          {config.sectionLabel && <div style={sectionLabelStyle}>{config.sectionLabel}</div>}
          <h3 style={titleStyle}>{title}</h3>
          <div style={{ ...mutedStyle, marginTop: '3px' }}>{config.subtitle || subtitle || 'Interactive dashboard gadget'}</div>
        </div>
      </div>
    </>
  );

  const renderRetentionPanel = () => null;

  const renderMetricCard = (label, value, detail, color = '#0052cc') => renderDrilldownLink(data.drilldowns?.allWork?.url, (
    <div style={{ ...metricCardStyle, borderTopColor: color, cursor: 'pointer' }}>
      <div style={{ ...mutedStyle, marginBottom: '5px' }}>{label}</div>
      <div style={{ color, fontSize: '24px', lineHeight: '28px', fontWeight: 700 }}>{value}</div>
      {detail && <div style={{ ...mutedStyle, marginTop: '4px' }}>{detail}</div>}
    </div>
  ), { display: 'block' });

  const renderKpiBarChart = (cards) => {
    const chartItems = cards.map((card, index) => {
      const rawValue = String(card.value ?? '');
      const numericValue = Number.parseFloat(rawValue.replace(/[^0-9.]/g, '')) || 0;
      const isPercent = rawValue.includes('%') || String(card.label || '').includes('%');
      return {
        ...card,
        isPercent,
        numericValue,
        displayValue: isPercent && !rawValue.includes('%') ? `${numericValue}%` : card.value,
        color: chartColors[index % chartColors.length],
      };
    });

    const chartGroups = [
      { key: 'percent', title: 'Percentage KPIs', items: chartItems.filter(item => item.isPercent), unit: '%' },
      { key: 'count', title: 'Count KPIs', items: chartItems.filter(item => !item.isPercent), unit: '' },
    ].filter(group => group.items.length > 0);

    const renderChartGroup = (group) => {
      const chartHeight = 180;
      const maxValue = Math.max(...group.items.map(item => item.numericValue), 1);
      const yAxisMax = group.unit === '%' ? 100 : Math.max(5, Math.ceil(maxValue / 5) * 5);
      const tickValues = [yAxisMax, yAxisMax * 0.75, yAxisMax * 0.5, yAxisMax * 0.25, 0].map(value => Math.round(value));
      const formatTick = (tick) => group.unit === '%' ? `${tick}%` : tick;
      const formatTooltip = (item) => `${item.label}: ${item.displayValue}`;

      return (
        <div key={group.key} style={{ marginTop: group.key === chartGroups[0].key ? 0 : '22px' }}>
          {chartGroups.length > 1 && <div style={{ fontSize: '13px', fontWeight: 800, marginBottom: '8px', color: '#172b4d' }}>{group.title}</div>}
          <div style={{ overflowX: 'auto', paddingBottom: '6px' }}>
            <div style={{ minWidth: `${Math.max(520, group.items.length * 140)}px` }}>
              <div style={{ display: 'grid', gridTemplateColumns: '46px 1fr', gap: '10px' }}>
                <div style={{ height: `${chartHeight}px`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: '#7a869a', fontSize: '11px', textAlign: 'right' }}>
                  {tickValues.map((tick, index) => <span key={`${group.key}-${tick}-${index}`}>{formatTick(tick)}</span>)}
                </div>
                <div style={{ position: 'relative', height: `${chartHeight}px`, borderLeft: '1px solid #dfe1e6', borderBottom: '1px solid #dfe1e6' }}>
                  {[0, 25, 50, 75, 100].map(line => (
                    <div key={line} style={{ position: 'absolute', left: 0, right: 0, bottom: `${line}%`, borderTop: '1px solid #ebecf0' }} />
                  ))}
                  <div style={{ position: 'absolute', inset: '0 10px 0 10px', display: 'flex', alignItems: 'flex-end', gap: '14px' }}>
                    {group.items.map((item) => {
                      const barHeight = Math.max(4, Math.round((item.numericValue / yAxisMax) * chartHeight));

                      return renderDrilldownLink(data.drilldowns?.allWork?.url, (
                      <div key={item.label} title={formatTooltip(item)} style={{ position: 'relative', width: '100%', height: `${chartHeight}px`, cursor: 'pointer' }}>
                        <strong style={{ position: 'absolute', left: 0, right: 0, bottom: `${barHeight + 6}px`, color: '#172b4d', textAlign: 'center' }}>{item.displayValue}</strong>
                        <div style={{ position: 'absolute', left: '16%', right: '16%', bottom: 0, minHeight: '4px', height: `${barHeight}px`, background: item.color, borderRadius: '4px 4px 0 0' }} />
                      </div>
                    ), { flex: 1, minWidth: '96px', height: `${chartHeight}px`, display: 'block' });
                    })}
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `46px repeat(${group.items.length}, minmax(96px, 1fr))`, gap: '10px', marginTop: '10px' }}>
                <span />
                {group.items.map((item) => (
                  <div key={item.label} style={{ minWidth: 0, textAlign: 'left' }}>
                    <div title={item.label} style={{ ...mutedStyle, whiteSpace: 'normal', lineHeight: '15px' }}>{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    };

    return (
      <div style={{ ...visualPanelStyle, margin: '0 16px 14px', padding: '18px' }}>
        <div style={{ fontSize: '15px', fontWeight: 800, marginBottom: '4px' }}>{config.dashboardProfile || config.title || 'Dashboard KPIs'}</div>
        <div style={{ ...mutedStyle, marginBottom: '14px' }}>KPI comparison by generated ticket data</div>
        {chartGroups.map(renderChartGroup)}
      </div>
    );
  };

  const renderDataNotes = () => {
    return null;
  };

  const renderDrilldownLink = (url, children, style = {}) => {
    if (!url) {
      return children;
    }

    return (
      <a
        href={url}
        onClick={(event) => {
          event.preventDefault();
          router.open(url).catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
        }}
        style={{ color: 'inherit', textDecoration: 'none', ...style }}
      >
        {children}
      </a>
    );
  };

  const getItemDrilldownUrl = (type, item) => {
    const base = (config.allWorkJql || config.jql || '').replace(/\s+ORDER\s+BY\s+.+$/i, '').trim();

    if (!base || !item?.name) {
      return data.drilldowns?.allWork?.url;
    }

    if (type === 'sprint' && item.projectKey && item.sprintName) {
      return `/issues/?jql=${encodeURIComponent(`project = "${item.projectKey}" AND sprint = "${item.sprintName}" AND status = "${item.statusName || item.name}"`)}`;
    }

    if (type === 'status') return `/issues/?jql=${encodeURIComponent(`${base} AND status = "${item.name}"`)}`;
    if (type === 'priority') return `/issues/?jql=${encodeURIComponent(`${base} AND priority = "${item.name}"`)}`;
    if (type === 'project') return `/issues/?jql=${encodeURIComponent(`project = "${item.name}"`)}`;
    if (type === 'aging') return data.drilldowns?.open?.url;
    if (type === 'escalations') return item.name === 'Within SLA' ? data.drilldowns?.open?.url : data.drilldowns?.slaBreached?.url;
    if (type === 'sprint') return `/issues/?jql=${encodeURIComponent(`${base} AND sprint in openSprints() AND status = "${item.name}"`)}`;
    if (type === 'sprint-health') return `/issues/?jql=${encodeURIComponent(`${base} AND sprint in openSprints() AND status = "${item.name}"`)}`;
    if (type === 'reports') return `/issues/?jql=${encodeURIComponent(`${base} AND status = "${item.name}"`)}`;

    return data.drilldowns?.allWork?.url;
  };

  const renderHorizontalBars = (items, emptyMessage, drilldownType) => {
    const max = Math.max(...items.map((item) => item.count), 1);
    const total = items.reduce((sum, item) => sum + item.count, 0);

    if (items.length === 0) {
      return <div style={{ ...mutedStyle, margin: '0 16px 14px' }}>{emptyMessage}</div>;
    }

    return (
      <div style={{ ...visualPanelStyle, margin: '0 16px 14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px 74px', gap: '10px', ...mutedStyle, fontWeight: 800, textTransform: 'uppercase', marginBottom: '10px' }}>
          <span>Dimension</span>
          <span>Count</span>
          <span>Share</span>
        </div>
        {items.map((item, index) => {
          const percent = formatPercent(item.count, total);

          return renderDrilldownLink(getItemDrilldownUrl(drilldownType, item), (
            <div key={item.name} style={{ display: 'grid', gridTemplateColumns: '1fr 72px 74px', gap: '10px', alignItems: 'center', marginBottom: '10px', cursor: 'pointer' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '5px' }}>
                  <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                </div>
                <div style={{ height: '11px', background: '#ebecf0', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(8, Math.round((item.count / max) * 100))}%`, height: '100%', background: chartColors[index % chartColors.length] }} />
                </div>
              </div>
              <strong>{item.count}</strong>
              <span style={mutedStyle}>{percent}</span>
            </div>
          ), { display: 'block' });
        })}
      </div>
    );
  };

  const renderVerticalBars = (items, emptyMessage, drilldownType) => {
    const max = Math.max(...items.map((item) => item.count), 1);
    const total = items.reduce((sum, item) => sum + item.count, 0);
    const yAxisTicks = [max, Math.round(max * 0.75), Math.round(max * 0.5), Math.round(max * 0.25), 0]
      .filter((value, index, values) => values.indexOf(value) === index);

    if (items.length === 0) {
      return <div style={{ ...mutedStyle, margin: '0 16px 14px' }}>{emptyMessage}</div>;
    }

    return (
      <div
        onMouseLeave={clearChartTooltip}
        style={{ ...visualPanelStyle, margin: '0 16px 14px', position: 'relative', minHeight: '250px', padding: '18px 18px 14px' }}
      >
        {hoveredChartItem && <div style={chartTooltipStyle}>{typeof hoveredChartItem === 'string' ? hoveredChartItem : hoveredChartItem.label}</div>}
        <div style={{ fontSize: '15px', fontWeight: 800, textAlign: 'left', marginBottom: '10px' }}>{config.title || 'Bar Chart'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '160px', color: '#7a869a', fontSize: '11px', textAlign: 'right' }}>
            {yAxisTicks.map(tick => <span key={tick}>{tick}</span>)}
          </div>
          <div style={{ position: 'relative', height: '160px', borderLeft: '1px solid #dfe1e6', borderBottom: '1px solid #dfe1e6' }}>
            {[0, 25, 50, 75, 100].map(line => (
              <div key={line} style={{ position: 'absolute', left: 0, right: 0, bottom: `${line}%`, borderTop: '1px solid #ebecf0' }} />
            ))}
            <div style={{ position: 'absolute', inset: '0 8px 0 8px', display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
              {items.map((item, index) => {
                const segmentCount = Math.max(1, Math.min(4, item.count));
                const segmentHeight = Math.max(3, Math.round((item.count / max) * 150));

                return (
                  <div key={`${item.projectKey || ''}-${item.sprintId || ''}-${item.name}`} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                    {renderDrilldownLink(getItemDrilldownUrl(drilldownType, item), (
                      <div
                        title={getChartTooltipText(item, total)}
                        onMouseEnter={() => showChartTooltip(item, total)}
                        onFocus={() => showChartTooltip(item, total)}
                        onTouchStart={() => showChartTooltip(item, total)}
                        onBlur={clearChartTooltip}
                        style={{
                          height: `${segmentHeight}px`,
                          minHeight: item.count > 0 ? '7px' : '2px',
                          width: '72%',
                          margin: '0 auto',
                          display: 'flex',
                          flexDirection: 'column-reverse',
                          borderRadius: '4px 4px 0 0',
                          overflow: 'hidden',
                          cursor: 'pointer',
                          boxShadow: (typeof hoveredChartItem === 'object' ? hoveredChartItem.label : hoveredChartItem) === getChartTooltipText(item, total) ? '0 0 0 3px rgba(0, 82, 204, 0.18)' : 'none',
                        }}
                        tabIndex="0"
                      >
                        {Array.from({ length: segmentCount }).map((_, segmentIndex) => (
                          <span
                            key={segmentIndex}
                            style={{
                              flex: 1,
                              minHeight: '3px',
                              background: chartColors[(index + segmentIndex) % chartColors.length],
                              borderTop: segmentIndex === 0 ? 'none' : '1px solid rgba(255,255,255,0.55)',
                            }}
                          />
                        ))}
                      </div>
                    ), { display: 'block' })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `34px repeat(${items.length}, minmax(0, 1fr))`, gap: '8px', marginTop: '8px' }}>
          <span />
          {items.map((item) => (
            <div key={`${item.name}-label`} style={{ textAlign: 'left', minWidth: 0 }}>
              <div style={{ fontWeight: 800 }}>{item.count}</div>
              <div style={{ ...mutedStyle, transform: items.length > 6 ? 'rotate(-38deg)' : 'none', transformOrigin: 'top center', height: items.length > 6 ? '42px' : 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.projectKey ? `${item.projectKey} ${item.name}` : item.name}
              </div>
            </div>
          ))}
        </div>
        <div style={{ ...mutedStyle, marginTop: '10px', textAlign: 'left', textTransform: 'uppercase' }}>{drilldownType === 'sprint' ? 'Sprint / Status' : 'Category'}</div>
      </div>
    );
  };

  const renderPieChart = (items, emptyMessage) => {
    const visibleItems = items.filter((item) => item.count > 0);
    const total = visibleItems.reduce((sum, item) => sum + item.count, 0);
    let runningTotal = 0;
    const segmentRanges = [];

    if (visibleItems.length === 0 || total === 0) {
      return <div style={{ ...mutedStyle, margin: '0 16px 14px' }}>{emptyMessage}</div>;
    }

    const segments = visibleItems.map((item, index) => {
      const start = (runningTotal / total) * 360;
      runningTotal += item.count;
      const end = (runningTotal / total) * 360;
      segmentRanges.push({ item, start, end });
      return `${chartColors[index % chartColors.length]} ${start}deg ${end}deg`;
    });

    const getTotalHoverItem = () => ({
      name: 'Total',
      count: total,
      percent: '100%',
      label: `Total: ${total}`,
    });
    const centerItem = typeof hoveredChartItem === 'object' && hoveredChartItem
      ? hoveredChartItem
      : {
          name: visibleItems[0].name,
          count: visibleItems[0].count,
          percent: formatPercent(visibleItems[0].count, total),
          label: getChartTooltipText(visibleItems[0], total),
        };

    const showPieTooltipForPointer = (event) => {
      const pointer = event.touches?.[0] || event;
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = pointer.clientX - bounds.left - (bounds.width / 2);
      const y = pointer.clientY - bounds.top - (bounds.height / 2);
      const distanceFromCenter = Math.sqrt((x * x) + (y * y));
      const outerRadius = bounds.width / 2;
      const innerRadius = outerRadius * 0.47;

      if (distanceFromCenter < innerRadius || distanceFromCenter > outerRadius) {
        setHoveredChartItem(getTotalHoverItem());
        return;
      }

      // CSS conic gradients start at the top of the circle. This conversion
      // keeps the calculated pointer angle aligned with the rendered segments.
      const angle = (Math.atan2(y, x) * (180 / Math.PI) + 450) % 360;
      const segment = segmentRanges.find((range) => angle >= range.start && angle < range.end);

      if (segment) {
        showChartTooltip(segment.item, total);
      }
    };

    return (
      <div
        onMouseLeave={clearChartTooltip}
        style={{
          ...visualPanelStyle,
          margin: '0 16px 14px',
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '24px',
          alignItems: 'center',
          minHeight: '260px',
          padding: '18px 24px',
          overflowX: 'auto',
        }}
      >
        {hoveredChartItem && <div style={chartTooltipStyle}>{typeof hoveredChartItem === 'string' ? hoveredChartItem : hoveredChartItem.label}</div>}
        {renderDrilldownLink(data.drilldowns?.allWork?.url, (
        <div
          title={`Total: ${total}`}
          onMouseMove={showPieTooltipForPointer}
          onTouchStart={showPieTooltipForPointer}
          onFocus={() => setHoveredChartItem(getTotalHoverItem())}
          onBlur={clearChartTooltip}
          style={{
            width: 'min(260px, 76vw)',
            height: 'min(260px, 76vw)',
            maxWidth: '260px',
            maxHeight: '260px',
            minWidth: '210px',
            minHeight: '210px',
            borderRadius: '50%',
            background: `radial-gradient(circle at center, #ffffff 0 33%, transparent 34%), conic-gradient(${segments.join(', ')})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            margin: '0 auto',
            transition: 'filter 0.15s, box-shadow 0.15s',
            boxShadow: hoveredChartItem ? '0 0 0 4px rgba(0, 82, 204, 0.14)' : 'none',
          }}
          tabIndex="0"
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#0052cc', fontSize: '36px', lineHeight: '38px', fontWeight: 800 }}>{centerItem.percent}</div>
            <div style={{ ...mutedStyle, maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{centerItem.name}</div>
          </div>
        </div>
        ), { display: 'block' })}
        <div>
          <div style={{ fontSize: '16px', fontWeight: 800, marginBottom: '2px' }}>{viewType === 'priority' ? 'Priority' : 'Project'}</div>
          <div style={{ ...mutedStyle, paddingBottom: '9px', marginBottom: '11px', borderBottom: '1px solid #7a869a' }}>Total Issues: {total}</div>
          {visibleItems.map((item, index) => {
            const percent = Math.round((item.count / total) * 100);

            return (
              <div
                key={item.name}
                title={getChartTooltipText(item, total)}
                onMouseEnter={() => showChartTooltip(item, total)}
                onFocus={() => showChartTooltip(item, total)}
                onTouchStart={() => showChartTooltip(item, total)}
                onBlur={clearChartTooltip}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '11px', cursor: 'pointer' }}
                tabIndex="0"
              >
                {renderDrilldownLink(getItemDrilldownUrl(viewType, item), (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <span style={{ width: '13px', height: '13px', background: chartColors[index % chartColors.length], flex: '0 0 auto' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                    </div>
                    <strong>{item.count} ({percent}%)</strong>
                  </>
                ), { display: 'contents' })}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderAverageTimeBars = (items) => {
    const maxDays = Math.max(...items.map((item) => item.count), 1);

    if (items.length === 0) {
      return <div style={{ ...mutedStyle, margin: '0 16px 14px' }}>No status timing data found.</div>;
    }

    return <div style={{ ...visualPanelStyle, margin: '0 16px 14px' }}>{items.map((item) => (
      <div key={item.name} style={{ marginBottom: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '5px' }}>
          <span>{item.name}</span>
          <strong>{item.count} days</strong>
        </div>
        <div style={{ height: '8px', background: '#ebecf0', borderRadius: '999px', overflow: 'hidden' }}>
          <div style={{ width: `${Math.max(6, Math.round((item.count / maxDays) * 100))}%`, height: '100%', background: '#ff991f' }} />
        </div>
        <div style={{ ...mutedStyle, marginTop: '4px' }}>{item.issueCount} issue{item.issueCount === 1 ? '' : 's'} currently in this status</div>
      </div>
    ))}</div>;
  };

  const renderCreatedResolvedTrend = (items) => {
    const recentItems = items;
    const maxTotal = Math.max(...recentItems.map((item) => item.created + item.resolved), 1);
    const chartHeight = 170;
    const points = recentItems.map((item, index) => {
      const x = recentItems.length === 1 ? 0 : (index / (recentItems.length - 1)) * 100;
      const yCreated = 100 - ((item.created / maxTotal) * 100);
      const yResolved = 100 - ((item.resolved / maxTotal) * 100);
      return { ...item, x, yCreated, yResolved };
    });
    const createdPolyline = points.map(point => `${point.x},${point.yCreated}`).join(' ');
    const resolvedPolyline = points.map(point => `${point.x},${point.yResolved}`).join(' ');
    const createdArea = points.length > 0
      ? `0,100 ${createdPolyline} 100,100`
      : '';

    if (recentItems.length === 0) {
      return <div style={{ ...mutedStyle, margin: '0 16px 14px' }}>No created or resolved work found.</div>;
    }

    return (
      <div style={{ ...visualPanelStyle, margin: '0 16px 14px', padding: '18px' }}>
        <div style={{ fontSize: '15px', fontWeight: 800, textAlign: 'left', marginBottom: '10px' }}>{config.title || 'Custom Created Date vs Resolved Date'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: `${chartHeight}px`, color: '#7a869a', fontSize: '11px', textAlign: 'right' }}>
            {[maxTotal, Math.round(maxTotal * 0.75), Math.round(maxTotal * 0.5), Math.round(maxTotal * 0.25), 0].map(tick => <span key={tick}>{tick}</span>)}
          </div>
          <div style={{ position: 'relative', height: `${chartHeight}px`, borderLeft: '1px solid #dfe1e6', borderBottom: '1px solid #dfe1e6' }}>
            {[0, 25, 50, 75, 100].map(line => (
              <div key={line} style={{ position: 'absolute', left: 0, right: 0, bottom: `${line}%`, borderTop: '1px solid #ebecf0' }} />
            ))}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
              <polygon points={createdArea} fill="rgba(222, 53, 11, 0.72)" stroke="none" />
              <polyline points={createdPolyline} fill="none" stroke="#de350b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <polyline points={resolvedPolyline} fill="none" stroke="#36b37e" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              {points.map((point) => (
                <circle key={`${point.name}-resolved`} cx={point.x} cy={point.yResolved} r="1.2" fill="#36b37e" vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: '6px', padding: '0 8px', pointerEvents: 'none' }}>
              {recentItems.map((item, index) => (
                <div key={`${item.name}-bars`} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '2px', height: '100%' }}>
                  <div style={{ width: '32%', height: `${Math.max(2, Math.round((item.created / maxTotal) * chartHeight))}px`, background: 'rgba(222, 53, 11, 0.25)' }} />
                  <div style={{ width: '32%', height: `${Math.max(2, Math.round((item.resolved / maxTotal) * chartHeight))}px`, background: 'rgba(54, 179, 126, 0.35)' }} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `34px repeat(${recentItems.length}, minmax(0, 1fr))`, gap: '6px', marginTop: '8px' }}>
          <span />
          {recentItems.map(item => (
            <div key={`${item.name}-axis`} style={{ ...mutedStyle, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '14px', justifyContent: 'flex-start', marginTop: '10px', ...mutedStyle }}>
          <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#de350b', marginRight: '5px' }} />Created</span>
          <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#36b37e', marginRight: '5px' }} />Resolved</span>
        </div>
      </div>
    );
  };

  const renderSprintHealthPanel = (health, activeSprintNames) => {
    const total = Math.max(health.total || 0, 1);
    const todo = health.todo || 0;
    const inProgress = health.inProgress || 0;
    const done = health.done || 0;
    const completionPercent = Math.round((done / total) * 100);
    const activePercent = Math.round(((inProgress + done) / total) * 100);
    const blockers = issues.filter(issue => issue.status !== 'Done' && ['Highest', 'Critical', 'High'].includes(issue.priority)).length;
    const flagged = issues.filter(issue => ['Highest', 'Critical'].includes(issue.priority)).length;
    const assignees = Array.from(new Set(issues.map(issue => issue.assignee).filter(Boolean))).slice(0, 6);

    return (
      <div style={{ margin: '0 16px 14px', border: '1px solid #dfe1e6', background: '#ffffff' }}>
        <div style={{ padding: '22px 22px 18px', borderBottom: '1px solid #dfe1e6' }}>
          <div style={{ fontSize: '34px', lineHeight: '42px', color: '#172b4d' }}>
            Sprint <span style={{ color: '#7a869a' }}>- {activeSprintNames}</span>
          </div>
        </div>
        <div style={{ padding: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '18px', alignItems: 'center', marginBottom: '18px' }}>
            <div style={{ fontSize: '20px', fontWeight: 800 }}>Overall sprint progress <span style={{ fontWeight: 400 }}>(Work Items)</span></div>
            <div style={{ color: '#7a869a', fontSize: '20px', fontWeight: 800 }}>active</div>
          </div>
          {renderDrilldownLink(data.drilldowns?.allWork?.url, (
            <div style={{ display: 'flex', height: '64px', borderRadius: '4px', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ flex: Math.max(todo, 0.1), background: '#4f6f91', color: '#ffffff', display: 'flex', alignItems: 'center', paddingLeft: '14px', fontSize: '20px', fontWeight: 800 }}>{todo}</div>
              <div style={{ flex: Math.max(inProgress, 0.1), background: '#ffcb2f', color: '#172b4d', display: 'flex', alignItems: 'center', paddingLeft: '14px', fontSize: '20px', fontWeight: 800 }}>{inProgress}</div>
              <div style={{ flex: Math.max(done, 0.1), background: '#008c2e', color: '#ffffff', display: 'flex', alignItems: 'center', paddingLeft: '14px', fontSize: '20px', fontWeight: 800 }}>{done}</div>
            </div>
          ), { display: 'block' })}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '14px', marginTop: '20px', textAlign: 'center' }}>
            {[
              { value: `${activePercent}%`, label: 'Time elapsed' },
              { value: `${completionPercent}%`, label: 'Work complete' },
              { value: '0%', label: 'Scope change' },
              { value: blockers, label: 'Blocker' },
              { value: flagged, label: 'Flagged' },
            ].map(item => (
              <div key={item.label}>
                <div style={{ fontSize: '28px', lineHeight: '32px', color: '#172b4d' }}>{item.value}</div>
                <div style={{ fontSize: '15px', marginTop: '5px' }}>{item.label}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: '22px' }}>
            <div style={{ fontSize: '20px', fontWeight: 800, marginBottom: '12px' }}>Assignees in Sprint</div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {assignees.length === 0
                ? <span style={mutedStyle}>No assignees found.</span>
                : assignees.map((assignee, index) => (
                  <div key={assignee} title={assignee} style={{ width: '42px', height: '42px', borderRadius: '4px', background: chartColors[index % chartColors.length], color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>
                    {assignee.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const getIssueRiskColor = (issue) => {
    if (['Highest', 'Critical'].includes(issue.priority)) return '#de350b';
    if (issue.priority === 'High') return '#ff991f';
    if (issue.status === 'Done') return '#00875a';
    return '#0052cc';
  };

  const getIssueUrl = (issue) => `/browse/${issue.key}`;

  const getIssueTypeIcon = (issueType = '') => {
    const normalized = issueType.toLowerCase();

    if (normalized.includes('bug') || normalized.includes('incident')) {
      return normalized.includes('incident')
        ? { icon: 'incident', color: '#de350b' }
        : { icon: 'bug', color: '#de350b' };
    }

    if (normalized.includes('story') || normalized.includes('service request')) {
      return normalized.includes('service request')
        ? { icon: 'service-request', color: '#00875a' }
        : { icon: 'story', color: '#36b37e' };
    }

    if (normalized.includes('task')) {
      return { icon: 'task', color: '#0052cc' };
    }

    if (normalized.includes('epic')) {
      return { icon: 'epic', color: '#6554c0' };
    }

    if (normalized.includes('change')) {
      return { icon: 'change', color: '#ff8b00' };
    }

    if (normalized.includes('problem')) {
      return { icon: 'problem', color: '#bf2600' };
    }

    return { icon: 'work-item', color: '#42526e' };
  };

  const renderIssueTypeIcon = (issueType) => {
    const issueTypeIcon = getIssueTypeIcon(issueType);
    const commonProps = {
      width: 18,
      height: 18,
      viewBox: '0 0 18 18',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      role: 'img',
      'aria-label': issueType || 'Work item',
      style: { display: 'block' },
    };

    const strokeProps = {
      stroke: issueTypeIcon.color,
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    };

    if (issueTypeIcon.icon === 'story') {
      return (
        <svg {...commonProps}>
          <path d="M5 3.5h8v11l-4-2.7-4 2.7v-11z" {...strokeProps} />
        </svg>
      );
    }

    if (issueTypeIcon.icon === 'bug') {
      return (
        <svg {...commonProps}>
          <circle cx="9" cy="9.5" r="3.2" {...strokeProps} />
          <path d="M6.8 5.6 5.6 4.3M11.2 5.6l1.2-1.3M5.5 8H3.8M14.2 8h-1.7M5.8 12.2l-1.5 1.1M12.2 12.2l1.5 1.1M9 6.2V14" {...strokeProps} />
        </svg>
      );
    }

    if (issueTypeIcon.icon === 'task') {
      return (
        <svg {...commonProps}>
          <rect x="3.5" y="3.5" width="11" height="11" rx="2" {...strokeProps} />
          <path d="m6.3 9.1 1.9 1.9 3.7-4" {...strokeProps} />
        </svg>
      );
    }

    if (issueTypeIcon.icon === 'epic') {
      return (
        <svg {...commonProps}>
          <path d="M10.2 2.7 4.4 9.7h3.8l-.8 5.6 6.2-7.7H9.7l.5-4.9z" {...strokeProps} />
        </svg>
      );
    }

    if (issueTypeIcon.icon === 'incident') {
      return (
        <svg {...commonProps}>
          <path d="M9 3.2 15.3 14H2.7L9 3.2z" {...strokeProps} />
          <path d="M9 7v3.2M9 12.6h.1" {...strokeProps} />
        </svg>
      );
    }

    if (issueTypeIcon.icon === 'change') {
      return (
        <svg {...commonProps}>
          <path d="M4 6.2h8.5l-2-2M14 11.8H5.5l2 2" {...strokeProps} />
        </svg>
      );
    }

    if (issueTypeIcon.icon === 'problem') {
      return (
        <svg {...commonProps}>
          <circle cx="9" cy="9" r="5.8" {...strokeProps} />
          <path d="m5.2 12.8 7.6-7.6" {...strokeProps} />
        </svg>
      );
    }

    if (issueTypeIcon.icon === 'service-request') {
      return (
        <svg {...commonProps}>
          <path d="M4.2 10.2V8.4a4.8 4.8 0 0 1 9.6 0v1.8M4.2 10.2h2.1v3H4.2v-3zM11.7 10.2h2.1v3h-2.1v-3zM11.5 14.2H9.4" {...strokeProps} />
        </svg>
      );
    }

    return (
      <svg {...commonProps}>
        <rect x="3.5" y="3.5" width="11" height="11" rx="2" {...strokeProps} />
        <path d="M6.2 7h5.6M6.2 9.5h5.6M6.2 12h3.4" {...strokeProps} />
      </svg>
    );
  };

  const renderPriorityIcon = (priority) => {
    const priorityName = priority || 'Priority';
    const normalized = priorityName.toLowerCase();
    const isCritical = normalized === 'critical';
    const isHighest = normalized === 'highest';
    const isHigh = normalized === 'high';
    const isMedium = normalized === 'medium';
    const isLow = normalized === 'low';
    const isLowest = normalized === 'lowest';
    const isInformational = normalized === 'informational';
    const color = (isCritical || isHighest || isHigh)
      ? '#ff5630'
      : isMedium
        ? '#ff8b00'
        : (isLow || isLowest || isInformational)
          ? '#0065ff'
          : '#42526e';

    const commonProps = {
      width: 18,
      height: 18,
      viewBox: '0 0 18 18',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      role: 'img',
      'aria-label': `Priority: ${priorityName}`,
      style: { display: 'block' },
    };

    const strokeProps = {
      stroke: color,
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    };

    if (isCritical) {
      return (
        <svg {...commonProps}>
          <circle cx="9" cy="9" r="6.2" {...strokeProps} />
          <path d="M5.8 9h6.4" {...strokeProps} />
        </svg>
      );
    }

    if (isHighest) {
      return (
        <svg {...commonProps}>
          <path d="m5 10 4-4 4 4" {...strokeProps} />
          <path d="m5 14 4-4 4 4" {...strokeProps} />
        </svg>
      );
    }

    if (isHigh) {
      return (
        <svg {...commonProps}>
          <path d="m5 11 4-4 4 4" {...strokeProps} />
        </svg>
      );
    }

    if (isMedium) {
      return (
        <svg {...commonProps}>
          <path d="M5.5 7.4h7M5.5 10.6h7" {...strokeProps} />
        </svg>
      );
    }

    if (isLow) {
      return (
        <svg {...commonProps}>
          <path d="m5 7 4 4 4-4" {...strokeProps} />
        </svg>
      );
    }

    if (isLowest) {
      return (
        <svg {...commonProps}>
          <path d="m5 5 4 4 4-4" {...strokeProps} />
          <path d="m5 9 4 4 4-4" {...strokeProps} />
        </svg>
      );
    }

    if (isInformational) {
      return (
        <svg {...commonProps}>
          <path d="m5 4 4 4 4-4" {...strokeProps} />
          <path d="m5 8 4 4 4-4" {...strokeProps} />
          <path d="m5 12 4 4 4-4" {...strokeProps} />
        </svg>
      );
    }

    return (
      <svg {...commonProps}>
        <circle cx="9" cy="9" r="3.2" fill={color} />
      </svg>
    );
  };

  const renderIssueCards = (items, emptyMessage) => {
    if (items.length === 0) {
      return <div style={{ ...mutedStyle, margin: '0 16px 14px' }}>{emptyMessage}</div>;
    }

    const visibleItems = items.slice(0, 10);

    return (
      <div style={{ margin: '0 16px 14px', border: '1px solid #dfe1e6', borderRadius: '3px', overflowX: 'auto', overflowY: 'hidden', background: '#ffffff' }}>
        <div style={{ minWidth: '660px' }}>
        <div style={{ background: '#2f75b5', color: '#ffffff', padding: '4px 8px', fontSize: '11px', fontWeight: 800 }}>
          {config.title || 'Assigned To Me'}
        </div>
        <div style={tableHeaderStyle}>
          <span>Type</span>
          <span>Key</span>
          <span>Summary</span>
          <span style={{ textAlign: 'center' }}>P</span>
        </div>
        {visibleItems.map(issue => {
          return (
            <a
              key={issue.key}
              href={getIssueUrl(issue)}
              onClick={(event) => {
                event.preventDefault();
                router.open(getIssueUrl(issue)).catch(() => window.open(getIssueUrl(issue), '_blank', 'noopener,noreferrer'));
              }}
              style={tableRowStyle}
            >
              <span
                title={issue.issueType}
                style={{
                  justifySelf: 'center',
                  width: '22px',
                  height: '22px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {renderIssueTypeIcon(issue.issueType)}
              </span>
              <span style={{ color: '#0052cc', fontWeight: 800, fontSize: '12px' }}>{issue.key}</span>
              <span title={`${issue.issueType} - ${issue.status} - ${issue.priority} - ${issue.assignee}`} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#0052cc', fontSize: '12px', lineHeight: '18px' }}>
                {issue.summary}
                <span style={{ color: '#5e6c84' }}> - {issue.status}</span>
              </span>
              <span
                title={issue.priority}
                aria-label={`Priority: ${issue.priority}`}
                style={{
                  color: getIssueRiskColor(issue),
                  textAlign: 'center',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '24px',
                  height: '22px',
                  justifySelf: 'center',
                }}
              >
                {renderPriorityIcon(issue.priority)}
              </span>
            </a>
          );
        })}
        </div>
      </div>
    );
  };

  const getReadableViewPurpose = () => {
    if (viewType === 'environment') {
      return 'Top-level KPIs for health, SLA risk, delivery, and completion.';
    }
    if (viewType === 'created-resolved') {
      return 'Trend uses the generated custom Created Date and Resolved Date fields only.';
    }
    if (viewType === 'status') {
      return 'Shows where work is sitting across the workflow so bottlenecks are visible.';
    }
    if (viewType === 'priority') {
      return 'Shows risk mix so high-priority work is easy to spot.';
    }
    if (viewType === 'open-work' || viewType === 'reports') {
      return 'Lists the records that need follow-up; click any ticket to open it.';
    }
    if (viewType === 'escalations') {
      return 'Highlights SLA breach, near-breach, and high-priority pressure.';
    }
    if (viewType === 'ticket-aging') {
      return 'Groups open work by age to show stale or delayed items.';
    }
    if (viewType === 'average-time-status') {
      return 'Shows how long work has stayed in each current status.';
    }
    if (viewType === 'sprint-health') {
      return 'Summarizes sprint completion, active work, blockers, and assignees.';
    }
    if (viewType === 'sprint-burndown') {
      return 'Shows remaining sprint work by status for commitment tracking.';
    }
    if (viewType === 'roadmap') {
      return 'Shows upcoming releases and dates that may need attention.';
    }
    if (viewType === 'projects') {
      return 'Compares work volume across projects or teams.';
    }
    return 'Shows generated Jira demo data for this dashboard section.';
  };

  const getReadableAction = () => {
    if (viewType === 'created-resolved') {
      return 'Created higher than resolved means demand is outpacing completion.';
    }
    if (viewType === 'priority') {
      return 'Start with Critical, Highest, and High items first.';
    }
    if (viewType === 'status') {
      return 'Large In Progress or Waiting columns indicate workflow pressure.';
    }
    if (viewType === 'escalations') {
      return 'Review breached and near-breach tickets before healthy work.';
    }
    if (viewType === 'open-work' || viewType === 'reports') {
      return 'Open a row to inspect the source Jira ticket.';
    }
    if (viewType === 'ticket-aging') {
      return 'Investigate the oldest bands before newer work.';
    }
    if (viewType === 'sprint-health' || viewType === 'sprint-burndown') {
      return 'Use this to decide whether the sprint is still on track.';
    }
    if (viewType === 'roadmap') {
      return 'Use this to confirm release readiness and upcoming milestones.';
    }
    if (viewType === 'projects') {
      return 'Use higher-volume projects to identify capacity or demand hotspots.';
    }
    return 'Use the chart and drilldowns to identify where attention is needed.';
  };

  const renderVisualSummary = () => {
    const metricNames = (config.dashboardMetrics || []).slice(0, 3);
    const kpiNames = (config.dashboardKpis || []).slice(0, 3);

    return (
      <div style={{
        margin: '0 16px 14px',
        border: '1px solid #dfe1e6',
        borderLeft: '4px solid #0052cc',
        borderRadius: '3px',
        background: '#fafbfc',
        padding: '10px 12px',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        gap: '12px',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#42526e', fontSize: '10px', fontWeight: 800, letterSpacing: '0.3px', textTransform: 'uppercase', marginBottom: '4px' }}>What this shows</div>
          <div style={{ color: '#172b4d', fontSize: '12px', lineHeight: '17px' }}>{getReadableViewPurpose()}</div>
          {metricNames.length > 0 && (
            <div style={{ ...mutedStyle, marginTop: '5px' }}>
              Metrics: {metricNames.join(', ')}
            </div>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#42526e', fontSize: '10px', fontWeight: 800, letterSpacing: '0.3px', textTransform: 'uppercase', marginBottom: '4px' }}>How to read it</div>
          <div style={{ color: '#172b4d', fontSize: '12px', lineHeight: '17px' }}>{getReadableAction()}</div>
          {kpiNames.length > 0 && (
            <div style={{ ...mutedStyle, marginTop: '5px' }}>
              KPIs: {kpiNames.join(', ')}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (viewType === 'environment') {
    const projects = config.projects || [];
    const businessCount = projects.filter((project) => project.type === 'ITSM' || project.type === 'Business').length;
    const softwareCount = projects.filter((project) => project.type === 'Software').length;
    const totalWork = projects.reduce((sum, project) => sum + (project.count || 0), 0);
    const kpiCards = data.kpiCards || [];
    const fallbackKpiCards = [
      { label: 'JSM ITSM projects', value: businessCount, detail: 'JSM demo operations' },
      { label: 'Software projects', value: softwareCount, detail: 'Delivery teams' },
      { label: 'Total demo work', value: totalWork, detail: 'Issues and incidents' },
      { label: 'Generated snapshot', value: projects.length || 1, detail: formatDisplayDate(generatedAt) },
    ];

    return (
      <div style={shellStyle}>
        {renderHeader(config.environmentName || config.title || 'Demo Environment', config.filterName)}
        {visualType === 'executive-scorecard' ? null : renderRetentionPanel()}
        {renderKpiBarChart(kpiCards.length > 0 ? kpiCards : fallbackKpiCards)}
        {renderDataNotes()}
      </div>
    );
  }

  if (viewType === 'projects') {
    const projectRows = (config.projects || []).map(project => ({
      name: project.key,
      count: project.count || 0,
      projectKey: project.key,
    }));

    return (
      <div style={shellStyle}>
        {renderHeader(config.title || 'Demo Projects', config.filterName)}
        {renderVisualSummary()}
        {visualType.includes('bars')
          ? renderHorizontalBars(projectRows, 'No project work found.', 'project')
          : (config.projects || []).map((project) => (
            <div key={project.key} style={compactRowStyle}>
              <div>
                <span style={{ fontWeight: 700 }}>{project.key}</span> {project.name}
                <div style={{ ...mutedStyle, marginTop: '2px' }}>{project.type}{project.boardId ? `, board ${project.boardId}` : ''}</div>
              </div>
              <span style={{ ...badgeStyle, background: '#deebff', color: '#0747a6' }}>{project.count}</span>
            </div>
          ))}
      </div>
    );
  }

  if (viewType === 'status' || viewType === 'priority') {
    const rows = viewType === 'status' ? data.statusCounts : data.priorityCounts;

    return (
      <div style={shellStyle}>
        {renderHeader(config.title, config.filterName)}
        {renderVisualSummary()}
        {viewType === 'priority' || visualType.includes('donut')
          ? renderPieChart(rows || [], 'No matching work found.')
          : renderStatusMatrix()}
      </div>
    );
  }

  if (viewType === 'overdue') {
    return (
      <div style={shellStyle}>
        {renderHeader(config.title, 'Overdue open work by project')}
        {renderVisualSummary()}
        {renderHorizontalBars(data.overdueByProject || [], 'No overdue work found.', 'project')}
      </div>
    );
  }

  if (viewType === 'sprint-burndown') {
    return (
      <div style={shellStyle}>
        {renderHeader(config.title, 'Current sprint work distribution')}
        {renderVisualSummary()}
        {renderVerticalBars(data.burndown || [], 'No sprint work found.', 'sprint')}
      </div>
    );
  }

  if (viewType === 'average-time-status') {
    return (
      <div style={shellStyle}>
        {renderHeader(config.title, 'Average days since each issue entered its current status')}
        {renderVisualSummary()}
        {renderAverageTimeBars(data.averageTimeInStatus || [])}
      </div>
    );
  }

  if (viewType === 'ticket-aging') {
    return (
      <div style={shellStyle}>
        {renderHeader(config.title, 'Generated lifecycle age bands')}
        {renderVisualSummary()}
        {renderHorizontalBars(data.ticketAging || [], 'No ticket aging data found.', 'aging')}
      </div>
    );
  }

  if (viewType === 'escalations') {
    return (
      <div style={shellStyle}>
        {renderHeader(config.title, 'Escalation and SLA indicators')}
        {renderVisualSummary()}
        {renderPieChart(data.escalationMetrics || [], 'No escalation data found.')}
      </div>
    );
  }

  if (viewType === 'reports') {
    return (
      <div style={shellStyle}>
        {renderHeader(config.title, 'High-demand request detail')}
        {renderVisualSummary()}
        {renderIssueCards(issues, 'No matching work found.')}
      </div>
    );
  }

  if (viewType === 'created-resolved') {
    return (
      <div style={shellStyle}>
        {renderHeader(config.title, 'Custom Created Date / Resolved Date across selected ticket duration')}
        {renderVisualSummary()}
        {renderCreatedResolvedTrend(data.createdResolvedTrend || [])}
      </div>
    );
  }

  if (viewType === 'sprint-health') {
    const health = data.sprintHealth || {};
    const activeSprintNames = (health.activeSprints || []).map((sprint) => sprint.name).join(', ') || 'No active sprint found';

    return (
      <div style={shellStyle}>
        {renderHeader(config.title, activeSprintNames)}
        {renderVisualSummary()}
        {renderSprintHealthPanel(health, activeSprintNames)}
      </div>
    );
  }

  if (viewType === 'roadmap') {
    return (
      <div style={shellStyle}>
        {renderHeader(config.title, 'Release versions due in the next 30 days')}
        {renderVisualSummary()}
        {(data.roadmap || []).length === 0
          ? <div style={mutedStyle}>No releases are due in the next 30 days.</div>
          : (data.roadmap || []).map((version) => (
            <div key={`${version.projectKey}-${version.name}`} style={timelineRowStyle}>
              <span style={timelineTitleStyle} title={`${version.projectKey} ${version.name}`}>
                <strong>{version.projectKey}</strong> {version.name}
              </span>
              <span style={{ ...badgeStyle, justifySelf: 'end', whiteSpace: 'nowrap', background: version.released ? '#e3fcef' : '#fff0b3', color: version.released ? '#006644' : '#7a5d00' }}>
                {version.releaseDate || 'No date'}{version.released ? ' released' : ''}
              </span>
            </div>
          ))}
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      {renderHeader(config.title || 'Open Work', config.filterName)}
      {renderVisualSummary()}
      {renderIssueCards(issues, 'No matching work found.')}
      {renderDataNotes()}
    </div>
  );
}

function App() {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [progress, setProgress] = useState('');
  const [openDashboardPicker, setOpenDashboardPicker] = useState(null);

  const [form, setForm] = useState({
    industry: '',
    customIndustry: '',
    environmentName: '',
    opsDashboardTypes: [],
    opsDashboardPrompt: '',
    softwareDashboardTypes: [],
    softwareDashboardPrompt: '',
    dateRange: '6 months',
    jsmProjectCount: 0,
    incidentRequestsPerProject: 1,
    problemRequestsPerProject: 1,
    changeRequestsPerProject: 1,
    serviceRequestsPerProject: 1,
    softwareProjects: [],
    retentionPeriodDays: 180,
  });

  useEffect(() => {
    view.getContext().then(setContext).catch(() => setContext({}));
  }, []);

  if (context?.extension?.type === 'jira:dashboardGadget') {
    return <DashboardGadget context={context} />;
  }

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({
      ...form,
      [name]: value,
      ...(name === 'industry' && value !== 'Other' ? { customIndustry: '' } : {}),
    });
  };

  const toggleDashboardSelection = (fieldName, promptFieldName, options, value) => {
    const currentValues = form[fieldName] || [];
    const selectedValues = currentValues.includes(value)
      ? currentValues.filter(item => item !== value)
      : [...currentValues, value].filter(Boolean);

    setForm({
      ...form,
      [fieldName]: selectedValues,
      [promptFieldName]: buildDashboardPromptFromValues(options, selectedValues),
    });
  };

  const invokeDemoStepWithRetry = async ({ currentConfig, currentState, step }) => {
    const maxAttempts = ['create-business-project', 'create-software-project-shell'].includes(step.type) ? 2 : 1;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await invoke('executeDemoEnvironmentStep', {
          config: currentConfig,
          state: currentState,
          step,
        });
      } catch (err) {
        lastError = err;
        if (!/timed out|timeout/i.test(String(err?.message || '')) || attempt >= maxAttempts) {
          throw err;
        }

        setProgress(`Retrying ${step.label} after Jira project creation took too long...`);
        await new Promise(resolve => setTimeout(resolve, 8000));
      }
    }

    throw lastError;
  };

  const handleSubmit = async () => {
    if (!form.industry) {
      setResult('Please select a Domain');
      return;
    }

    const selectedIndustry = form.industry === 'Other' ? form.customIndustry.trim() : form.industry;

    if (form.industry === 'Other' && !selectedIndustry) {
      setResult('Please enter a custom Domain');
      return;
    }

    if (!form.environmentName.trim()) {
      setResult('Please enter a Client Name');
      return;
    }

    if (parseInt(form.jsmProjectCount, 10) > 0) {
      const requiredItsmFields = [
        ['incidentRequestsPerProject', 'Incidents'],
        ['serviceRequestsPerProject', 'Service Requests'],
        ['changeRequestsPerProject', 'Changes'],
        ['problemRequestsPerProject', 'Problems'],
      ];
      const missingItsmField = requiredItsmFields.find(([fieldName]) => (
        !Number.isFinite(parseInt(form[fieldName], 10)) || parseInt(form[fieldName], 10) < 1
      ));

      if (missingItsmField) {
        setResult(`Please enter at least 1 ${missingItsmField[1]} item for JSM ITSM linking.`);
        return;
      }
    }

    const incompleteSoftwareProjectIndex = form.softwareProjects.findIndex(project => (
      !project.softwareTemplate
      || !project.softwareProjectStyle
      || !String(project.issuesPerProject || '').trim()
    ));

    if (incompleteSoftwareProjectIndex >= 0) {
      setResult(`Please complete Project Template, Management, and Issues for Software Project ${incompleteSoftwareProjectIndex + 1}`);
      return;
    }

    setLoading(true);
    setResult('');
    setIsSuccess(false);
    setProgress('Preparing the demo environment plan...');

    try {
      const availableSoftwareDashboardOptions = getSoftwareDashboardOptions(form.softwareProjects);
      const selectedSoftwareDashboardTypes = filterDashboardValues(
        availableSoftwareDashboardOptions,
        form.softwareDashboardTypes
      );
      const selectedSoftwareDashboardPrompt = buildDashboardPromptFromValues(
        availableSoftwareDashboardOptions,
        selectedSoftwareDashboardTypes
      ) || form.softwareDashboardPrompt;

      const preparation = await invoke('prepareDemoEnvironment', {
        industry: selectedIndustry,
        customIndustry: form.customIndustry.trim(),
        isCustomIndustry: form.industry === 'Other',
        environmentName: form.environmentName,
        opsDashboardTypes: form.opsDashboardTypes,
        opsDashboardSelections: form.opsDashboardTypes
          .map(value => opsDashboardOptions.find(option => option.value === value))
          .filter(Boolean)
          .map(option => ({ value: option.value, label: option.label, prompt: option.prompt })),
        opsDashboardPrompt: form.opsDashboardPrompt,
        softwareDashboardTypes: selectedSoftwareDashboardTypes,
        softwareDashboardSelections: selectedSoftwareDashboardTypes
          .map(value => availableSoftwareDashboardOptions.find(option => option.value === value))
          .filter(Boolean)
          .map(option => ({ value: option.value, label: option.label, prompt: option.prompt })),
        softwareDashboardPrompt: selectedSoftwareDashboardPrompt,
        dateRange: form.dateRange,
        jsmProjectCount: parseInt(form.jsmProjectCount, 10),
        incidentRequestsPerProject: parseInt(form.incidentRequestsPerProject, 10),
        problemRequestsPerProject: parseInt(form.problemRequestsPerProject, 10),
        changeRequestsPerProject: parseInt(form.changeRequestsPerProject, 10),
        serviceRequestsPerProject: parseInt(form.serviceRequestsPerProject, 10),
        softwareProjects: form.softwareProjects.map(project => ({
          softwareTemplate: project.softwareTemplate,
          softwareProjectStyle: project.softwareProjectStyle,
          issuesPerProject: parseInt(project.issuesPerProject, 10),
        })),
        softwareProjectCount: form.softwareProjects.length,
        softwareTemplate: form.softwareProjects[0]?.softwareTemplate || 'scrum',
        softwareProjectStyle: form.softwareProjects[0]?.softwareProjectStyle || 'team-managed',
        issuesPerProject: parseInt(form.softwareProjects[0]?.issuesPerProject || 10, 10),
        sprintsPerProject: 4,
        retentionPeriodDays: parseInt(form.retentionPeriodDays, 10),
      });

      if (!preparation.success) {
        setProgress('');
        setResult(preparation.summary || 'Unable to prepare the demo environment.');
        setIsSuccess(false);
        setLoading(false);
        return;
      }

      let currentConfig = preparation.config;
      let currentState = preparation.state;
      const totalSteps = preparation.plan.length;

      for (let index = 0; index < totalSteps; index += 1) {
        const step = preparation.plan[index];
        setProgress(`Step ${index + 1} of ${totalSteps}: ${step.label}`);

        const stepResult = await invokeDemoStepWithRetry({
          currentConfig,
          currentState,
          step,
        });

        if (!stepResult.success) {
          throw new Error(stepResult.message || 'A step failed during environment creation.');
        }

        currentConfig = stepResult.config || currentConfig;
        currentState = stepResult.state;
      }

      setProgress('Finalizing summary...');

      const res = await invoke('finalizeDemoEnvironment', {
        config: currentConfig,
        state: currentState,
      });

      setProgress('');
      setResult(res.summary);
      setIsSuccess(res.success);
    } catch (err) {
      setProgress('');
      setResult('Error: ' + err.message);
      setIsSuccess(false);
    }

    setLoading(false);
  };

  const containerStyle = {
    minHeight: '100vh',
    backgroundColor: '#f4f5f7',
    padding: '40px 20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  };

  const cardStyle = {
    maxWidth: '920px',
    margin: '0 auto',
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    padding: '32px',
  };

  const headerStyle = {
    marginBottom: '32px',
    borderBottom: '1px solid #dfe1e6',
    paddingBottom: '16px',
  };

  const titleStyle = {
    fontSize: '24px',
    fontWeight: '600',
    color: '#172b4d',
    margin: '0 0 8px 0',
  };

  const subtitleStyle = {
    fontSize: '14px',
    color: '#5e6c84',
    margin: 0,
  };

  const fieldStyle = {
    marginBottom: '20px',
  };

  const labelStyle = {
    display: 'block',
    fontSize: '14px',
    fontWeight: '500',
    color: '#172b4d',
    marginBottom: '8px',
  };

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #dfe1e6',
    borderRadius: '4px',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s',
  };

  const selectStyle = {
    ...inputStyle,
    backgroundColor: '#fff',
    cursor: 'pointer',
  };

  const rowStyle = {
    display: 'flex',
    gap: '16px',
  };

  const colStyle = {
    flex: 1,
  };

  const countGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '16px',
    marginTop: '16px',
  };

  const threeColumnGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '16px',
    alignItems: 'end',
  };

  const projectCardStyle = {
    marginTop: '14px',
    padding: '14px',
    backgroundColor: '#fff',
    border: '1px solid #dfe1e6',
    borderRadius: '4px',
  };

  const projectCardHeaderStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'center',
    marginBottom: '12px',
  };

  const jsmProjectRowStyle = {
    display: 'grid',
    gridTemplateColumns: '130px repeat(4, minmax(110px, 1fr)) 82px',
    gap: '12px',
    alignItems: 'end',
  };

  const softwareProjectRowStyle = {
    display: 'grid',
    gridTemplateColumns: '150px minmax(150px, 1fr) minmax(170px, 1fr) minmax(90px, 0.7fr) 82px',
    gap: '12px',
    alignItems: 'end',
  };

  const removeButtonStyle = {
    ...inputStyle,
    width: 'auto',
    padding: '10px 12px',
    cursor: 'pointer',
    backgroundColor: '#fff',
  };

  const buttonStyle = {
    width: '100%',
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: '500',
    color: '#fff',
    backgroundColor: '#0052cc',
    border: 'none',
    borderRadius: '4px',
    cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.7 : 1,
    transition: 'background-color 0.2s',
  };

  const resultHasWarningsOrErrors = /(^|\n)\s*(Warnings \/ Errors|Error:)/i.test(result || '');
  const resultIsError = !isSuccess || resultHasWarningsOrErrors;

  const resultStyle = {
    marginTop: '24px',
    padding: '16px',
    borderRadius: '4px',
    fontSize: '13px',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
    backgroundColor: resultIsError ? '#ffebe6' : '#e3fcef',
    border: '1px solid',
    borderColor: resultIsError ? '#ff5630' : '#00875a',
    color: resultIsError ? '#bf2600' : '#006644',
  };

  const progressStyle = {
    marginTop: '16px',
    padding: '12px',
    backgroundColor: '#deebff',
    borderRadius: '4px',
    fontSize: '14px',
    color: '#0747a6',
    textAlign: 'center',
  };

  const sectionStyle = {
    marginBottom: '24px',
    padding: '16px',
    backgroundColor: '#f4f5f7',
    borderRadius: '4px',
  };

  const sectionTitleStyle = {
    fontSize: '12px',
    fontWeight: '600',
    color: '#5e6c84',
    textTransform: 'uppercase',
    marginBottom: '12px',
    letterSpacing: '0.5px',
  };

  const optionalSectionStyle = {
    ...sectionStyle,
    backgroundColor: '#fff',
    border: '1px solid #dfe1e6',
  };

  const pickerButtonStyle = {
    ...inputStyle,
    minHeight: '44px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    textAlign: 'left',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  };

  const pickerMenuStyle = {
    marginTop: '4px',
    border: '1px solid #dfe1e6',
    borderRadius: '4px',
    backgroundColor: '#fff',
    boxShadow: '0 8px 16px rgba(9, 30, 66, 0.15)',
    maxHeight: '240px',
    overflowY: 'auto',
    padding: '6px 0',
    position: 'relative',
    zIndex: 3,
  };

  const pickerOptionStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    fontSize: '14px',
    color: '#172b4d',
    cursor: 'pointer',
  };

  const infoIconStyle = {
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    border: '1px solid #6b778c',
    color: '#42526e',
    fontSize: '12px',
    fontWeight: 800,
    lineHeight: '16px',
    textAlign: 'center',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    cursor: 'help',
  };

  const selectedSoftwareProjectCount = form.softwareProjects.length;
  const selectedJsmProjectCount = Number.parseInt(form.jsmProjectCount, 10) || 0;
  const softwareDashboardOptions = getSoftwareDashboardOptions(form.softwareProjects);

  const addJsmProject = () => {
    if (selectedJsmProjectCount >= 10) {
      return;
    }

    setForm({
      ...form,
      jsmProjectCount: selectedJsmProjectCount + 1,
    });
  };

  const removeJsmProject = () => {
    const nextJsmProjectCount = Math.max(0, selectedJsmProjectCount - 1);

    setForm({
      ...form,
      jsmProjectCount: nextJsmProjectCount,
      ...(nextJsmProjectCount === 0 ? {
        opsDashboardTypes: [],
        opsDashboardPrompt: '',
      } : {}),
    });

    if (nextJsmProjectCount === 0 && openDashboardPicker === 'ops') {
      setOpenDashboardPicker(null);
    }
  };

  const updateSoftwareProject = (index, field, value) => {
    const updatedProjects = form.softwareProjects.map((project, projectIndex) => (
      projectIndex === index ? { ...project, [field]: value } : project
    ));
    const availableOptions = getSoftwareDashboardOptions(updatedProjects);
    const selectedValues = filterDashboardValues(availableOptions, form.softwareDashboardTypes);

    setForm({
      ...form,
      softwareProjects: updatedProjects,
      softwareDashboardTypes: selectedValues,
      softwareDashboardPrompt: buildDashboardPromptFromValues(availableOptions, selectedValues),
    });
  };

  const addSoftwareProject = () => {
    if (form.softwareProjects.length >= 10) {
      return;
    }

    const source = {
      softwareTemplate: '',
      softwareProjectStyle: '',
      issuesPerProject: 10,
    };

    setForm({
      ...form,
      softwareProjects: [...form.softwareProjects, { ...source }],
    });
  };

  const removeSoftwareProject = (index) => {
    const updatedProjects = form.softwareProjects.filter((_, projectIndex) => projectIndex !== index);
    const availableOptions = getSoftwareDashboardOptions(updatedProjects);
    const selectedValues = filterDashboardValues(availableOptions, form.softwareDashboardTypes);

    setForm({
      ...form,
      softwareProjects: updatedProjects,
      softwareDashboardTypes: selectedValues,
      softwareDashboardPrompt: buildDashboardPromptFromValues(availableOptions, selectedValues),
    });
  };

  const getDashboardSelectionLabel = (options, selectedValues, emptyLabel) => {
    const selectedLabels = selectedValues
      .map(value => options.find(option => option.value === value)?.label)
      .filter(Boolean);

    if (selectedLabels.length === 0) {
      return emptyLabel;
    }

    if (selectedLabels.length <= 2) {
      return selectedLabels.join(', ');
    }

    return `${selectedLabels.slice(0, 2).join(', ')} +${selectedLabels.length - 2} more`;
  };

  const renderDashboardMultiDropdown = ({
    id,
    options,
    selectedValues,
    fieldName,
    promptFieldName,
    disabled = false,
    emptyLabel,
  }) => (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpenDashboardPicker(openDashboardPicker === id ? null : id)}
        style={{
          ...pickerButtonStyle,
          backgroundColor: disabled ? '#f4f5f7' : '#fff',
          color: disabled ? '#6b778c' : '#172b4d',
        }}
      >
        <span>{getDashboardSelectionLabel(options, selectedValues, emptyLabel)}</span>
        <span aria-hidden="true">{openDashboardPicker === id ? '^' : 'v'}</span>
      </button>
      {openDashboardPicker === id && !disabled && (
        <div style={pickerMenuStyle}>
          {options.filter(option => option.value).map(option => (
            <label key={option.value} style={pickerOptionStyle}>
              <input
                type="checkbox"
                checked={selectedValues.includes(option.value)}
                onChange={() => toggleDashboardSelection(fieldName, promptFieldName, options, option.value)}
              />
              <span style={{ flex: 1 }}>{option.label}</span>
              <span
                title={option.prompt}
                aria-label={`Information about ${option.label}`}
                style={infoIconStyle}
                onClick={(event) => event.preventDefault()}
              >
                i
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );

  const renderItsmCountField = (name, label, min = 0) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="number"
        name={name}
        min={String(min)}
        max="60"
        value={form[name]}
        onChange={handleChange}
        style={inputStyle}
      />
    </div>
  );

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>
          <h1 style={titleStyle}>Jira Instance - Demo Data Setup</h1>
          <p style={{ ...subtitleStyle, fontStyle: 'italic' }}>Create the demo environment in minutes</p>
        </div>
        <div style={{ ...fieldStyle, display: 'grid', gridTemplateColumns: form.industry === 'Other' ? 'repeat(3, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))', gap: '16px', alignItems: 'end' }}>
          <div>
            <label style={labelStyle}>Client Name</label>
            <input
              type="text"
              name="environmentName"
              value={form.environmentName}
              onChange={handleChange}
              placeholder="e.g., Acme Hospital"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>
              Business Domain
              <span
                title="The selected business domain determines the type of project data, ticket summaries, workflows, dashboards, and reports generated."
                aria-label="Business domain information"
                style={{ ...infoIconStyle, marginLeft: '8px', width: '14px', height: '14px', fontSize: '10px', lineHeight: '14px' }}
              >
                i
              </span>
            </label>
            <select
              name="industry"
              value={form.industry}
              onChange={handleChange}
              style={selectStyle}
            >
              <option value="">Select Domain</option>
              {industries.map(ind => (
                <option key={ind} value={ind}>{ind}</option>
              ))}
              <option value="Other">Others</option>
            </select>
          </div>
          {form.industry === 'Other' && (
            <div>
              <label style={labelStyle}>Custom Domain</label>
              <input
                type="text"
                name="customIndustry"
                value={form.customIndustry}
                onChange={handleChange}
                placeholder="Type the domain you want"
                style={inputStyle}
              />
            </div>
          )}
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>
            Ticket Data Duration
            <span
              title="The selected duration determines how ticket creation, resolution, trends, and SLA metrics are distributed across weeks/months."
              aria-label="Ticket data duration information"
              style={{ ...infoIconStyle, marginLeft: '8px', width: '14px', height: '14px', fontSize: '10px', lineHeight: '14px' }}
            >
              i
            </span>
          </label>
          <select
            name="dateRange"
            value={form.dateRange}
            onChange={handleChange}
            style={{ ...selectStyle, maxWidth: '220px' }}
          >
            <option value="3 months">3 months</option>
            <option value="6 months">6 months</option>
            <option value="12 months">12 months</option>
          </select>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Jira Service Management (ITSM)</div>
          <div style={{ marginBottom: selectedJsmProjectCount > 0 ? '12px' : 0 }}>
            <button type="button" onClick={addJsmProject} disabled={selectedJsmProjectCount >= 10} style={{ ...buttonStyle, width: '220px', padding: '10px 18px', fontSize: '14px', whiteSpace: 'nowrap' }}>
              Add Project
            </button>
          </div>
          {Array.from({ length: selectedJsmProjectCount }).map((_, index) => (
            <div key={`jsm-project-${index}`} style={projectCardStyle}>
              <div style={jsmProjectRowStyle}>
                <div style={{ fontWeight: 600, color: '#172b4d', paddingBottom: '10px', whiteSpace: 'nowrap' }}>
                  JSM Project {index + 1}
                </div>
                {renderItsmCountField('incidentRequestsPerProject', 'Incidents', 1)}
                {renderItsmCountField('serviceRequestsPerProject', 'Service Requests', 1)}
                {renderItsmCountField('changeRequestsPerProject', 'Changes', 1)}
                {renderItsmCountField('problemRequestsPerProject', 'Problems', 1)}
                <button type="button" onClick={removeJsmProject} style={removeButtonStyle}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          {selectedJsmProjectCount > 0 && (
            <div style={{ ...optionalSectionStyle, marginTop: '16px', marginBottom: 0 }}>
              <div style={{ ...fieldStyle, marginBottom: 0 }}>
                <label style={labelStyle}>Dashboard - Ops / Service Management</label>
                {renderDashboardMultiDropdown({
                  id: 'ops',
                  options: opsDashboardOptions,
                  selectedValues: form.opsDashboardTypes,
                  fieldName: 'opsDashboardTypes',
                  promptFieldName: 'opsDashboardPrompt',
                  emptyLabel: 'Choose service management dashboards',
                })}
              </div>
            </div>
          )}
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Jira Software (Dev)</div>
          <div style={{ marginBottom: '12px' }}>
            <button type="button" onClick={addSoftwareProject} disabled={selectedSoftwareProjectCount >= 10} style={{ ...buttonStyle, width: '220px', padding: '10px 18px', fontSize: '14px', whiteSpace: 'nowrap' }}>
              Add Project
            </button>
          </div>
          {form.softwareProjects.map((project, index) => (
            <div key={`software-project-${index}`} style={projectCardStyle}>
              <div style={softwareProjectRowStyle}>
                <div style={{ fontWeight: 600, color: '#172b4d', paddingBottom: '10px', whiteSpace: 'nowrap' }}>
                  Software Project {index + 1}
                </div>
                <div>
                  <label style={labelStyle}>Project Template</label>
                  <select
                    value={project.softwareTemplate}
                    onChange={(event) => updateSoftwareProject(index, 'softwareTemplate', event.target.value)}
                    style={selectStyle}
                  >
                    <option value="">Select template</option>
                    <option value="scrum">Scrum</option>
                    <option value="kanban">Kanban</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Management</label>
                  <select
                    value={project.softwareProjectStyle}
                    onChange={(event) => updateSoftwareProject(index, 'softwareProjectStyle', event.target.value)}
                    style={selectStyle}
                  >
                    <option value="">Select management</option>
                    <option value="team-managed">Team-managed</option>
                    <option value="company-managed">Company-managed</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Issues</label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={project.issuesPerProject}
                    onChange={(event) => updateSoftwareProject(index, 'issuesPerProject', event.target.value)}
                    style={inputStyle}
                  />
                </div>
                <button type="button" onClick={() => removeSoftwareProject(index)} style={removeButtonStyle}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          {selectedSoftwareProjectCount > 0 && (
            <div style={{ ...optionalSectionStyle, marginTop: '16px', marginBottom: 0 }}>
              <div style={{ ...fieldStyle, marginBottom: 0 }}>
                <label style={labelStyle}>Dashboard - Software</label>
                {renderDashboardMultiDropdown({
                  id: 'software',
                  options: softwareDashboardOptions,
                  selectedValues: form.softwareDashboardTypes,
                  fieldName: 'softwareDashboardTypes',
                  promptFieldName: 'softwareDashboardPrompt',
                  emptyLabel: 'Choose software dashboards',
                })}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading}
          style={buttonStyle}
          onMouseOver={(e) => { if (!loading) e.target.style.backgroundColor = '#0065ff'; }}
          onMouseOut={(e) => { e.target.style.backgroundColor = '#0052cc'; }}
        >
          {loading ? 'Creating Demo Environment...' : 'CREATE DEMO ENVIRONMENT'}
        </button>

        {progress && <div style={progressStyle}>{progress}</div>}

        {result && <div style={resultStyle}>{result}</div>}
      </div>
    </div>
  );
}

export default App;
