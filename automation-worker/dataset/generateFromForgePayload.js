import { getDomainContent, buildDomainDescription } from './domainContent.js';
import { formatJiraDateTime, generateCreatedDate } from './generateDates.js';
import { buildReleaseVersions, selectVersionForTicket } from './releaseVersions.js';
import { generateResolutionDate, getSlaForTicket } from './slaRules.js';
import { generateTickets } from './generateTickets.js';
import { generateAiBlueprint } from './aiBlueprint.js';

function parseCount(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeDateRange(value) {
  const normalized = String(value || '6 months').toLowerCase().trim();

  if (normalized.includes('3')) return '3_months';
  if (normalized.includes('12') || normalized.includes('1_year') || normalized.includes('year')) return '1_year';
  return '6_months';
}

function normalizeIndustry(value) {
  return String(value || 'banking').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function makeProjectKey(prefix, index) {
  return `${prefix}${index + 1}`;
}

function appendLink(record, fieldName, issueKey) {
  if (!issueKey || record['Issue key'] === issueKey) return;
  const existing = String(record[fieldName] || '').split(' ').filter(Boolean);
  if (!existing.includes(issueKey)) {
    record[fieldName] = [...existing, issueKey].join(' ');
  }
}

function selectSoftwareBlueprintScenario(aiBlueprint, issueType, index) {
  const scenarios = Array.isArray(aiBlueprint?.softwareScenarios) ? aiBlueprint.softwareScenarios : [];
  const matching = scenarios.filter(scenario => scenario.issueType === issueType);
  const pool = matching.length ? matching : scenarios;
  return pool.length ? pool[index % pool.length] : null;
}

function createSoftwareIssue({ projectKey, projectName, index, issueType, industry, dateRange, versions, aiBlueprint }) {
  const domain = getDomainContent(industry);
  const blueprintScenario = selectSoftwareBlueprintScenario(aiBlueprint, issueType, index);
  const component = blueprintScenario?.component || domain.components[index % domain.components.length];
  const team = blueprintScenario?.team || domain.teams[index % domain.teams.length];
  const version = selectVersionForTicket(versions, index, issueType);
  const priority = blueprintScenario?.priority || (issueType === 'Bug'
    ? ['P1', 'P2', 'P3', 'P3'][index % 4]
    : ['P2', 'P3', 'P3', 'P4'][index % 4]);
  const createdDate = generateCreatedDate(issueType === 'Bug' ? 'Incident' : 'Change', dateRange);
  const status = ['Done', 'In Progress', 'To Do', 'Done'][index % 4];
  const resolvedDate = status === 'Done'
    ? generateResolutionDate(createdDate, getSlaForTicket(issueType === 'Bug' ? 'Incident' : 'Change', priority))
    : null;
  const service = blueprintScenario?.service || domain.services[index % domain.services.length];
  const summaryPrefix = {
    Epic: `Modernize ${service} capability`,
    Story: `Build ${service} workflow enhancement`,
    Bug: `Fix ${service} production defect`,
    Task: `Configure ${service} delivery task`,
  }[issueType] || `Deliver ${service} work`;
  const summary = blueprintScenario?.summary || summaryPrefix;

  return {
    'Issue key': `${projectKey}-${index + 1}`,
    'Issue id': `${projectKey}-${index + 1}`,
    'Project key': projectKey,
    'Project name': projectName || projectKey,
    'Project type': 'software',
    Summary: `${summary} #${index + 1}`,
    'Issue Type': issueType,
    Priority: priority,
    Status: status,
    Created: formatJiraDateTime(createdDate),
    Resolved: resolvedDate ? formatJiraDateTime(resolvedDate) : '',
    'Fix Version/s': ['Story', 'Bug', 'Task'].includes(issueType) ? version?.name || '' : '',
    'Affects Version/s': issueType === 'Bug' ? version?.name || '' : '',
    'Component/s': component,
    Team: team,
    Causes: '',
    Relates: '',
    Blocks: '',
    Description: blueprintScenario?.description || buildDomainDescription({
      issueType,
      industry,
      component,
      team,
      versionName: version?.name,
    }),
    Labels: `demo-data,historical-import,software,${normalizeIndustry(industry)}`,
  };
}

function generateSoftwareProjectDataset({ projectKey, projectConfig, industry, dateRange, aiBlueprint }) {
  const issueCount = parseCount(projectConfig.issuesPerProject, 10);
  const projectName = projectConfig.projectName || projectKey;
  const versions = buildReleaseVersions({ projectKey, dateRange });
  const issueTypes = ['Epic', 'Story', 'Bug', 'Task'];
  const tickets = Array.from({ length: issueCount }, (_, index) => {
    const issueType = index < Math.max(1, Math.ceil(issueCount / 10))
      ? 'Epic'
      : issueTypes[(index % (issueTypes.length - 1)) + 1];
    const record = createSoftwareIssue({
      projectKey,
      projectName,
      index,
      issueType,
      industry,
      dateRange,
      versions,
      aiBlueprint,
    });
    versions[index % versions.length].issueKeys.push(record['Issue key']);
    return record;
  });

  const epics = tickets.filter(ticket => ticket['Issue Type'] === 'Epic');
  const nonEpics = tickets.filter(ticket => ticket['Issue Type'] !== 'Epic');
  nonEpics.forEach((ticket, index) => {
    appendLink(ticket, 'Relates', epics[index % epics.length]?.['Issue key']);
    if (ticket['Issue Type'] === 'Bug') {
      appendLink(ticket, 'Blocks', nonEpics[(index + 1) % nonEpics.length]?.['Issue key']);
    }
  });

  return {
    tickets,
    releaseVersions: versions,
    summary: {
      projectKey,
      projectName,
      kind: 'software',
      template: projectConfig.softwareTemplate || 'scrum',
      management: projectConfig.softwareProjectStyle || 'team-managed',
      issueCount,
    },
  };
}

export async function generateFromForgePayload(payload = {}) {
  const industry = normalizeIndustry(payload.industry || payload.customIndustry);
  const dateRange = normalizeDateRange(payload.dateRange);
  const jsmProjectCount = parseCount(payload.jsmProjectCount, 0);
  const softwareProjects = Array.isArray(payload.softwareProjects) ? payload.softwareProjects : [];
  const aiResult = await generateAiBlueprint({
    ...payload,
    industry,
    dateRange,
  });
  const aiBlueprint = aiResult.blueprint;
  const tickets = [];
  const releaseVersions = [];
  const summaries = [];

  for (let index = 0; index < jsmProjectCount; index += 1) {
    const projectKey = payload.jsmProjects?.[index]?.projectKey || makeProjectKey('JSM', index);
    const projectName = payload.jsmProjects?.[index]?.projectName || projectKey;
    const incidents = parseCount(payload.incidentRequestsPerProject, 0);
    const serviceRequests = parseCount(payload.serviceRequestsPerProject, 0);
    const changes = parseCount(payload.changeRequestsPerProject, 0);
    const problems = parseCount(payload.problemRequestsPerProject, 0);
    const total = incidents + serviceRequests + changes + problems;

    if (total === 0) continue;

    const generated = generateTickets({
      project: projectKey,
      projectName,
      projectType: 'service_desk',
      ticketCount: total,
      dateRange,
      industry,
      incidentRatio: incidents,
      serviceRequestRatio: serviceRequests,
      changeRatio: changes,
      problemRatio: problems,
    }, { aiBlueprint });

    tickets.push(...generated.tickets);
    releaseVersions.push(...generated.releaseVersions);
    summaries.push({
      projectKey,
      projectName,
      kind: 'jsm',
      incidents,
      serviceRequests,
      changes,
      problems,
      ticketCount: generated.tickets.length,
    });
  }

  softwareProjects.forEach((projectConfig, index) => {
    const projectKey = projectConfig.projectKey || makeProjectKey('SW', index);
    const generated = generateSoftwareProjectDataset({
      projectKey,
      projectConfig,
      industry,
      dateRange,
      aiBlueprint,
    });
    tickets.push(...generated.tickets);
    releaseVersions.push(...generated.releaseVersions);
    summaries.push(generated.summary);
  });

  return {
    tickets,
    releaseVersions,
    metadata: {
      environmentName: payload.environmentName || '',
      industry,
      dateRange,
      dashboards: {
        itsm: payload.opsDashboardTypes || [],
        software: payload.softwareDashboardTypes || [],
      },
      projects: summaries,
      aiBlueprint: {
        source: aiResult.source,
        enabled: aiResult.enabled,
        model: aiResult.model || null,
        reason: aiResult.reason || null,
        jsmScenarioCount: aiBlueprint?.jsmScenarios?.length || 0,
        softwareScenarioCount: aiBlueprint?.softwareScenarios?.length || 0,
        dashboardInsightCount: aiBlueprint?.dashboardInsights?.length || 0,
      },
    },
  };
}
