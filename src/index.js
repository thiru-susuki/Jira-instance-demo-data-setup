import Resolver from '@forge/resolver';
import api, { assumeTrustedRoute, fetch as forgeFetch, route } from '@forge/api';
import {
  buildRealisticAssigneeIndex,
  createLifecycleForIssue,
  createTicketProperty,
} from './demoDataGenerator';
import {
  buildDynamicJsmFormDesign,
  buildFormsApiPayload,
} from './formGenerationEngine';
import { buildAutomationBlueprints } from './automationBlueprintEngine';
import {
  inferDashboardIntent,
  orderDashboardGadgetPlans,
} from './dashboardAiEngine';
import {
  ARCHIVE_RETENTION_DAYS,
  TICKET_RETENTION_PROPERTY,
} from './retentionManagementService';

const resolver = new Resolver();
const projectIssueTypeCache = new Map();
const assignableUsersByProjectCache = new Map();
const demoDateFieldsByProjectCache = new Map();
let demoDateFieldIdsCache = null;
let formsDynamicSchemaRejected = false;
const ACTIVE_TICKET_RETENTION_DAYS = 180;
const WORKER_GENERATION_ENDPOINT = process.env.WORKER_GENERATION_ENDPOINT || 'http://localhost:4000/generate-demo';
const WORKER_DATE_PATCH_ENDPOINT = process.env.WORKER_DATE_PATCH_ENDPOINT
  || WORKER_GENERATION_ENDPOINT.replace(/\/generate-demo\/?$/, '/generate-date-patch');
const ISSUE_CREATION_MODE = process.env.ISSUE_CREATION_MODE || 'rest';
const WORKER_FETCH_TIMEOUT_MS = 10000;
const DASHBOARD_TEMPLATE_IDS = ['10000', '10671'];
const MANAGED_DASHBOARD_GADGET_SLOT_COUNT = 6;
const DEMO_DATE_FIELD_DEFINITIONS = {
  created: {
    name: 'Created Date',
    description: 'Demo environment generated created date field.',
  },
  resolved: {
    name: 'Resolved Date',
    description: 'Demo environment generated resolved date field.',
  },
};
const MANAGED_DASHBOARD_GADGET_PLANS = [
  {
    role: 'forge-environment',
    title: 'Demo Environment',
    keywords: ['cprime demo gadget'],
    required: true,
    allowDuplicate: true,
  },
  {
    role: 'forge-open-work',
    titleSuffix: 'Open Work',
    keywords: ['cprime demo gadget'],
    required: true,
    allowDuplicate: true,
  },
  {
    role: 'forge-status',
    title: 'Work by Status',
    keywords: ['cprime demo gadget'],
    required: true,
    allowDuplicate: true,
  },
  {
    role: 'forge-priority',
    title: 'Work by Priority',
    keywords: ['cprime demo gadget'],
    required: true,
    allowDuplicate: true,
  },
  {
    role: 'forge-overdue',
    title: 'Overdue Work Per Project',
    keywords: ['cprime demo gadget'],
    required: true,
    allowDuplicate: true,
  },
  {
    role: 'forge-sprint-health',
    title: 'Sprint Health',
    keywords: ['cprime demo gadget'],
    required: true,
    allowDuplicate: true,
  },
  {
    role: 'forge-sprint-burndown',
    title: 'Sprint Burndown',
    keywords: ['cprime demo gadget'],
    required: true,
    allowDuplicate: true,
  },
  {
    role: 'forge-roadmap',
    title: 'Jira Roadmap: Next 30 Days',
    keywords: ['cprime demo gadget'],
    required: true,
    allowDuplicate: true,
  },
  {
    role: 'forge-average-time-status',
    title: 'Average Time in Status',
    keywords: ['cprime demo gadget'],
    required: true,
    allowDuplicate: true,
  },
  {
    role: 'forge-ticket-aging',
    title: 'Ticket Aging',
    keywords: ['cprime demo gadget'],
    required: true,
    allowDuplicate: true,
  },
  {
    role: 'forge-escalations',
    title: 'SLA & Escalation Risk',
    keywords: ['cprime demo gadget'],
    required: true,
    allowDuplicate: true,
  },
  {
    role: 'forge-reports',
    title: 'Reports & Knowledge Links',
    keywords: ['cprime demo gadget'],
    required: true,
    allowDuplicate: true,
  },
  {
    role: 'forge-created-resolved',
    title: 'Created vs Resolved',
    keywords: ['cprime demo gadget'],
    required: true,
    allowDuplicate: true,
  },
  {
    role: 'forge-projects',
    title: 'Demo Projects',
    keywords: ['cprime demo gadget'],
    required: true,
    allowDuplicate: true,
  },
  {
    role: 'activity',
    title: 'Activity Stream',
    moduleKeys: ['com.atlassian.streams.streams-jira-plugin:activitystream-gadget'],
    keywords: ['activity'],
    required: false,
  },
  {
    role: 'pie-chart-assignee',
    title: 'Work by Assignee',
    moduleKeys: ['com.atlassian.jira.gadgets:pie-chart-gadget'],
    keywords: ['pie chart'],
    required: false,
    disabled: true,
    allowDuplicate: true,
  },
  {
    role: 'created-vs-resolved',
    title: 'Created vs Resolved',
    moduleKeys: ['com.atlassian.jira.gadgets:created-vs-resolved-chart-gadget'],
    keywords: ['created vs resolved', 'created resolved', 'created'],
    required: false,
    disabled: true,
  },
  {
    role: 'average-age',
    title: 'Average Age',
    moduleKeys: ['com.atlassian.jira.gadgets:average-age-chart-gadget'],
    keywords: ['average age', 'average'],
    required: false,
    disabled: true,
  },
  {
    role: 'recently-created',
    title: 'Recently Created',
    moduleKeys: ['com.atlassian.jira.gadgets:recently-created-chart-gadget'],
    keywords: ['recently created', 'created'],
    required: false,
    disabled: true,
  },
];

// ── HELPERS ──────────────────────────────────────────────────────────────────

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getDateString(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split('T')[0];
}

function getStatusFromDueDate(dueDateStr) {
  const today = new Date();
  const dueDate = new Date(dueDateStr);
  const diffDays = Math.floor((dueDate - today) / (1000 * 60 * 60 * 24));
  if (diffDays < -30) return 'Done';
  if (diffDays < 0) return 'In Progress';
  if (diffDays < 30) return 'In Progress';
  return 'To Do';
}

function getDemoDevStatus(index) {
  return ['To Do', 'In Progress', 'Done'][index % 3];
}

function getWaterfallPhase(index) {
  return ['requirements', 'design', 'build', 'test', 'release'][index % 5];
}

function getSoftwareMethodologyLabels(project, issueIndex, issueType) {
  const template = normaliseSoftwareTemplate(project?.softwareTemplate);
  const style = normaliseProjectManagementStyle(project?.softwareProjectStyle);
  const phase = getWaterfallPhase(issueIndex);
  const baseLabels = [
    'demo-data',
    `methodology-${template}`,
    `management-${style}`,
    `waterfall-${phase}`,
  ];

  if (template === 'scrum') {
    baseLabels.push('agile-scrum', 'sprint-planning', 'velocity-tracking');
  } else {
    baseLabels.push('agile-kanban', 'continuous-flow', 'wip-tracking');
  }

  if (String(issueType || '').toLowerCase() === 'bug') {
    baseLabels.push('defect-management', 'affected-version');
  } else {
    baseLabels.push('release-scope', 'fix-version');
  }

  return baseLabels.map(label => label.replace(/[^A-Za-z0-9_-]/g, '-').toLowerCase());
}

function getSoftwareMethodologyDescription(project, issueIndex) {
  const template = normaliseSoftwareTemplate(project?.softwareTemplate);
  const phase = getWaterfallPhase(issueIndex);
  const agileMethod = template === 'scrum'
    ? 'Scrum delivery: backlog refinement, sprint planning, sprint execution, review, and retrospective.'
    : 'Kanban delivery: continuous intake, WIP control, flow monitoring, cycle time, and throughput tracking.';

  return [
    agileMethod,
    `Waterfall traceability overlay: this work is tagged to the ${phase} phase so the demo can show requirements-to-release governance alongside agile execution.`,
    'Release governance: fix versions, affected versions, dependencies, due dates, and sprint or flow state are populated for dashboard and report visibility.',
  ].join(' ');
}

function getSoftwareReleasePlan(project, releaseIndex) {
  const template = normaliseSoftwareTemplate(project?.softwareTemplate);
  const offsets = [-150, -90, -30, 14, 45, 90];
  const stage = releaseIndex <= 1
    ? 'past'
    : releaseIndex === 2
      ? 'current'
      : 'upcoming';
  const versionNumber = `${Math.floor(releaseIndex / 2) + 1}.${releaseIndex % 2}`;
  const releaseDate = getDateString(offsets[releaseIndex] ?? (30 + (releaseIndex * 30)));
  const label = stage === 'past'
    ? 'Past Release'
    : stage === 'current'
      ? 'Current Release'
      : 'Upcoming Release';

  return {
    name: `${project.key} ${label} ${versionNumber}`,
    releaseDate,
    released: stage === 'past',
    stage,
    methodology: template === 'scrum' ? 'Scrum release train' : 'Kanban flow release',
  };
}

function chooseReleaseVersionIds(project, issueIndex, issueType) {
  const versions = project?.versions || [];
  if (versions.length === 0) {
    return {
      fixVersionId: null,
      affectsVersionId: null,
    };
  }

  const pastVersions = versions.filter(version => version.releaseStage === 'past');
  const currentVersions = versions.filter(version => version.releaseStage === 'current');
  const upcomingVersions = versions.filter(version => version.releaseStage === 'upcoming');
  const isBug = String(issueType || '').toLowerCase() === 'bug';
  const fixPool = isBug
    ? [...currentVersions, ...upcomingVersions, ...versions]
    : [...upcomingVersions, ...currentVersions, ...versions];
  const affectedPool = isBug
    ? [...pastVersions, ...currentVersions, ...versions]
    : [...currentVersions, ...pastVersions, ...versions];

  return {
    fixVersionId: fixPool[issueIndex % fixPool.length]?.id || null,
    affectsVersionId: affectedPool[issueIndex % affectedPool.length]?.id || null,
  };
}

function getPriorityName(p) {
  return { 'P1 - Critical': 'Highest', 'P2 - High': 'High', 'P3 - Medium': 'Medium', 'P4 - Low': 'Lowest' }[p] || 'Medium';
}

function buildADF(paragraphs) {
  return {
    version: 1, type: 'doc',
    content: paragraphs.map(text => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  };
}

function generateKey(prefix, index) {
  const base = prefix.toUpperCase().replace(/[^A-Z]/g, '').substring(0, 8).padEnd(3, 'X') || 'DEM';
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  if (index === 0) {
    return base;
  }

  const fallbackLetters = letters.split('').filter(letter => letter !== base[base.length - 1]);
  return `${base.substring(0, Math.max(2, base.length - 1))}${fallbackLetters[(index - 1) % fallbackLetters.length] || 'Z'}`;
}

function deriveProjectKeyPrefix(environmentName, fallback = 'DEM') {
  const words = String(environmentName || '')
    .toUpperCase()
    .match(/[A-Z0-9]+/g) || [];

  if (words.length >= 3) {
    return words.slice(0, 3).map(word => word[0]).join('');
  }

  return (words.join('') || fallback).replace(/[^A-Z]/g, '').substring(0, 3).padEnd(3, 'X');
}

function createRunKeySuffix(seed) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const number = Math.abs(Number(seed) || Date.now());
  return `${letters[number % 26]}${letters[Math.floor(number / 26) % 26]}`;
}

function deriveRunProjectKeyPrefix(config, fallback = 'DEM', projectIndex = 0) {
  const base = deriveProjectKeyPrefix(config.environmentName, fallback).substring(0, 3);
  const suffix = createRunKeySuffix(config.runSeed);
  const indexLetter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[projectIndex % 26] || 'A';
  return `${base}${suffix}${indexLetter}`;
}

function pad(num) {
  return num > 9 ? String(num) : '0' + num;
}

function formatDateForJira(dateStr) {
  return dateStr + 'T00:00:00.000Z';
}

function createShiftedDate(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date;
}

function normaliseStatusName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createRunLabel(date = new Date()) {
  // Dashboard and filter names need a run-specific label because demo users often
  // create several environments with the same customer name while rehearsing.
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// ── INDUSTRY CONTENT ──────────────────────────────────────────────────────────

function toTitleCase(value) {
  return String(value || 'Business')
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ') || 'Business';
}

function buildDomainTerms(industry) {
  const label = toTitleCase(industry);
  const normalised = label.toLowerCase();
  const termMap = {
    banking: ['core banking', 'payments', 'customer onboarding', 'fraud monitoring', 'regulatory reporting'],
    healthcare: ['patient records', 'clinical workflow', 'lab integration', 'telehealth', 'pharmacy operations'],
    retail: ['checkout', 'inventory', 'order fulfilment', 'loyalty platform', 'returns processing'],
    insurance: ['policy administration', 'claims intake', 'underwriting', 'premium billing', 'agent portal'],
    telecom: ['network provisioning', 'subscriber billing', 'service activation', 'outage monitoring', 'field operations'],
    'e commerce': ['cart checkout', 'catalog search', 'seller onboarding', 'warehouse fulfilment', 'payment capture'],
    ecommerce: ['cart checkout', 'catalog search', 'seller onboarding', 'warehouse fulfilment', 'payment capture'],
    saas: ['tenant provisioning', 'authentication', 'subscription billing', 'API gateway', 'usage analytics'],
    manufacturing: ['production line', 'quality inspection', 'supplier integration', 'inventory planning', 'maintenance alerts'],
  };
  const terms = termMap[normalised] || [
    `${normalised} operations`,
    `${normalised} customer workflow`,
    `${normalised} reporting`,
    `${normalised} integration`,
    `${normalised} service portal`,
  ];

  return {
    label,
    terms: terms.map(term => toTitleCase(term)),
  };
}

function createTemplateItem(title, priority = 'P3 - Medium', description = '') {
  return { title, priority, description };
}

function buildDynamicDomainContent(industry) {
  const { label, terms } = buildDomainTerms(industry);
  const priorities = ['P1 - Critical', 'P2 - High', 'P3 - Medium', 'P3 - Medium', 'P4 - Low'];
  const incidents = terms.flatMap((term, index) => ([
    createTemplateItem(`${term} outage affecting ${label.toLowerCase()} users`, priorities[index % priorities.length], `Investigate and restore the ${term.toLowerCase()} service for the ${label.toLowerCase()} demo environment.`),
    createTemplateItem(`${term} performance degradation during peak processing`, priorities[(index + 1) % priorities.length], `Triage latency, impact, and customer-facing symptoms for ${term.toLowerCase()}.`),
  ]));
  const serviceRequests = terms.flatMap((term, index) => ([
    createTemplateItem(`Provision access to ${term.toLowerCase()} workspace`, index % 2 === 0 ? 'P3 - Medium' : 'P4 - Low', `Fulfil a standard access request for ${term.toLowerCase()} with approval and handoff notes.`),
    createTemplateItem(`Create standard ${term.toLowerCase()} reporting view`, 'P3 - Medium', `Set up a reusable reporting view for the ${label.toLowerCase()} operations team.`),
  ]));
  const changes = terms.flatMap((term, index) => ([
    createTemplateItem(`Deploy ${term.toLowerCase()} reliability improvement`, index % 3 === 0 ? 'P2 - High' : 'P3 - Medium', `Plan, approve, and deploy a controlled change for ${term.toLowerCase()} reliability.`),
    createTemplateItem(`Update ${term.toLowerCase()} integration configuration`, 'P3 - Medium', `Coordinate validation, implementation window, and rollback for a ${term.toLowerCase()} configuration update.`),
  ]));
  const problems = terms.flatMap((term, index) => ([
    createTemplateItem(`Investigate recurring ${term.toLowerCase()} instability`, index % 2 === 0 ? 'P2 - High' : 'P3 - Medium', `Find root cause, known error, and permanent corrective action for recurring ${term.toLowerCase()} incidents.`),
    createTemplateItem(`Root cause analysis for ${term.toLowerCase()} data inconsistency`, 'P3 - Medium', `Analyse repeat symptoms, impacted services, and prevention steps for ${term.toLowerCase()}.`),
  ]));
  const issues = terms.flatMap((term, index) => ([
    { title: `Build ${term.toLowerCase()} workflow automation`, type: 'Story' },
    { title: `Design ${term.toLowerCase()} operational dashboard`, type: 'Task' },
    { title: `Fix ${term.toLowerCase()} validation defect`, type: 'Bug' },
    { title: `Implement ${term.toLowerCase()} audit trail`, type: index % 2 === 0 ? 'Story' : 'Task' },
  ]));

  return {
    incidents,
    serviceRequests,
    changes,
    problems,
    epics: [`${label} Operations Modernization`, `${label} Customer Experience`, `${label} Platform Reliability`, `${label} Compliance and Reporting`],
    issues,
  };
}

function buildRequestTypeTemplates(content, industry, workType) {
  const { label, terms } = buildDomainTerms(industry);
  const sourceIssues = Array.isArray(content.issues) ? content.issues : [];
  const sourceIncidents = Array.isArray(content.incidents) ? content.incidents : [];
  const priorities = ['P2 - High', 'P3 - Medium', 'P4 - Low', 'P3 - Medium'];
  const titleBuilders = {
    'Service Request': term => `Standard access and support request for ${term.toLowerCase()}`,
    Change: term => `Production change for ${term.toLowerCase()} reliability improvement`,
    Problem: term => `Recurring ${term.toLowerCase()} instability root cause analysis`,
    Incident: term => `${term} service interruption impacting ${label.toLowerCase()} operations`,
  };
  const descriptionBuilders = {
    'Service Request': term => `Fulfil a standard service request for ${term.toLowerCase()} with approvals, ownership, and completion evidence.`,
    Change: term => `Assess, schedule, approve, deploy, and validate a controlled change for ${term.toLowerCase()}.`,
    Problem: term => `Investigate recurring symptoms, document root cause, define known error, and track permanent fix for ${term.toLowerCase()}.`,
    Incident: term => `Restore service for ${term.toLowerCase()}, capture impact, urgency, escalation owner, and customer communication.`,
  };
  const templates = terms.map((term, index) => createTemplateItem(titleBuilders[workType](term), priorities[index % priorities.length], descriptionBuilders[workType](term)));

  sourceIssues.slice(0, 10).forEach((issue, index) => {
    const issueTitle = String(issue.title || `${label} work item`).replace(/^Build\s+/i, '').replace(/^Implement\s+/i, '');
    templates.push(createTemplateItem(
      `${workType} follow-up for ${issueTitle.charAt(0).toLowerCase()}${issueTitle.slice(1)}`,
      priorities[(index + 1) % priorities.length],
      `${workType} record generated from ${label.toLowerCase()} delivery context: ${issueTitle}.`
    ));
  });

  sourceIncidents.slice(0, 5).forEach((incident, index) => {
    templates.push(createTemplateItem(
      `${workType} linked to ${String(incident.title || '').toLowerCase()}`,
      priorities[(index + 2) % priorities.length],
      `${workType} item derived from operational impact: ${incident.title}.`
    ));
  });

  return templates;
}

function ensureDomainContentCompleteness(content, industry) {
  const completeContent = {
    ...buildDynamicDomainContent(industry),
    ...content,
  };

  return {
    ...completeContent,
    incidents: Array.isArray(completeContent.incidents) && completeContent.incidents.length > 0 ? completeContent.incidents : buildRequestTypeTemplates(completeContent, industry, 'Incident'),
    serviceRequests: Array.isArray(completeContent.serviceRequests) && completeContent.serviceRequests.length > 0 ? completeContent.serviceRequests : buildRequestTypeTemplates(completeContent, industry, 'Service Request'),
    changes: Array.isArray(completeContent.changes) && completeContent.changes.length > 0 ? completeContent.changes : buildRequestTypeTemplates(completeContent, industry, 'Change'),
    problems: Array.isArray(completeContent.problems) && completeContent.problems.length > 0 ? completeContent.problems : buildRequestTypeTemplates(completeContent, industry, 'Problem'),
  };
}

function normaliseAiGeneratedContent(rawContent, industry) {
  if (!rawContent || typeof rawContent !== 'object') {
    return null;
  }

  const fallback = buildDynamicDomainContent(industry);
  const seenTitlesByList = new Map();
  const makeUniqueTitle = (listName, title, index) => {
    const cleanedTitle = String(title || `${toTitleCase(industry)} work item`).replace(/\s+/g, ' ').trim();
    const seenTitles = seenTitlesByList.get(listName) || new Set();
    const lowerTitle = cleanedTitle.toLowerCase();

    if (!seenTitles.has(lowerTitle)) {
      seenTitles.add(lowerTitle);
      seenTitlesByList.set(listName, seenTitles);
      return cleanedTitle;
    }

    const uniqueTitle = `${cleanedTitle} (${toTitleCase(industry)} scenario ${index + 1})`;
    seenTitles.add(uniqueTitle.toLowerCase());
    seenTitlesByList.set(listName, seenTitles);
    return uniqueTitle;
  };
  const normaliseItems = (items, fallbackItems, defaultType = null) => {
    const source = Array.isArray(items) && items.length > 0 ? items : fallbackItems;
    return source
      .filter(Boolean)
      .map((item, index) => ({
        title: makeUniqueTitle(defaultType || 'itsm', item.title || item.summary || fallbackItems[index % fallbackItems.length]?.title, index).slice(0, 180),
        priority: String(item.priority || fallbackItems[index % fallbackItems.length]?.priority || 'P3 - Medium'),
        description: String(item.description || fallbackItems[index % fallbackItems.length]?.description || '').slice(0, 1200),
        ...(defaultType ? { type: String(item.type || defaultType) } : {}),
      }));
  };

  const content = {
    incidents: normaliseItems(rawContent.incidents, fallback.incidents),
    serviceRequests: normaliseItems(rawContent.serviceRequests, fallback.serviceRequests),
    changes: normaliseItems(rawContent.changes, fallback.changes),
    problems: normaliseItems(rawContent.problems, fallback.problems),
    epics: Array.isArray(rawContent.epics) && rawContent.epics.length > 0
      ? rawContent.epics.map(epic => String(epic).slice(0, 80))
      : fallback.epics,
    issues: normaliseItems(rawContent.issues, fallback.issues, 'Story').map((item, index) => ({
      title: item.title,
      type: ['Story', 'Task', 'Bug'].includes(item.type) ? item.type : fallback.issues[index % fallback.issues.length]?.type || 'Story',
      description: item.description,
    })),
    requestTypes: Array.isArray(rawContent.requestTypes) ? rawContent.requestTypes.slice(0, 12) : [],
    workflows: rawContent.workflows && typeof rawContent.workflows === 'object' ? rawContent.workflows : {},
    dashboards: Array.isArray(rawContent.dashboards) ? rawContent.dashboards.slice(0, 8) : [],
    reports: Array.isArray(rawContent.reports) ? rawContent.reports.slice(0, 8) : [],
    slaPatterns: Array.isArray(rawContent.slaPatterns) ? rawContent.slaPatterns.slice(0, 8) : [],
    trendsAndMetrics: Array.isArray(rawContent.trendsAndMetrics) ? rawContent.trendsAndMetrics.slice(0, 12) : [],
  };

  return ensureDomainContentCompleteness(content, industry);
}

function extractOpenAiText(responseJson) {
  if (typeof responseJson?.output_text === 'string') {
    return responseJson.output_text;
  }

  const textParts = [];
  for (const output of responseJson?.output || []) {
    for (const content of output?.content || []) {
      if (typeof content?.text === 'string') {
        textParts.push(content.text);
      }
    }
  }

  return textParts.join('\n').trim();
}

async function generateAiDemoContent(config) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const openAiTimeoutMs = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || '12000', 10);
  const requestedCounts = {
    incidents: config.itsmWorkCounts?.incidentRequestsPerProject || 1,
    serviceRequests: config.itsmWorkCounts?.serviceRequestsPerProject || 1,
    changes: config.itsmWorkCounts?.changeRequestsPerProject || 1,
    problems: config.itsmWorkCounts?.problemRequestsPerProject || 1,
    softwareIssues: Math.max(...(config.softwareProjects || []).map(project => project.issuesPerProject || 0), config.issuesPerProject || 10),
  };
  const boundedCounts = {
    incidents: Math.min(MAX_INCIDENTS_PER_PROJECT, Math.max(0, requestedCounts.incidents)),
    serviceRequests: Math.min(MAX_INCIDENTS_PER_PROJECT, Math.max(0, requestedCounts.serviceRequests)),
    changes: Math.min(MAX_INCIDENTS_PER_PROJECT, Math.max(0, requestedCounts.changes)),
    problems: Math.min(MAX_INCIDENTS_PER_PROJECT, Math.max(0, requestedCounts.problems)),
    softwareIssues: Math.min(MAX_ISSUES_PER_PROJECT, Math.max(1, requestedCounts.softwareIssues)),
  };
  const totalRequestedRecords = boundedCounts.incidents
    + boundedCounts.serviceRequests
    + boundedCounts.changes
    + boundedCounts.problems
    + boundedCounts.softwareIssues;
  const maxOutputTokens = Math.min(16000, Math.max(7000, totalRequestedRecords * 180));
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      incidents: { type: 'array', items: { $ref: '#/$defs/ticket' }, minItems: boundedCounts.incidents, maxItems: boundedCounts.incidents },
      serviceRequests: { type: 'array', items: { $ref: '#/$defs/ticket' }, minItems: boundedCounts.serviceRequests, maxItems: boundedCounts.serviceRequests },
      changes: { type: 'array', items: { $ref: '#/$defs/ticket' }, minItems: boundedCounts.changes, maxItems: boundedCounts.changes },
      problems: { type: 'array', items: { $ref: '#/$defs/ticket' }, minItems: boundedCounts.problems, maxItems: boundedCounts.problems },
      epics: { type: 'array', items: { type: 'string' }, minItems: 4 },
      issues: { type: 'array', items: { $ref: '#/$defs/softwareIssue' }, minItems: boundedCounts.softwareIssues, maxItems: boundedCounts.softwareIssues },
      requestTypes: { type: 'array', items: { $ref: '#/$defs/requestType' }, minItems: 4 },
      workflows: { $ref: '#/$defs/workflows' },
      dashboards: { type: 'array', items: { $ref: '#/$defs/dashboard' }, minItems: 2 },
      reports: { type: 'array', items: { $ref: '#/$defs/report' }, minItems: 2 },
      slaPatterns: { type: 'array', items: { $ref: '#/$defs/slaPattern' }, minItems: 2 },
      trendsAndMetrics: { type: 'array', items: { type: 'string' }, minItems: 4 },
    },
    required: ['incidents', 'serviceRequests', 'changes', 'problems', 'epics', 'issues', 'requestTypes', 'workflows', 'dashboards', 'reports', 'slaPatterns', 'trendsAndMetrics'],
    $defs: {
      ticket: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          priority: { type: 'string', enum: ['P1 - Critical', 'P2 - High', 'P3 - Medium', 'P4 - Low', 'P5 - Lowest'] },
          description: { type: 'string' },
        },
        required: ['title', 'priority', 'description'],
      },
      softwareIssue: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          type: { type: 'string', enum: ['Story', 'Task', 'Bug'] },
          description: { type: 'string' },
        },
        required: ['title', 'type', 'description'],
      },
      requestType: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          workType: { type: 'string', enum: ['Incident', 'Service Request', 'Change', 'Problem'] },
          purpose: { type: 'string' },
        },
        required: ['name', 'workType', 'purpose'],
      },
      workflows: {
        type: 'object',
        additionalProperties: false,
        properties: {
          incident: { type: 'array', items: { type: 'string' }, minItems: 3 },
          serviceRequest: { type: 'array', items: { type: 'string' }, minItems: 3 },
          change: { type: 'array', items: { type: 'string' }, minItems: 3 },
          problem: { type: 'array', items: { type: 'string' }, minItems: 3 },
          software: { type: 'array', items: { type: 'string' }, minItems: 3 },
        },
        required: ['incident', 'serviceRequest', 'change', 'problem', 'software'],
      },
      dashboard: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          audience: { type: 'string' },
          metrics: { type: 'array', items: { type: 'string' }, minItems: 3 },
        },
        required: ['title', 'audience', 'metrics'],
      },
      report: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          purpose: { type: 'string' },
          metrics: { type: 'array', items: { type: 'string' }, minItems: 3 },
        },
        required: ['title', 'purpose', 'metrics'],
      },
      slaPattern: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          target: { type: 'string' },
          riskSignal: { type: 'string' },
        },
        required: ['name', 'target', 'riskSignal'],
      },
    },
  };
  const customDomainInstruction = config.isCustomIndustry
    ? 'This is a custom "Others" domain entered by the user. Treat it as the source of truth. Do not substitute Banking, Healthcare, Retail, Insurance, Telecom, E-commerce, SaaS, or Manufacturing unless the user literally typed that domain.'
    : 'Use the selected predefined business domain as the source of truth.';
  const prompt = [
    `Business domain: ${config.industry}.`,
    customDomainInstruction,
    `Client/demo name: ${config.environmentName}.`,
    `Ticket data duration: ${config.dateRange}.`,
    `Generate exact counts: ${boundedCounts.incidents} incidents, ${boundedCounts.serviceRequests} service requests, ${boundedCounts.changes} change requests, ${boundedCounts.problems} problem records, and ${boundedCounts.softwareIssues} software issues.`,
    'Create enterprise-grade Jira demo data. Keep each summary unique and domain-specific.',
    'Every title must be different. Do not reuse the same noun phrase across incidents, service requests, changes, and problems.',
    'Descriptions must be concise, realistic, and specific to the selected domain.',
    'Service requests must be fulfilment/access/support requests, changes must be planned change records, problems must be root-cause records, and incidents must be disruptions/outages.',
    'Also generate request types, simple workflows, dashboard/report themes, SLA patterns, and trends/metrics aligned to this domain.',
    'Return only JSON that matches the schema.',
  ].join('\n');

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = setTimeout(() => {
    if (controller) {
      controller.abort();
    }
  }, openAiTimeoutMs);

  const fetchPromise = forgeFetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    ...(controller ? { signal: controller.signal } : {}),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: 'You generate realistic Jira Service Management and Jira Software demo datasets. Do not include markdown.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'jira_demo_content',
          schema,
          strict: true,
        },
      },
      max_output_tokens: maxOutputTokens,
    }),
  });

  const response = await Promise.race([
    fetchPromise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`OpenAI content generation timed out after ${openAiTimeoutMs}ms`)), openAiTimeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI content generation failed: ${response.status} ${responseText}`);
  }

  const responseJson = JSON.parse(responseText);
  const outputText = extractOpenAiText(responseJson);
  const generatedContent = JSON.parse(outputText);
  return normaliseAiGeneratedContent(generatedContent, config.industry);
}

function getConfiguredContent(configOrIndustry) {
  if (configOrIndustry?.aiGeneratedContent) {
    return ensureDomainContentCompleteness(configOrIndustry.aiGeneratedContent, configOrIndustry.industry);
  }

  if (typeof configOrIndustry === 'object') {
    return ensureDomainContentCompleteness(buildDynamicDomainContent(configOrIndustry.industry), configOrIndustry.industry);
  }

  return getContent(configOrIndustry);
}

async function executeAiContentGenerationStep(config, state) {
  if (config.aiGeneratedContent) {
    addChunkedDiagnostics(state, [`AI content generation: reused generated content for "${config.industry}".`]);
    return config;
  }

  try {
    const aiGeneratedContent = await generateAiDemoContent(config);
    if (aiGeneratedContent) {
      config.aiGeneratedContent = aiGeneratedContent;
      addChunkedDiagnostics(state, [`AI content generation: generated domain-aware Jira data using OpenAI for "${config.industry}".`]);
    } else {
      addChunkedDiagnostics(state, ['AI content generation: OPENAI_API_KEY is not configured; using local dynamic generator fallback.']);
    }
  } catch (err) {
    addChunkedDiagnostics(state, [`AI content generation skipped: ${err.message}. Using local dynamic generator fallback.`]);
  }

  return config;
}

function isCsvIssueCreationMode() {
  return String(ISSUE_CREATION_MODE || '').toLowerCase() === 'csv';
}

function isRestDatePatchMode() {
  return false;
}

function formatCsvDateTime(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
  ].join('');
}

function addHistoricalDatePatchIssue(state, { key, summary, lifecycle, status }) {
  if (!key || !lifecycle?.createdAt) {
    return;
  }

  state.metadata.historicalDatePatchIssues = state.metadata.historicalDatePatchIssues || [];
  const resolvedDate = isDoneLikeStatus(status || lifecycle.targetStatus)
    ? lifecycle.resolutionDate || lifecycle.updatedAt || null
    : null;

  state.metadata.historicalDatePatchIssues.push({
    'Issue key': key,
    'Project key': String(key).split('-')[0],
    Summary: summary || key,
    Created: formatCsvDateTime(lifecycle.createdAt),
    Resolved: formatCsvDateTime(resolvedDate),
    Resolution: resolvedDate ? 'Done' : '',
  });
}

async function forgeFetchWithTimeout(url, options = {}, timeoutMs = WORKER_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await forgeFetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Worker request timed out after ${timeoutMs / 1000}s`);
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function buildWorkerGenerationPayload(config, state = null) {
  const jsmProjects = (state?.results?.jsmProjects || [])
    .filter(project => project?.key)
    .map(project => ({
      projectKey: project.key,
      projectName: project.name,
    }));
  const softwareProjects = (config.softwareProjects || []).map((projectConfig, index) => {
    const createdProject = state?.results?.softwareProjects?.[index];
    return {
      ...projectConfig,
      projectKey: createdProject?.key || projectConfig.projectKey,
      projectName: createdProject?.name || projectConfig.projectName,
    };
  });

  return {
    environmentName: config.environmentName,
    industry: config.industry,
    customIndustry: config.customIndustry,
    isCustomIndustry: config.isCustomIndustry,
    dateRange: config.dateRange,
    jsmProjectCount: config.jsmProjectCount,
    incidentRequestsPerProject: config.itsmWorkCounts?.incidentRequestsPerProject || 0,
    problemRequestsPerProject: config.itsmWorkCounts?.problemRequestsPerProject || 0,
    changeRequestsPerProject: config.itsmWorkCounts?.changeRequestsPerProject || 0,
    serviceRequestsPerProject: config.itsmWorkCounts?.serviceRequestsPerProject || 0,
    jsmProjects,
    softwareProjects,
    opsDashboardTypes: config.opsDashboardTypes,
    opsDashboardSelections: config.opsDashboardSelections,
    softwareDashboardTypes: config.softwareDashboardTypes,
    softwareDashboardSelections: config.softwareDashboardSelections,
  };
}

async function executeWorkerDatasetGenerationStep(config, state) {
  try {
    const response = await forgeFetchWithTimeout(WORKER_GENERATION_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify(buildWorkerGenerationPayload(config, state)),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok || !data.success) {
      throw new Error(data.message || `Worker returned ${response.status}`);
    }

    state.metadata.workerDataset = data;
    const aiBlueprint = data.metadata?.aiBlueprint;
    const aiBlueprintSummary = aiBlueprint
      ? `Worker AI blueprint source: ${aiBlueprint.source}${aiBlueprint.model ? ` (${aiBlueprint.model})` : ''}.`
      : 'Worker AI blueprint source: not returned.';
    addChunkedDiagnostics(state, [
      `Worker dataset generated: ${data.ticketCount || 0} CSV issue rows.`,
      aiBlueprintSummary,
      `Worker ticket CSV: ${data.ticketCsvPath || 'not returned'}`,
      `Worker release CSV: ${data.releaseCsvPath || 'not returned'}`,
      'CSV-first mode: Jira REST issue creation is skipped so historical Created/Resolved dates can come from CSV import.',
    ]);
  } catch (err) {
    state.metadata.workerDataset = {
      success: false,
      message: err.message,
    };
    addChunkedDiagnostics(state, [
      `Worker dataset generation skipped or failed: ${err.message}`,
      'Existing Forge REST creation flow will continue for now until the worker is hosted and reachable from Forge.',
    ]);
  }
}

async function executeWorkerDatePatchGenerationStep(config, state) {
  const issues = state.metadata.historicalDatePatchIssues || [];

  if (issues.length === 0) {
    state.metadata.workerDatePatch = {
      success: false,
      message: 'No REST-created issue keys were available for date patch CSV generation.',
    };
    addChunkedDiagnostics(state, ['Historical date patch CSV skipped: no REST-created issue keys were available.']);
    return;
  }

  state.metadata.workerDatePatch = {
    success: true,
    ticketCount: issues.length,
    browserDownload: true,
  };
  addChunkedDiagnostics(state, [
    `Legacy historical date patch CSV generation skipped: ${issues.length} existing issue row(s) were available, but the CSV patch flow is disabled.`,
    'Forge REST now populates custom historical Created Date and Resolved Date fields for dashboards instead.',
  ]);
}

function getContent(industry) {
  const all = {
    Banking: {
      incidents: [
        { title: 'Core banking system outage affecting all transactions', priority: 'P1 - Critical' },
        { title: 'Payment gateway failure - customers unable to transfer funds', priority: 'P1 - Critical' },
        { title: 'Mobile banking app login failures for 40% of users', priority: 'P2 - High' },
        { title: 'ATM network degradation in northern region', priority: 'P2 - High' },
        { title: 'Slow response time on internet banking portal', priority: 'P3 - Medium' },
        { title: 'SMS OTP delivery delays affecting authentication', priority: 'P3 - Medium' },
        { title: 'Credit card transaction processing delays', priority: 'P2 - High' },
        { title: 'Online account opening form submission errors', priority: 'P3 - Medium' },
        { title: 'SWIFT payment processing failures for international transfers', priority: 'P1 - Critical' },
        { title: 'Customer data sync issues between mobile and web', priority: 'P3 - Medium' },
        { title: 'Loan management system performance degradation', priority: 'P2 - High' },
        { title: 'Minor UI issues on account statement page', priority: 'P4 - Low' },
        { title: 'FX rate feed not updating in trading platform', priority: 'P2 - High' },
        { title: 'Regulatory reporting system timeout errors', priority: 'P2 - High' },
        { title: 'Two-factor authentication service intermittent failures', priority: 'P2 - High' },
        { title: 'Account balance discrepancy reported by premium customers', priority: 'P1 - Critical' },
        { title: 'Card management portal inaccessible for branch staff', priority: 'P3 - Medium' },
        { title: 'Cheque processing system delayed by 24 hours', priority: 'P3 - Medium' },
        { title: 'Risk scoring engine returning incorrect results', priority: 'P1 - Critical' },
        { title: 'Customer notification emails not being delivered', priority: 'P3 - Medium' },
      ],
      epics: ['Core Banking API Modernization', 'Customer Digital Onboarding', 'Payment Processing Engine', 'Regulatory Compliance Framework'],
      issues: [
        { title: 'Implement real-time payment notification system', type: 'Story' },
        { title: 'Migrate legacy COBOL modules to Java microservices', type: 'Task' },
        { title: 'Build customer KYC verification workflow', type: 'Story' },
        { title: 'Fix transaction rollback bug in payment gateway', type: 'Bug' },
        { title: 'Implement AML screening integration', type: 'Story' },
        { title: 'Design open banking API endpoints', type: 'Story' },
        { title: 'Build credit scoring algorithm integration', type: 'Task' },
        { title: 'Implement SWIFT message processing module', type: 'Story' },
        { title: 'Fix race condition in concurrent transaction processing', type: 'Bug' },
        { title: 'Build regulatory reporting dashboard', type: 'Story' },
        { title: 'Implement multi-currency account support', type: 'Story' },
        { title: 'Design fraud detection rule engine', type: 'Task' },
        { title: 'Build mobile banking biometric authentication', type: 'Story' },
        { title: 'Implement GDPR data export functionality', type: 'Task' },
        { title: 'Fix interest calculation rounding error', type: 'Bug' },
        { title: 'Build loan origination workflow', type: 'Story' },
        { title: 'Implement card tokenization service', type: 'Story' },
        { title: 'Design customer 360 view dashboard', type: 'Task' },
        { title: 'Build automated reconciliation system', type: 'Story' },
        { title: 'Implement digital signature for loan documents', type: 'Story' },
        { title: 'Fix session timeout issue on mobile app', type: 'Bug' },
        { title: 'Build branch locator API integration', type: 'Task' },
        { title: 'Implement standing order management module', type: 'Story' },
        { title: 'Design API gateway rate limiting policy', type: 'Task' },
        { title: 'Build customer feedback collection system', type: 'Story' },
        { title: 'Implement transaction dispute workflow', type: 'Story' },
        { title: 'Fix PDF statement generation memory leak', type: 'Bug' },
        { title: 'Build relationship manager portal', type: 'Story' },
        { title: 'Implement beneficiary management system', type: 'Story' },
        { title: 'Design data archival strategy for transactions', type: 'Task' },
      ],
    },
    Healthcare: {
      incidents: [
        { title: 'Electronic Health Record system unresponsive', priority: 'P1 - Critical' },
        { title: 'Patient portal login failures affecting appointments', priority: 'P2 - High' },
        { title: 'Medical imaging system PACS server down', priority: 'P1 - Critical' },
        { title: 'Pharmacy dispensing system errors', priority: 'P1 - Critical' },
        { title: 'HL7 message integration failures with lab system', priority: 'P2 - High' },
        { title: 'Appointment scheduling system performance issues', priority: 'P3 - Medium' },
        { title: 'Clinical decision support alerts not triggering', priority: 'P2 - High' },
        { title: 'Patient wristband barcode scanner connectivity loss', priority: 'P2 - High' },
        { title: 'Insurance eligibility verification system timeout', priority: 'P3 - Medium' },
        { title: 'Telemedicine platform video call quality degradation', priority: 'P3 - Medium' },
        { title: 'Lab results not syncing to patient records', priority: 'P2 - High' },
        { title: 'Nurse call system integration failure', priority: 'P2 - High' },
        { title: 'Patient discharge process system errors', priority: 'P3 - Medium' },
        { title: 'Radiology report delivery delays', priority: 'P3 - Medium' },
        { title: 'ICU monitoring system data feed interruption', priority: 'P1 - Critical' },
      ],
      epics: ['Patient Data Management', 'Clinical Workflow Automation', 'Telehealth Platform', 'Compliance and Security'],
      issues: [
        { title: 'Build patient intake digital form workflow', type: 'Story' },
        { title: 'Implement HL7 FHIR API for lab results', type: 'Story' },
        { title: 'Fix appointment reminder notification bug', type: 'Bug' },
        { title: 'Design clinical decision support rule engine', type: 'Task' },
        { title: 'Build medication reconciliation module', type: 'Story' },
        { title: 'Implement HIPAA audit trail system', type: 'Story' },
        { title: 'Build telehealth video consultation module', type: 'Story' },
        { title: 'Fix patient record merge duplicate issue', type: 'Bug' },
        { title: 'Implement insurance pre-authorization workflow', type: 'Story' },
        { title: 'Design patient risk stratification algorithm', type: 'Task' },
        { title: 'Build clinical trial enrollment module', type: 'Story' },
        { title: 'Implement drug interaction alert system', type: 'Story' },
        { title: 'Fix radiology image viewer loading bug', type: 'Bug' },
        { title: 'Build patient discharge planning workflow', type: 'Story' },
        { title: 'Design population health analytics dashboard', type: 'Task' },
      ],
    },
    Retail: {
      incidents: [
        { title: 'E-commerce platform checkout failure during peak sale', priority: 'P1 - Critical' },
        { title: 'Inventory management system sync failure', priority: 'P2 - High' },
        { title: 'Payment processor timeout causing failed transactions', priority: 'P1 - Critical' },
        { title: 'Product search returning incorrect results', priority: 'P2 - High' },
        { title: 'Order management system processing delays', priority: 'P2 - High' },
        { title: 'Customer loyalty points not updating correctly', priority: 'P3 - Medium' },
        { title: 'Mobile app crashes on product detail page', priority: 'P3 - Medium' },
        { title: 'Warehouse management system barcode scan failures', priority: 'P2 - High' },
        { title: 'Email marketing platform delivery failures', priority: 'P3 - Medium' },
        { title: 'Returns processing system errors', priority: 'P3 - Medium' },
        { title: 'Flash sale pricing engine not applying discounts', priority: 'P1 - Critical' },
        { title: 'Click and collect system not confirming orders', priority: 'P2 - High' },
        { title: 'Gift card redemption system failures', priority: 'P3 - Medium' },
        { title: 'Product review system not saving submissions', priority: 'P4 - Low' },
        { title: 'Supplier portal login issues for vendors', priority: 'P3 - Medium' },
      ],
      epics: ['E-commerce Platform', 'Inventory Management', 'Customer Experience', 'Supply Chain Integration'],
      issues: [
        { title: 'Build product recommendation engine', type: 'Story' },
        { title: 'Implement real-time inventory tracking', type: 'Story' },
        { title: 'Fix cart abandonment email trigger bug', type: 'Bug' },
        { title: 'Design supplier portal integration', type: 'Task' },
        { title: 'Build customer loyalty programme module', type: 'Story' },
        { title: 'Implement AI-powered search functionality', type: 'Story' },
        { title: 'Build returns and refunds workflow', type: 'Story' },
        { title: 'Fix product image loading performance issue', type: 'Bug' },
        { title: 'Implement omnichannel order management', type: 'Story' },
        { title: 'Design demand forecasting algorithm', type: 'Task' },
        { title: 'Build flash sale campaign management tool', type: 'Story' },
        { title: 'Implement dynamic pricing engine', type: 'Story' },
        { title: 'Fix checkout session expiry bug', type: 'Bug' },
        { title: 'Build warehouse pick and pack optimisation', type: 'Story' },
        { title: 'Design customer segmentation model', type: 'Task' },
      ],
    },
    SaaS: {
      incidents: [
        { title: 'API gateway returning 503 errors for enterprise customers', priority: 'P1 - Critical' },
        { title: 'Authentication service OAuth token validation failures', priority: 'P1 - Critical' },
        { title: 'Data pipeline processing delays exceeding SLA', priority: 'P2 - High' },
        { title: 'Webhook delivery failures for critical integrations', priority: 'P2 - High' },
        { title: 'Dashboard loading times exceeding 10 seconds', priority: 'P2 - High' },
        { title: 'Tenant data isolation breach detected', priority: 'P1 - Critical' },
        { title: 'Billing system failing to process subscription renewals', priority: 'P2 - High' },
        { title: 'Email notification service queue backlog', priority: 'P3 - Medium' },
        { title: 'Search functionality returning stale results', priority: 'P3 - Medium' },
        { title: 'Mobile SDK crash on iOS 17.4 update', priority: 'P3 - Medium' },
        { title: 'SSO integration failures for enterprise customers', priority: 'P2 - High' },
        { title: 'Report generation timing out for large datasets', priority: 'P2 - High' },
        { title: 'File upload service rejecting valid file types', priority: 'P3 - Medium' },
        { title: 'Audit log entries missing for compliance review', priority: 'P2 - High' },
        { title: 'Workspace invitation emails not being delivered', priority: 'P3 - Medium' },
      ],
      epics: ['Platform Scalability', 'Developer Experience', 'Enterprise Features', 'Security and Compliance'],
      issues: [
        { title: 'Implement horizontal pod autoscaling', type: 'Story' },
        { title: 'Build self-serve onboarding workflow', type: 'Story' },
        { title: 'Fix memory leak in data processing worker', type: 'Bug' },
        { title: 'Design multi-region failover architecture', type: 'Task' },
        { title: 'Build advanced analytics dashboard', type: 'Story' },
        { title: 'Implement SOC2 audit logging', type: 'Story' },
        { title: 'Build webhook management interface', type: 'Story' },
        { title: 'Fix OAuth token refresh race condition', type: 'Bug' },
        { title: 'Implement custom role-based access control', type: 'Story' },
        { title: 'Design API versioning strategy', type: 'Task' },
        { title: 'Build usage analytics and billing dashboard', type: 'Story' },
        { title: 'Implement data export and portability feature', type: 'Story' },
        { title: 'Fix pagination bug in list endpoints', type: 'Bug' },
        { title: 'Build SSO SAML integration module', type: 'Story' },
        { title: 'Design disaster recovery runbook', type: 'Task' },
      ],
    },
    Manufacturing: {
      incidents: [
        { title: 'MES production line monitoring system offline', priority: 'P1 - Critical' },
        { title: 'ERP system integration failures with shop floor', priority: 'P1 - Critical' },
        { title: 'Quality control sensor data feed interruption', priority: 'P2 - High' },
        { title: 'Supply chain visibility platform data sync failure', priority: 'P2 - High' },
        { title: 'Predictive maintenance alerts not triggering', priority: 'P2 - High' },
        { title: 'Barcode scanning system failures on assembly line', priority: 'P2 - High' },
        { title: 'SCADA system communication timeout with PLCs', priority: 'P1 - Critical' },
        { title: 'Inventory reorder system not generating purchase orders', priority: 'P3 - Medium' },
        { title: 'Worker safety monitoring system alert failures', priority: 'P2 - High' },
        { title: 'Production scheduling system performance degradation', priority: 'P3 - Medium' },
        { title: 'Digital work instruction system unavailable on shop floor', priority: 'P2 - High' },
        { title: 'OEE reporting system showing incorrect data', priority: 'P2 - High' },
        { title: 'Supplier delivery notification system failures', priority: 'P3 - Medium' },
        { title: 'Energy monitoring dashboard not updating', priority: 'P3 - Medium' },
        { title: 'Finished goods labelling system printer errors', priority: 'P3 - Medium' },
      ],
      epics: ['Smart Manufacturing Platform', 'Supply Chain Optimization', 'Quality Management System', 'Predictive Maintenance'],
      issues: [
        { title: 'Build real-time production line monitoring dashboard', type: 'Story' },
        { title: 'Implement IoT sensor data ingestion pipeline', type: 'Story' },
        { title: 'Fix OEE calculation rounding error', type: 'Bug' },
        { title: 'Design digital twin integration architecture', type: 'Task' },
        { title: 'Build supplier quality scorecard module', type: 'Story' },
        { title: 'Implement predictive maintenance ML model', type: 'Story' },
        { title: 'Build production scheduling optimisation engine', type: 'Story' },
        { title: 'Fix barcode scanner timeout issue', type: 'Bug' },
        { title: 'Implement automated quality inspection workflow', type: 'Story' },
        { title: 'Design energy consumption monitoring system', type: 'Task' },
        { title: 'Build supplier onboarding portal', type: 'Story' },
        { title: 'Implement digital work instruction system', type: 'Story' },
        { title: 'Fix shift handover report generation bug', type: 'Bug' },
        { title: 'Build finished goods traceability module', type: 'Story' },
        { title: 'Design carbon footprint tracking dashboard', type: 'Task' },
      ],
    },
  };
  return ensureDomainContentCompleteness(all[industry] || buildDynamicDomainContent(industry), industry);
}

// ── JIRA API ──────────────────────────────────────────────────────────────────

async function jiraGet(path) {
  const res = await api.asUser().requestJira(buildTrustedJiraRoute(path));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function jiraPost(path, body) {
  const res = await api.asUser().requestJira(buildTrustedJiraRoute(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  const text = await res.text();
  if (!text || text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function jiraPut(path, body) {
  const res = await api.asUser().requestJira(buildTrustedJiraRoute(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${path} failed: ${res.status} ${text}`);
  }
  const text = await res.text();
  if (!text || text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function jiraFormsGet(resourcePath) {
  const path = `/forms/${String(resourcePath || '').replace(/^\/+/, '')}`;
  const res = await api.asUser().requestJira(buildTrustedJiraRoute(path), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-ExperimentalApi': 'opt-in',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function jiraFormsPost(resourcePath, body) {
  const path = `/forms/${String(resourcePath || '').replace(/^\/+/, '')}`;
  const res = await api.asUser().requestJira(buildTrustedJiraRoute(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-ExperimentalApi': 'opt-in',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  const text = await res.text();
  if (!text || text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function jiraAppGet(path) {
  const res = await api.asApp().requestJira(buildTrustedJiraRoute(path));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function jiraAppPost(path, body) {
  const res = await api.asApp().requestJira(buildTrustedJiraRoute(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  const text = await res.text();
  if (!text || text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function jiraAppPut(path, body) {
  const res = await api.asApp().requestJira(buildTrustedJiraRoute(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${path} failed: ${res.status} ${text}`);
  }
  const text = await res.text();
  if (!text || text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function jiraAppDelete(path) {
  const res = await api.asApp().requestJira(buildTrustedJiraRoute(path), {
    method: 'DELETE',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DELETE ${path} failed: ${res.status} ${text}`);
  }
}

async function confluenceGet(path) {
  const res = await api.asUser().requestConfluence(buildTrustedConfluenceRoute(path));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function confluencePost(path, body) {
  const res = await api.asUser().requestConfluence(buildTrustedConfluenceRoute(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  const text = await res.text();
  if (!text || text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function buildTrustedJiraRoute(path) {
  // These endpoints are assembled centrally so we validate the shape once here,
  // then tell Forge the route is intentional. This avoids false positives from
  // passing a complete string through `route`${...}` while still rejecting
  // traversal attempts or absolute URLs.
  if (typeof path !== 'string' || !(path.startsWith('/rest/') || path.startsWith('/forms/'))) {
    throw new Error(`Invalid Jira REST path: ${path}`);
  }

  if (path.includes('..') || path.includes('://') || path.startsWith('//')) {
    throw new Error(`Unsafe Jira REST path rejected: ${path}`);
  }

  return assumeTrustedRoute(path);
}

function buildTrustedConfluenceRoute(path) {
  if (typeof path !== 'string' || !path.startsWith('/wiki/api/')) {
    throw new Error(`Invalid Confluence REST path: ${path}`);
  }

  if (path.includes('..') || path.includes('\\') || path.startsWith('//')) {
    throw new Error(`Unsafe Confluence REST path: ${path}`);
  }

  return assumeTrustedRoute(path);
}

function buildProjectInClause(projectKeys) {
  return projectKeys
    .filter(Boolean)
    .map(projectKey => `"${String(projectKey).replace(/"/g, '\\"')}"`)
    .join(', ');
}

function normaliseFieldName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z]/g, '');
}

function isCustomDateField(field) {
  const schemaType = String(field?.schema?.type || '').toLowerCase();
  const customType = String(field?.schema?.custom || '').toLowerCase();
  const looksCustom = Boolean(field?.custom) || String(field?.id || field?.key || '').startsWith('customfield_');

  return looksCustom && (
    schemaType === 'date' ||
    schemaType === 'datetime' ||
    customType.includes(':datepicker') ||
    customType.includes(':datetime')
  );
}

function parseDateRangeDays(value) {
  const match = String(value || '').match(/(\d+)/);
  const amount = match ? Number.parseInt(match[1], 10) : 6;
  const isYearRange = String(value || '').toLowerCase().includes('year');
  return Math.max(30, Math.min(730, amount * (isYearRange ? 365 : 30)));
}

function toJiraDateOnly(value) {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString().split('T')[0];
}

function buildDueDateFromLifecycle(lifecycle, priority, index) {
  const createdAt = new Date(lifecycle?.createdAt || new Date());
  const isHighPriority = ['Highest', 'High', 'Critical', 'P1 - Critical', 'P2 - High'].includes(priority);
  const targetStatus = normaliseStatusName(lifecycle?.targetStatus);
  const plannedDays = isHighPriority ? 3 + (index % 5) : 10 + (index % 18);
  const dueDate = addDays(createdAt, plannedDays);

  if (targetStatus === 'resolved' || targetStatus === 'done' || targetStatus === 'closed' || targetStatus === 'completed') {
    return toJiraDateOnly(lifecycle?.resolutionDate || dueDate);
  }

  return toJiraDateOnly(dueDate);
}

async function getCurrentUser() {
  const data = await jiraGet('/rest/api/3/myself');
  return data.accountId;
}

async function getMyGlobalPermissions() {
  const data = await jiraGet('/rest/api/3/mypermissions?permissions=ADMINISTER');
  return data.permissions || {};
}

function extractProjectTypeKeys(projectTypes) {
  return (Array.isArray(projectTypes) ? projectTypes : [])
    .map(projectType => projectType?.key)
    .filter(Boolean);
}

async function getVisibleProjectTypeKeys(diagnostics = []) {
  const keys = new Set();

  try {
    extractProjectTypeKeys(await jiraGet('/rest/api/3/project/type'))
      .forEach(key => keys.add(key));
  } catch (err) {
    diagnostics.push(`JSM preflight: user project type lookup failed: ${err.message}`);
  }

  try {
    extractProjectTypeKeys(await jiraAppGet('/rest/api/3/project/type'))
      .forEach(key => keys.add(key));
  } catch (err) {
    diagnostics.push(`JSM preflight: app project type lookup failed: ${err.message}`);
  }

  return Array.from(keys);
}

async function createJSMProject(name, leadAccountId, keyPrefix, diagnostics = []) {
  // Keep the Ops project as a real IT Service Management project. We do not
  // fall back to Jira Work Management here because the user expects JSM queues,
  // request types, and Forms. If these templates are unavailable, failing loudly
  // is better than creating the wrong project type.
  const visibleProjectTypeKeys = await getVisibleProjectTypeKeys(diagnostics);
  diagnostics.push(`JSM preflight: visible Jira project types=${visibleProjectTypeKeys.join(', ') || 'none'}.`);

  if (!visibleProjectTypeKeys.includes('service_desk')) {
    throw new Error(
      'Jira Service Management is not active for REST project creation on this site. The IT service management template currently appears as TRY in Jira, so start/activate Jira Service Management first, then rerun the demo. The app will not create a Business/JWM fallback for Ops.'
    );
  }

  const project = await createProjectWithRetries({
    name,
    leadAccountId,
    keyPrefix,
    projectTypeKey: 'service_desk',
    maxAttempts: 3,
    templateKeys: getJsmItsmTemplateKeys(),
    allowTemplateOmission: false,
    diagnostics,
  });

  return {
    ...project,
    serviceDeskAvailable: true,
    projectTypeKey: 'service_desk',
  };
}

async function getProjectByKeyIfExists(projectKey) {
  try {
    return await jiraGet(`/rest/api/3/project/${encodeURIComponent(projectKey)}`);
  } catch (err) {
    const message = String(err.message || '');
    if (message.includes('404')) {
      return null;
    }

    throw err;
  }
}

function getJsmItsmTemplateKeys() {
  // This first key is the Jira Cloud "IT service management" template shown in
  // Jira's project template picker. The remaining entries are ITSM/service-desk
  // variants only, so a requested JSM project never silently becomes a generic
  // Jira business/software project.
  return [
    'com.atlassian.servicedesk:simplified-it-service-management',
    'com.atlassian.servicedesk:Team-managed-it-service-management',
    'com.atlassian.servicedesk:simplified-it-service-desk',
    'com.atlassian.servicedesk:simplified-it-service-management-basic',
    'com.atlassian.servicedesk:itil-v2-service-desk-project',
    'com.atlassian.servicedesk:simplified-general-service-desk-it',
    'com.atlassian.servicedesk:next-gen-it-service-desk',
  ];
}

async function getServiceDeskId(projectKey) {
  const data = await jiraGet('/rest/servicedeskapi/servicedesk');
  const sd = (data.values || []).find(s => s.projectKey === projectKey);
  return sd ? sd.id : null;
}

async function getServiceDeskIdWithRetry(projectKey, {
  attempts = 8,
  delayMs = 1500,
  diagnostics = [],
  label = 'Service desk lookup',
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const serviceDeskId = await getServiceDeskId(projectKey);

    if (serviceDeskId) {
      if (attempt > 1) {
        diagnostics.push(`${label} ${projectKey}: service desk became available on attempt ${attempt}.`);
      }
      return serviceDeskId;
    }

    if (attempt < attempts) {
      diagnostics.push(`${label} ${projectKey}: service desk not available yet; waiting for Jira provisioning (${attempt}/${attempts}).`);
      await wait(delayMs);
    }
  }

  return null;
}

async function getServiceDeskRequestTypes(serviceDeskId) {
  const data = await jiraGet(`/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype`);
  return Array.isArray(data.values) ? data.values : [];
}

async function getServiceDeskQueues(serviceDeskId) {
  const data = await jiraGet(`/rest/servicedeskapi/servicedesk/${serviceDeskId}/queue`);
  return Array.isArray(data.values) ? data.values : [];
}

function chooseRequestTypeForSmartForm(requestTypes) {
  const findByKeyword = keywords => requestTypes.find(requestType => {
    const name = String(requestType?.name || '').toLowerCase();
    return keywords.some(keyword => name.includes(keyword));
  });

  const incidentLike = findByKeyword(['incident', 'report a problem', 'it help', 'support']);
  if (incidentLike) {
    return incidentLike;
  }

  return requestTypes[0] || null;
}

async function getRequestTypeId(serviceDeskId) {
  const requestTypes = await getServiceDeskRequestTypes(serviceDeskId);
  const requestType = chooseRequestTypeForSmartForm(requestTypes);
  return requestType?.id || null;
}

function buildFormPublishingConfig(requestType) {
  return {
    jira: {
      issueCreateIssueTypeIds: requestType?.issueTypeId ? [Number(requestType.issueTypeId)] : [],
      issueCreateRequestTypeIds: requestType?.id ? [Number(requestType.id)] : [],
      recommendedIssueRequestTypeIds: requestType?.id ? [Number(requestType.id)] : [],
      submitOnCreate: true,
      validateOnCreate: true,
    },
    portal: {
      portalRequestTypeIds: requestType?.id ? [Number(requestType.id)] : [],
      submitOnCreate: true,
      validateOnCreate: true,
    },
  };
}

function buildFallbackFormPayloadAttempts(projectName, requestType) {
  const publish = buildFormPublishingConfig(requestType);
  const baseSettings = {
    language: 'en',
    name: `${projectName} Smart Intake`,
    primaryLocale: 'en-US',
    submit: {
      lock: true,
      pdf: true,
    },
    translatedLocale: 'en-US',
  };

  return [
    {
      label: 'adf-paragraph-layout',
      payload: {
        design: {
          conditions: {},
          layout: [
            {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Please provide the required request details.',
                    },
                  ],
                },
              ],
            },
          ],
          questions: {},
          sections: {},
          settings: baseSettings,
        },
        publish,
      },
    },
    {
      label: 'docs-sample-layout',
      payload: {
        design: {
          conditions: {},
          layout: [{}],
          questions: {},
          sections: {},
          settings: {
            ...baseSettings,
            translatedLocale: 'en-GB',
          },
        },
        publish,
      },
    },
    {
      label: 'empty-layout',
      payload: {
        design: {
          conditions: {},
          layout: [],
          questions: {},
          sections: {},
          settings: baseSettings,
        },
        publish,
      },
    },
  ];
}

async function ensureDefaultSmartIntakeForm(projectKey, projectName, industry) {
  const serviceDeskId = await getServiceDeskIdWithRetry(projectKey, {
    attempts: 6,
    delayMs: 1500,
    label: 'Forms service desk lookup',
  });
  if (!serviceDeskId) {
    return {
      success: false,
      message: `Service desk for project ${projectKey} was not found.`,
    };
  }

  const requestTypes = await getServiceDeskRequestTypes(serviceDeskId);
  if (requestTypes.length === 0) {
    return {
      success: false,
      message: `No request types were found for service desk ${serviceDeskId}.`,
    };
  }

  const requestType = chooseRequestTypeForSmartForm(requestTypes);
  if (!requestType?.id) {
    return {
      success: false,
      message: `Could not resolve a request type for service desk ${serviceDeskId}.`,
    };
  }

  const formDesign = buildDynamicJsmFormDesign({ projectName, industry });
  const payload = buildFormsApiPayload(formDesign, requestType);

  try {
    const existingForms = await jiraFormsGet(`project/${encodeURIComponent(projectKey)}/form`);
    const existingForm = (Array.isArray(existingForms) ? existingForms : []).find(form =>
      normaliseFieldName(form?.name) === normaliseFieldName(formDesign.name)
    );

    if (existingForm) {
      return {
        success: true,
        reused: true,
        id: existingForm.id || null,
        name: existingForm.name || formDesign.name,
        requestTypeId: requestType.id,
      };
    }
  } catch (err) {
    // Form index lookup is best-effort. Creation can still succeed even when
    // listing forms is unavailable due tenant-specific form API permissions.
  }

  let dynamicErrorMessage = null;
  if (!formsDynamicSchemaRejected) {
    try {
      const created = await jiraFormsPost(`project/${encodeURIComponent(projectKey)}/form`, payload);
      return {
        success: true,
        reused: false,
        id: created?.id || null,
        name: created?.name || formDesign.name,
        requestTypeId: requestType.id,
        mode: 'dynamic',
      };
    } catch (err) {
      dynamicErrorMessage = err.message;
      if (String(err.message || '').toLowerCase().includes('invalid adf')) {
        formsDynamicSchemaRejected = true;
      }
    }
  }

  try {
    const attempts = buildFallbackFormPayloadAttempts(projectName, requestType);
    const fallbackErrors = [];

    for (const attempt of attempts) {
      try {
        const created = await jiraFormsPost(`project/${encodeURIComponent(projectKey)}/form`, attempt.payload);
        return {
          success: true,
          reused: false,
          id: created?.id || null,
          name: created?.name || attempt.payload.design?.settings?.name || `${projectName} Smart Intake`,
          requestTypeId: requestType.id,
          mode: 'fallback',
          warning: dynamicErrorMessage
            ? `Dynamic form schema was rejected (${dynamicErrorMessage}). Fallback template "${attempt.label}" was created successfully.`
            : `Fallback template "${attempt.label}" was created successfully.`,
        };
      } catch (fallbackErr) {
        fallbackErrors.push(`${attempt.label}: ${fallbackErr.message}`);
      }
    }

    return {
      success: false,
      message: dynamicErrorMessage
        ? `Dynamic form template failed: ${dynamicErrorMessage}. Fallback attempts failed: ${fallbackErrors.join(' | ')}`
        : `Fallback form template creation failed: ${fallbackErrors.join(' | ')}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Form template creation failed unexpectedly: ${err.message}`,
    };
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createKnowledgeBaseSpaceKey(projectKey) {
  return `${String(projectKey || 'KB').replace(/[^A-Z0-9]/gi, '').toUpperCase().substring(0, 6)}KB`.substring(0, 10);
}

function buildKnowledgeBasePages(projectName, industry) {
  const serviceLabel = industry === 'Banking'
    ? 'digital banking services'
    : industry === 'Healthcare'
      ? 'clinical and patient-facing systems'
      : 'customer operations systems';

  return [
    {
      title: 'Incident triage playbook',
      body: [
        `Use this playbook to classify and triage incidents impacting ${serviceLabel}.`,
        'Confirm impact, urgency, affected service, customer visibility, workaround, and escalation owner before moving the incident into active response.',
      ],
    },
    {
      title: 'Problem management guide',
      body: [
        'Use problem records to investigate recurring incidents and capture root cause analysis.',
        'Document symptoms, known errors, contributing factors, corrective actions, and prevention tasks linked to delivery work.',
      ],
    },
    {
      title: 'Change enablement checklist',
      body: [
        'Use change records to evaluate deployment risk, approvals, rollback planning, and customer communication.',
        'Confirm implementation window, impacted services, validation plan, rollback owner, and post-change review notes.',
      ],
    },
    {
      title: 'Service request fulfilment guide',
      body: [
        `Use service requests for standard support and access workflows in ${projectName}.`,
        'Capture requester, service, approval need, fulfilment owner, expected completion date, and customer-facing resolution notes.',
      ],
    },
  ];
}

async function ensureKnowledgeBaseSpace(projectKey, projectName, industry, diagnostics = []) {
  const spaceKey = createKnowledgeBaseSpaceKey(projectKey);
  const spaceName = `${projectName} Knowledge Base`;
  let space = null;

  try {
    const existing = await confluenceGet(`/wiki/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}&limit=1`);
    space = existing.results?.[0] || null;
  } catch (err) {
    diagnostics.push(`Knowledge base ${projectKey}: Confluence space lookup failed: ${err.message}`);
  }

  if (!space) {
    try {
      space = await confluencePost('/wiki/api/v2/spaces', {
        key: spaceKey,
        name: spaceName,
      });
      diagnostics.push(`Knowledge base ${projectKey}: created Confluence space ${spaceKey}.`);
    } catch (err) {
      diagnostics.push(`Knowledge base ${projectKey}: Confluence space creation failed: ${err.message}`);
      return {
        success: false,
        key: spaceKey,
        name: spaceName,
        pages: [],
        message: err.message,
      };
    }
  } else {
    diagnostics.push(`Knowledge base ${projectKey}: reused Confluence space ${spaceKey}.`);
  }

  const spaceId = space.id || spaceKey;
  const pages = [];

  for (const page of buildKnowledgeBasePages(projectName, industry)) {
    try {
      const created = await confluencePost('/wiki/api/v2/pages', {
        spaceId,
        status: 'current',
        title: page.title,
        body: {
          representation: 'storage',
          value: [
            `<p>${escapeHtml(page.body[0])}</p>`,
            `<p>${escapeHtml(page.body[1])}</p>`,
          ].join(''),
        },
      });
      pages.push({ id: created.id || null, title: page.title });
    } catch (err) {
      diagnostics.push(`Knowledge base ${projectKey}: page "${page.title}" creation failed: ${err.message}`);
    }
  }

  return {
    success: pages.length > 0,
    key: spaceKey,
    name: spaceName,
    pages,
  };
}

function getItsmWorkTypeCatalog(content) {
  return [
    {
      workType: 'Incident',
      issueType: 'Incident',
      source: content.incidents,
      fallbackTitle: 'Customer-facing service degradation',
    },
    {
      workType: 'Problem',
      issueType: 'Problem',
      source: content.problems,
      fallbackTitle: 'Recurring service instability root cause analysis',
    },
    {
      workType: 'Change',
      issueType: 'Change',
      source: content.changes,
      fallbackTitle: 'Production change for service reliability improvement',
    },
    {
      workType: 'Service Request',
      issueType: 'Service Request',
      source: content.serviceRequests,
      fallbackTitle: 'Standard access and support request fulfilment',
    },
    {
      workType: 'Post-incident Review',
      issueType: 'Post-incident Review',
      source: content.incidents,
      fallbackTitle: 'Post-incident review for major service disruption',
    },
  ];
}

const ITSM_SUMMARY_VARIANTS = {
  Incident: [
    'during peak business operations',
    'affecting a regional user group',
    'impacting customer-facing processing',
    'with intermittent service recovery',
    'requiring cross-team escalation',
    'detected by monitoring alerts',
    'reported by priority users',
    'causing downstream integration delays',
  ],
  Problem: [
    'root cause review for recurring symptoms',
    'known error investigation with prevention plan',
    'trend analysis for repeated service degradation',
    'RCA follow-up from linked incidents',
    'permanent fix investigation for repeat failures',
    'service stability analysis for operations',
    'corrective action planning with owners',
    'recurrence prevention review',
  ],
  Change: [
    'planned release window with rollback validation',
    'configuration update requiring approval',
    'controlled maintenance activity for service reliability',
    'deployment readiness review with risk assessment',
    'change implementation plan for production',
    'approval workflow for operational improvement',
    'post-change validation and monitoring update',
    'scheduled remediation with stakeholder notice',
  ],
  'Service Request': [
    'standard fulfilment request for business users',
    'access and entitlement request with approval',
    'support request for operational enablement',
    'new service setup request for a team',
    'data/reporting request for service owners',
    'hardware or tool access fulfilment task',
    'onboarding support request with handoff notes',
    'self-service fulfilment request needing agent action',
  ],
  'Post-incident Review': [
    'review follow-up for stakeholder actions',
    'lessons learned record for service restoration',
  ],
};

const ITSM_DESCRIPTION_FOCUS = {
  Incident: 'Capture impact, urgency, affected service, recovery owner, customer communication, and restoration notes.',
  Problem: 'Document recurring symptoms, root cause hypothesis, known error, corrective action, and prevention owner.',
  Change: 'Document implementation window, approvals, risk, validation plan, rollback owner, and post-change evidence.',
  'Service Request': 'Capture requester need, approval requirement, fulfilment owner, expected completion, and customer-facing outcome.',
  'Post-incident Review': 'Capture timeline, impact, root cause, follow-up actions, owners, and prevention commitments.',
};

function makeUniqueItsmSummary(baseTitle, workType, sourceIndex, sourceLength, usedTitles) {
  const fallbackBase = `${workType} record`;
  const cleanBase = String(baseTitle || fallbackBase).replace(/\s+-\s+Scenario\s+\d+$/i, '').replace(/\s+/g, ' ').trim() || fallbackBase;
  const variants = ITSM_SUMMARY_VARIANTS[workType] || ITSM_SUMMARY_VARIANTS.Incident;
  const cycleNumber = sourceLength > 0 ? Math.floor(sourceIndex / sourceLength) : sourceIndex;
  let candidate = cleanBase;

  if (cycleNumber > 0 || usedTitles.has(candidate.toLowerCase())) {
    candidate = `${cleanBase} - ${variants[sourceIndex % variants.length]}`;
  }

  let suffix = 2;
  while (usedTitles.has(candidate.toLowerCase())) {
    candidate = `${cleanBase} - ${variants[(sourceIndex + suffix) % variants.length]} ${suffix}`;
    suffix += 1;
  }

  usedTitles.add(candidate.toLowerCase());
  return candidate.slice(0, 180);
}

function makeUniqueItsmDescription(template, title, workType, sourceIndex, sourceLength) {
  const cleanDescription = String(template.description || '').replace(/\s+/g, ' ').trim();
  const variants = ITSM_SUMMARY_VARIANTS[workType] || ITSM_SUMMARY_VARIANTS.Incident;
  const focus = ITSM_DESCRIPTION_FOCUS[workType] || ITSM_DESCRIPTION_FOCUS.Incident;
  const cycleNumber = sourceLength > 0 ? Math.floor(sourceIndex / sourceLength) : sourceIndex;

  if (cleanDescription && cycleNumber === 0) {
    return cleanDescription.slice(0, 1200);
  }

  const scenarioFocus = variants[sourceIndex % variants.length];
  const base = cleanDescription || `${workType} generated for ${title}.`;
  return `${base} Scenario focus: ${scenarioFocus}. ${focus}`.slice(0, 1200);
}

function buildItsmWorkItems(content, itsmWorkCounts = ITSM_WORK_COUNT_DEFAULTS) {
  const catalog = getItsmWorkTypeCatalog(content);
  const usedTitles = new Set();
  const requestedCounts = {
    Incident: itsmWorkCounts.incidentRequestsPerProject || 0,
    Problem: itsmWorkCounts.problemRequestsPerProject || 0,
    Change: itsmWorkCounts.changeRequestsPerProject || 0,
    'Service Request': itsmWorkCounts.serviceRequestsPerProject || 0,
    'Post-incident Review': itsmWorkCounts.postIncidentReviewsPerProject || 0,
  };

  return catalog.flatMap(workType => {
    const count = requestedCounts[workType.workType] || 0;

    return Array.from({ length: count }, (_, sourceIndex) => {
      const source = Array.isArray(workType.source) ? workType.source : [];
      const sourceLength = source.length;
      const template = sourceLength > 0 ? source[sourceIndex % sourceLength] || {} : {};
      const title = makeUniqueItsmSummary(template.title || workType.fallbackTitle, workType.workType, sourceIndex, sourceLength, usedTitles);

      return {
        ...workType,
        title,
        priority: template.priority || 'P3 - Medium',
        description: makeUniqueItsmDescription(template, title, workType.workType, sourceIndex, sourceLength),
      };
    });
  });
}

function getItsmWorkItem(content, index, itsmWorkCounts) {
  return buildItsmWorkItems(content, itsmWorkCounts)[index] || null;
}

async function ensureDefaultSoftwareWorkForm(projectKey, projectName, industry) {
  return {
    success: false,
    unsupported: true,
    message: `Software Project ${projectKey}: Jira Software project forms are not currently created by the supported Atlassian Forms REST API. The supported project-form API is for JSM projects, so the generated JSM Ops project receives forms automatically while the Software project's Forms tab must be created manually in Jira.`,
  };
}

async function createIncident(serviceDeskId, requestTypeId, title, priority, dueDate) {
  return await jiraPost('/rest/servicedeskapi/request', {
    serviceDeskId: String(serviceDeskId),
    requestTypeId: String(requestTypeId),
    requestFieldValues: {
      summary: title,
      description: {
        version: 1, type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: `Incident raised by operations team. Priority: ${priority}. Immediate attention required.` }],
        }],
      },
    },
  });
}

function chooseRequestTypeForItsmWork(project, workType) {
  const requestTypes = project.requestTypes || [];
  const normalisedWorkType = normaliseFieldName(workType);
  const findByPriority = keywords => {
    for (const keyword of keywords) {
      const match = requestTypes.find(requestType =>
        String(requestType?.name || '').toLowerCase().includes(keyword)
      );

      if (match) {
        return match;
      }
    }

    return null;
  };

  if (normalisedWorkType === 'incident') {
    return findByPriority(['report a system problem', 'incident', 'system problem', 'report broken hardware', 'broken hardware']);
  }

  if (normalisedWorkType === 'problem') {
    return findByPriority(['investigate a problem', 'problem']);
  }

  if (normalisedWorkType === 'change') {
    return findByPriority(['request a change', 'change']);
  }

  if (normalisedWorkType === 'servicerequest') {
    return findByPriority(['get it help', 'request new software', 'request new hardware', 'request admin access', 'request new account', 'request']);
  }

  if (normalisedWorkType === 'postincidentreview') {
    return findByPriority(['create a post-incident review', 'post-incident review', 'post incident review', 'review']);
  }

  return requestTypes[0] || null;
}

async function createJsmRequestWorkItem(project, workItem, options) {
  const diagnostics = options.diagnostics || [];
  const serviceDeskId = project.serviceDeskId || await getServiceDeskIdWithRetry(project.key, {
    attempts: 3,
    delayMs: 1000,
    diagnostics,
    label: 'ITSM work service desk lookup',
  });

  if (!serviceDeskId) {
    throw new Error(`Service desk id was not available for ${project.key}.`);
  }

  project.serviceDeskId = serviceDeskId;

  if (!project.requestTypes?.length) {
    const requestTypes = await getServiceDeskRequestTypes(serviceDeskId);
    project.requestTypes = requestTypes.map(requestType => ({
      id: requestType.id,
      name: requestType.name,
      issueTypeId: requestType.issueTypeId || null,
    }));
  }

  const requestType = chooseRequestTypeForItsmWork(project, workItem.workType);
  if (!requestType?.id) {
    throw new Error(`No matching JSM request type was available for ${workItem.workType}.`);
  }

  diagnostics.push(`ITSM work ${project.key}: creating ${workItem.workType} through request type "${requestType.name}".`);

  const createdRequest = await jiraPost('/rest/servicedeskapi/request', {
    serviceDeskId: String(serviceDeskId),
    requestTypeId: String(requestType.id),
    requestFieldValues: {
      summary: workItem.title,
      description: workItem.description || `${workItem.workType} generated for the ${project.key} demo environment. Priority: ${workItem.priority}. ${workItem.title}`,
    },
  });

  const issueKey = createdRequest.issueKey || createdRequest.issue?.key || createdRequest.issue?.issueKey || null;
  if (!issueKey) {
    throw new Error(`JSM request was created but Jira did not return an issue key for ${workItem.workType}.`);
  }

  return {
    key: issueKey,
    requestTypeId: requestType.id,
    requestTypeName: requestType.name,
  };
}

function normaliseSoftwareTemplate(value) {
  return String(value || '').toLowerCase() === 'kanban' ? 'kanban' : 'scrum';
}

function normaliseProjectManagementStyle(value) {
  return String(value || '').toLowerCase().includes('company') ? 'company-managed' : 'team-managed';
}

function getProjectManagementStyleLabel(value) {
  return normaliseProjectManagementStyle(value) === 'company-managed' ? 'Company-managed' : 'Team-managed';
}

function getSoftwareTemplateKeys(softwareTemplate, projectManagementStyle = 'team-managed') {
  const template = normaliseSoftwareTemplate(softwareTemplate);
  const style = normaliseProjectManagementStyle(projectManagementStyle);

  if (template === 'kanban' && style === 'company-managed') {
    return [
      'com.pyxis.greenhopper.jira:gh-kanban-template',
      'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',
    ];
  }

  if (template === 'kanban') {
    return [
      'com.pyxis.greenhopper.jira:gh-simplified-agility-kanban',
      'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic',
      'com.pyxis.greenhopper.jira:gh-kanban-template',
    ];
  }

  if (style === 'company-managed') {
    return [
      'com.pyxis.greenhopper.jira:gh-scrum-template',
      'com.pyxis.greenhopper.jira:gh-simplified-scrum-classic',
    ];
  }

  return [
    'com.pyxis.greenhopper.jira:gh-simplified-agility-scrum',
    'com.pyxis.greenhopper.jira:gh-simplified-scrum-classic',
    'com.pyxis.greenhopper.jira:gh-scrum-template',
  ];
}

async function createSoftwareProject(name, leadAccountId, keyPrefix, softwareTemplate, projectManagementStyle) {
  return await createProjectWithRetries({
    name,
    leadAccountId,
    keyPrefix,
    projectTypeKey: 'software',
    maxAttempts: 12,
    templateKeys: getSoftwareTemplateKeys(softwareTemplate, projectManagementStyle),
  });
}

async function createProjectWithRetries({ name, leadAccountId, keyPrefix, projectTypeKey, templateKeys, maxAttempts = 26, allowTemplateOmission = true, diagnostics = [] }) {
  const errors = [];
  // Atlassian's current Cloud examples still document project creation through
  // /rest/api/2/project, while /rest/api/3/project is also available on many
  // tenants. For JSM, try v2 first because that is the route Atlassian's service
  // management project examples most consistently document, then try v3 as a
  // second supported route before reporting a hard ITSM creation failure.
  const createProjectRequests = projectTypeKey === 'service_desk'
    ? [
        { path: '/rest/api/2/project', actor: 'user' },
      ]
    : [{ path: '/rest/api/3/project', actor: 'user' }];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidateKey = generateKey(keyPrefix, attempt);
    // JSM Ops must use the IT service management template specifically. Keep
    // this path intentionally narrow so the Forge resolver does not spend its
    // 25-second budget trying every service-desk variant when Jira rejects the
    // product type. We only retry with a new project key when Jira reports a
    // key collision.
    const templateAttempts = projectTypeKey === 'service_desk'
      ? templateKeys.slice(0, 1)
      : allowTemplateOmission ? [...templateKeys, null] : [...templateKeys];
    let keyCollisionForAttempt = false;

    for (const templateKey of templateAttempts) {
      let lastError = null;
      let sawTemplateError = false;
      let sawKeyCollision = false;
      let sawProjectTypeError = false;
      const baseBody = {
        name,
        key: candidateKey,
        leadAccountId,
        assigneeType: projectTypeKey === 'service_desk' ? 'PROJECT_LEAD' : 'UNASSIGNED',
      };

      if (projectTypeKey === 'service_desk') {
        baseBody.avatarId = 10200;
      }

      if (templateKey) {
        baseBody.projectTemplateKey = templateKey;
      }

      const bodyAttempts = projectTypeKey === 'service_desk' && templateKey
        ? [
            { label: 'explicit-service-desk-type', body: { ...baseBody, projectTypeKey } },
            { label: 'template-inferred-type', body: { ...baseBody } },
          ]
        : [{ label: 'explicit-project-type', body: { ...baseBody, projectTypeKey } }];

      for (const { label, body } of bodyAttempts) {
        for (const createProjectRequest of createProjectRequests) {
          try {
            return createProjectRequest.actor === 'app'
              ? await jiraAppPost(createProjectRequest.path, body)
              : await jiraPost(createProjectRequest.path, body);
          } catch (err) {
            lastError = err;
            const lowerMessage = String(err.message || '').toLowerCase();
            sawTemplateError = sawTemplateError || err.message.includes('project template specified does not exist');
            sawKeyCollision = sawKeyCollision || err.message.includes('"projectKey"') || lowerMessage.includes('uses this project key');
            sawProjectTypeError = sawProjectTypeError || lowerMessage.includes('invalid project type') || lowerMessage.includes('"projecttype"');
            errors.push(err.message);
            console.warn('Project create attempt failed', JSON.stringify({
              path: createProjectRequest.path,
              actor: createProjectRequest.actor,
              attempt: label,
              projectTypeKey: body.projectTypeKey || null,
              projectTemplateKey: templateKey || null,
              candidateKey,
              message: err.message,
            }));
          }
        }
      }

      if (sawKeyCollision) {
        keyCollisionForAttempt = true;
        break;
      }

      if (sawTemplateError) {
        continue;
      }

      if (sawProjectTypeError) {
        continue;
      }

      if (!templateKey && lastError) {
        throw lastError;
      }
    }

    if (projectTypeKey === 'service_desk' && !keyCollisionForAttempt) {
      break;
    }
  }

  const lastError = errors[errors.length - 1] || `Unable to create ${projectTypeKey} project.`;
  const recentErrors = errors.slice(-8);

  if (projectTypeKey === 'service_desk') {
    diagnostics.push(
      `JSM Project create attempts failed for IT service management template ${templateKeys[0] || 'UNKNOWN'}. Recent REST errors:`,
      ...recentErrors.map(error => `  ${error}`)
    );
  }

  throw new Error(projectTypeKey === 'service_desk'
    ? `Unable to create an IT Service Management project after trying the supported Jira project create endpoints with the IT service management template. Last error: ${lastError}`
    : lastError);
}

async function createVersion(projectId, name, releaseDate, released) {
  return await jiraPost('/rest/api/3/version', {
    projectId, name, releaseDate, released, archived: false,
  });
}

async function createEpic(projectKey, epicName, options = {}) {
  const dueDate = options.dueDate || null;
  const assigneeAccountId = options.assigneeAccountId || null;
  const lifecycle = options.lifecycle || null;
  const demoDateFields = options.demoDateFields || {};
  const priority = options.priority || null;
  const fields = {
    project: { key: projectKey },
    issuetype: { name: 'Epic' },
    summary: epicName,
  };

  // Epics are the first rows users tend to see in a new Jira list view. Setting
  // these normal board-visible fields makes the generated project look complete
  // even before the user expands or scrolls into the child stories and tasks.
  // We still set them again after creation because some Jira screens reject
  // optional fields during create, even though the same field can be edited later.
  if (dueDate) fields.duedate = dueDate;
  if (assigneeAccountId) fields.assignee = { accountId: assigneeAccountId };
  if (priority) fields.priority = { name: priority };
  Object.assign(fields, buildDemoDateFieldValues(demoDateFields, lifecycle));

  try {
    const epic = await jiraPost('/rest/api/3/issue', { fields });
    await saveLifecycleProperty(epic, options, lifecycle);
    await updateIssueDemoDateFields(epic.key, demoDateFields, lifecycle, options.diagnostics);
    await updateIssueBoardVisibleFields(epic.key, { assigneeAccountId, dueDate }, options.diagnostics);
    if (lifecycle?.targetStatus && lifecycle.targetStatus !== 'To Do') {
      await transitionIssue(epic.key, lifecycle.targetStatus);
    }
    return epic;
  } catch (err) {
    const lowerError = String(err?.message || '').toLowerCase();

    if (
      lowerError.includes('customfield') ||
      lowerError.includes('assignee') ||
      lowerError.includes('duedate') ||
      lowerError.includes('cannot be assigned issues') ||
      lowerError.includes('not on the appropriate screen')
    ) {
      const epic = await jiraPost('/rest/api/3/issue', { fields: removeOptionalIssueFields(fields) });
      await saveLifecycleProperty(epic, options, lifecycle);
      await updateIssueDemoDateFields(epic.key, demoDateFields, lifecycle, options.diagnostics);
      await updateIssueBoardVisibleFields(epic.key, { assigneeAccountId, dueDate }, options.diagnostics);
      if (lifecycle?.targetStatus && lifecycle.targetStatus !== 'To Do') {
        await transitionIssue(epic.key, lifecycle.targetStatus);
      }
      return epic;
    }

    throw err;
  }
}

async function getDemoDateFieldIds() {
  if (demoDateFieldIdsCache) {
    return demoDateFieldIdsCache;
  }

  const fields = await jiraGet('/rest/api/3/field');
  const result = {
    createdDateFieldId: null,
    resolvedDateFieldId: null,
  };

  for (const field of fields || []) {
    const normalisedName = normaliseFieldName(field.name);

    if (!isCustomDateField(field)) {
      continue;
    }

    if (!result.createdDateFieldId && normalisedName === 'createddate') {
      result.createdDateFieldId = field.id;
    }

    if (
      !result.resolvedDateFieldId &&
      (normalisedName === 'resolveddate' || normalisedName === 'resloveddate')
    ) {
      result.resolvedDateFieldId = field.id;
    }
  }

  demoDateFieldIdsCache = result;
  return result;
}

function collectCreateMetaFieldCandidates(issueTypes) {
  const byFieldId = new Map();

  for (const issueType of issueTypes || []) {
    const fields = issueType?.fields && typeof issueType.fields === 'object'
      ? issueType.fields
      : {};

    for (const [fieldKey, metadata] of Object.entries(fields)) {
      const fieldId = String(metadata?.fieldId || fieldKey || '').trim();
      if (!fieldId || byFieldId.has(fieldId)) {
        continue;
      }

      byFieldId.set(fieldId, {
        id: fieldId,
        key: fieldKey,
        name: metadata?.name || '',
        custom: fieldId.startsWith('customfield_'),
        schema: metadata?.schema || {},
      });
    }
  }

  return Array.from(byFieldId.values());
}

function mergeCreateMetaFieldCandidate(byFieldId, candidate) {
  const fieldId = String(candidate?.fieldId || candidate?.id || candidate?.key || '').trim();
  if (!fieldId || byFieldId.has(fieldId)) {
    return;
  }

  byFieldId.set(fieldId, {
    id: fieldId,
    key: candidate?.key || fieldId,
    name: candidate?.name || '',
    custom: fieldId.startsWith('customfield_'),
    schema: candidate?.schema || {},
  });
}

function isCreatedDateCustomFieldName(normalisedName) {
  return (
    normalisedName === 'createddate' ||
    normalisedName === 'createddt' ||
    (normalisedName.includes('created') && normalisedName.includes('date'))
  );
}

function isResolvedDateCustomFieldName(normalisedName) {
  return (
    normalisedName === 'resolveddate' ||
    normalisedName === 'resloveddate' ||
    normalisedName === 'resolutiondate' ||
    (normalisedName.includes('resolved') && normalisedName.includes('date')) ||
    (normalisedName.includes('resolution') && normalisedName.includes('date'))
  );
}

async function searchCustomFieldsByName(queryText) {
  const maxResults = 100;
  const data = await jiraGet(`/rest/api/3/field/search?type=custom&query=${encodeURIComponent(queryText)}&maxResults=${maxResults}`);
  const values = Array.isArray(data?.values)
    ? data.values
    : Array.isArray(data)
      ? data
      : [];

  return values.map(item => ({
    id: item?.id || item?.fieldId || item?.key,
    key: item?.key || item?.id,
    name: item?.name || '',
    custom: true,
    schema: item?.schema || {},
  }));
}

async function createGlobalDemoDateField(name, description) {
  return await jiraPost('/rest/api/3/field', {
    name,
    description,
    type: 'com.atlassian.jira.plugin.system.customfieldtypes:datepicker',
  });
}

async function ensureGlobalDemoDateFields(result, diagnostics = []) {
  const missingDefinitions = [];

  if (!result.createdDateFieldId) {
    missingDefinitions.push(DEMO_DATE_FIELD_DEFINITIONS.created);
  }

  if (!result.resolvedDateFieldId) {
    missingDefinitions.push(DEMO_DATE_FIELD_DEFINITIONS.resolved);
  }

  if (missingDefinitions.length === 0) {
    return;
  }

  diagnostics.push(`Date fields fallback: attempting global field creation for ${missingDefinitions.map(item => item.name).join(', ')}`);

  for (const definition of missingDefinitions) {
    try {
      const createdField = await createGlobalDemoDateField(definition.name, definition.description);
      diagnostics.push(`Date fields fallback: created global field "${definition.name}" (${createdField?.id || 'id unavailable'})`);
    } catch (err) {
      const message = String(err.message || '');
      const lower = message.toLowerCase();

      if (lower.includes('already exists') || lower.includes('a custom field with this name already exists')) {
        diagnostics.push(`Date fields fallback: global field "${definition.name}" already exists`);
      } else {
        diagnostics.push(`Date fields fallback: create failed for "${definition.name}": ${message}`);
      }
    }
  }

  // Clear global cache and retry lookups because Jira field indexing can lag.
  demoDateFieldIdsCache = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await wait(1200);
    }

    try {
      const globalFields = await getDemoDateFieldIds();
      if (!result.createdDateFieldId && globalFields.createdDateFieldId) {
        result.createdDateFieldId = globalFields.createdDateFieldId;
      }
      if (!result.resolvedDateFieldId && globalFields.resolvedDateFieldId) {
        result.resolvedDateFieldId = globalFields.resolvedDateFieldId;
      }
    } catch (err) {
      diagnostics.push(`Date fields fallback: global refresh attempt ${attempt + 1} failed: ${err.message}`);
    }

    if (result.createdDateFieldId && result.resolvedDateFieldId) {
      diagnostics.push(`Date fields fallback: resolved via global refresh on attempt ${attempt + 1}`);
      return;
    }

    try {
      const searchCandidates = [];
      searchCandidates.push(...await searchCustomFieldsByName(DEMO_DATE_FIELD_DEFINITIONS.created.name));
      searchCandidates.push(...await searchCustomFieldsByName(DEMO_DATE_FIELD_DEFINITIONS.resolved.name));
      applyDemoDateFieldMatches(result, searchCandidates, `field/search(post-create attempt ${attempt + 1})`, diagnostics);
    } catch (err) {
      diagnostics.push(`Date fields fallback: field/search refresh attempt ${attempt + 1} failed: ${err.message}`);
    }

    if (result.createdDateFieldId && result.resolvedDateFieldId) {
      diagnostics.push(`Date fields fallback: resolved via field/search on attempt ${attempt + 1}`);
      return;
    }
  }
}

async function getCreateMetaFieldsForIssueType(projectKey, issueTypeId) {
  const data = await jiraGet(`/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${encodeURIComponent(issueTypeId)}`);

  // Jira create-meta endpoints have returned multiple shapes across Cloud APIs:
  // array pages (values/results), object maps (fields), and direct arrays.
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.values)) {
    return data.values;
  }

  if (Array.isArray(data?.results)) {
    return data.results;
  }

  if (Array.isArray(data?.fields)) {
    return data.fields;
  }

  if (data?.fields && typeof data.fields === 'object') {
    return Object.entries(data.fields).map(([fieldKey, metadata]) => ({
      ...metadata,
      key: fieldKey,
      fieldId: metadata?.fieldId || fieldKey,
    }));
  }

  return [];
}

async function getProjectCreateMetaFieldCandidates(projectKey, issueTypes, diagnostics = []) {
  const byFieldId = new Map();

  for (const candidate of collectCreateMetaFieldCandidates(issueTypes)) {
    mergeCreateMetaFieldCandidate(byFieldId, candidate);
  }

  for (const issueType of issueTypes || []) {
    const issueTypeId = issueType?.id;
    if (!issueTypeId) {
      continue;
    }

    try {
      const fields = await getCreateMetaFieldsForIssueType(projectKey, issueTypeId);
      diagnostics.push(`Date fields source createmeta(${projectKey}) issueType ${issueTypeId} fields=${fields.length}`);

      for (const field of fields) {
        mergeCreateMetaFieldCandidate(byFieldId, field);
      }
    } catch (err) {
      diagnostics.push(`Date fields source createmeta(${projectKey}) issueType ${issueTypeId} failed: ${err.message}`);
    }
  }

  return Array.from(byFieldId.values());
}

function applyDemoDateFieldMatches(result, fields, sourceLabel, diagnostics = []) {
  for (const field of fields || []) {
    if (!isCustomDateField(field)) {
      continue;
    }

    const normalisedName = normaliseFieldName(field.name);
    const fieldId = String(field.id || field.key || '').trim();
    if (!fieldId) {
      continue;
    }

    if (!result.createdDateFieldId && isCreatedDateCustomFieldName(normalisedName)) {
      result.createdDateFieldId = fieldId;
      diagnostics.push(`Date fields source ${sourceLabel}: matched "${field.name}" -> ${fieldId} as Created Date`);
      continue;
    }

    if (!result.resolvedDateFieldId && isResolvedDateCustomFieldName(normalisedName)) {
      result.resolvedDateFieldId = fieldId;
      diagnostics.push(`Date fields source ${sourceLabel}: matched "${field.name}" -> ${fieldId} as Resolved Date`);
    }
  }
}

async function getProjectDemoDateFieldIds(projectKey, diagnostics = []) {
  if (demoDateFieldsByProjectCache.has(projectKey)) {
    return demoDateFieldsByProjectCache.get(projectKey);
  }

  const result = {
    createdDateFieldId: null,
    resolvedDateFieldId: null,
  };

  try {
    const globalFields = await getDemoDateFieldIds();
    result.createdDateFieldId = globalFields.createdDateFieldId || null;
    result.resolvedDateFieldId = globalFields.resolvedDateFieldId || null;
    diagnostics.push(
      `Date fields source global(/field): created=${result.createdDateFieldId || 'NOT_FOUND'}, resolved=${result.resolvedDateFieldId || 'NOT_FOUND'}`
    );
  } catch (err) {
    diagnostics.push(`Date fields source global(/field) lookup failed: ${err.message}`);
  }

  if (!result.createdDateFieldId || !result.resolvedDateFieldId) {
    try {
      const projectFieldData = await jiraGet(`/rest/api/3/project/${encodeURIComponent(projectKey)}/fields`);
      const projectFields = Array.isArray(projectFieldData?.values)
        ? projectFieldData.values
        : Array.isArray(projectFieldData)
          ? projectFieldData
          : [];
      applyDemoDateFieldMatches(result, projectFields, `project(${projectKey})/fields`, diagnostics);
    } catch (err) {
      diagnostics.push(`Date fields source project(${projectKey})/fields lookup failed: ${err.message}`);
    }
  }

  if (!result.createdDateFieldId || !result.resolvedDateFieldId) {
    try {
      const issueTypes = await getCreatableIssueTypes(projectKey);
      const createMetaFields = await getProjectCreateMetaFieldCandidates(projectKey, issueTypes, diagnostics);
      diagnostics.push(`Date fields source createmeta(${projectKey}) total candidates=${createMetaFields.length}`);
      applyDemoDateFieldMatches(result, createMetaFields, `createmeta(${projectKey})`, diagnostics);
    } catch (err) {
      diagnostics.push(`Date fields source createmeta(${projectKey}) lookup failed: ${err.message}`);
    }
  }

  if (!result.createdDateFieldId || !result.resolvedDateFieldId) {
    try {
      const searchCandidates = [];
      searchCandidates.push(...await searchCustomFieldsByName('Created Date'));
      searchCandidates.push(...await searchCustomFieldsByName('Resolved Date'));
      diagnostics.push(`Date fields source field/search candidates=${searchCandidates.length}`);
      applyDemoDateFieldMatches(result, searchCandidates, 'field/search', diagnostics);
    } catch (err) {
      diagnostics.push(`Date fields source field/search lookup failed: ${err.message}`);
    }
  }

  if (!result.createdDateFieldId || !result.resolvedDateFieldId) {
    await ensureGlobalDemoDateFields(result, diagnostics);
  }

  diagnostics.push(
    `Date fields final resolution for ${projectKey}: created=${result.createdDateFieldId || 'NOT_FOUND'}, resolved=${result.resolvedDateFieldId || 'NOT_FOUND'}`
  );

  demoDateFieldsByProjectCache.set(projectKey, result);
  return result;
}

async function getProjectIssueTypeScreenSchemeId(projectId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const data = await jiraGet(`/rest/api/3/issuetypescreenscheme/project?projectId=${encodeURIComponent(projectId)}`);
    const issueTypeScreenSchemeId = data.values?.[0]?.issueTypeScreenScheme?.id || null;

    if (issueTypeScreenSchemeId) {
      return issueTypeScreenSchemeId;
    }

    await wait(1500);
  }

  return null;
}

async function getScreenSchemeIdsForIssueTypeScreenScheme(issueTypeScreenSchemeId) {
  const data = await jiraGet(`/rest/api/3/issuetypescreenscheme/mapping?issueTypeScreenSchemeId=${encodeURIComponent(issueTypeScreenSchemeId)}&maxResults=100`);
  const ids = new Set();

  for (const mapping of data.values || []) {
    if (mapping.screenSchemeId) {
      ids.add(String(mapping.screenSchemeId));
    }
  }

  return Array.from(ids);
}

async function getScreenIdsForScreenSchemes(screenSchemeIds) {
  if (screenSchemeIds.length === 0) {
    return [];
  }

  const wantedIds = new Set(screenSchemeIds.map(String));
  const screenIds = new Set();
  const matchedSchemeIds = new Set();

  const collectScreensFromScheme = (screenScheme) => {
    if (!screenScheme) {
      return;
    }

    const schemeId = String(screenScheme.id || '');
    if (!schemeId) {
      return;
    }

    matchedSchemeIds.add(schemeId);

    // Jira screen schemes can have operation-specific screens. Adding the demo
    // date fields to every operation screen makes create, edit, and view flows
    // work for whichever issue type the generated project uses.
    for (const screenId of Object.values(screenScheme.screens || {})) {
      if (screenId) {
        screenIds.add(String(screenId));
      }
    }
  };

  // First pass: scan paginated list endpoint.
  let startAt = 0;
  const maxResults = 100;
  for (let page = 0; page < 25; page++) {
    const data = await jiraGet(`/rest/api/3/screenscheme?startAt=${startAt}&maxResults=${maxResults}`);
    const values = Array.isArray(data.values) ? data.values : [];

    for (const screenScheme of values) {
      if (!wantedIds.has(String(screenScheme.id))) {
        continue;
      }
      collectScreensFromScheme(screenScheme);
    }

    if (data.isLast || values.length === 0) {
      break;
    }

    startAt += values.length;
  }

  // Fallback: fetch each missing screen scheme directly by ID.
  for (const screenSchemeId of wantedIds) {
    if (matchedSchemeIds.has(screenSchemeId)) {
      continue;
    }

    try {
      const screenScheme = await jiraGet(`/rest/api/3/screenscheme/${encodeURIComponent(screenSchemeId)}`);
      collectScreensFromScheme(screenScheme);
    } catch (err) {
      // Keep lookup resilient. The caller already reports a high-level screen
      // discovery failure when no screen IDs can be resolved.
    }
  }

  return Array.from(screenIds);
}

async function findProjectScreenIdsByName(projectKey) {
  const screenIds = new Set();
  const data = await jiraGet(`/rest/api/3/screens?query=${encodeURIComponent(projectKey)}&maxResults=1000`);

  for (const screen of data.values || []) {
    const screenName = String(screen.name || '').toLowerCase();

    if (!screen.id || !screenName.includes(projectKey.toLowerCase())) {
      continue;
    }

    if (
      screenName.includes('create issue screen') ||
      screenName.includes('edit/view issue screen') ||
      screenName.includes('view issue') ||
      screenName.includes('default issue screen') ||
      screenName.includes('bug screen') ||
      screenName.includes('resolve issue screen')
    ) {
      screenIds.add(String(screen.id));
    }
  }

  return Array.from(screenIds);
}

async function getProjectFieldConfigurationSchemeId(projectId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const data = await jiraGet(`/rest/api/3/fieldconfigurationscheme/project?projectId=${encodeURIComponent(projectId)}`);
    const scheme = (data.values || []).find(item => (item.projectIds || []).map(String).includes(String(projectId)));
    const schemeId = scheme?.fieldConfigurationScheme?.id || null;

    if (schemeId) {
      return schemeId;
    }

    // Jira omits fieldConfigurationScheme for projects using the default field
    // configuration scheme. In that case there is no project-specific scheme ID
    // to follow, so the caller can fall back to the global default configuration.
    if ((data.values || []).some(item => (item.projectIds || []).map(String).includes(String(projectId)))) {
      return null;
    }

    await wait(1500);
  }

  return null;
}

async function getDefaultFieldConfigurationId() {
  const data = await jiraGet('/rest/api/3/fieldconfiguration?maxResults=100');
  const defaultConfiguration = (data.values || []).find(configuration =>
    configuration.isDefault ||
    String(configuration.name || '').toLowerCase() === 'default field configuration'
  );
  return defaultConfiguration?.id ? String(defaultConfiguration.id) : null;
}

async function getFieldConfigurationIdsForProject(projectId) {
  const fieldConfigurationSchemeId = await getProjectFieldConfigurationSchemeId(projectId);

  if (!fieldConfigurationSchemeId) {
    const defaultFieldConfigurationId = await getDefaultFieldConfigurationId();
    return defaultFieldConfigurationId ? [defaultFieldConfigurationId] : [];
  }

  const data = await jiraGet(`/rest/api/3/fieldconfigurationscheme/mapping?fieldConfigurationSchemeId=${encodeURIComponent(fieldConfigurationSchemeId)}&maxResults=100`);
  const ids = new Set();

  for (const mapping of data.values || []) {
    if (mapping.fieldConfigurationId) {
      ids.add(String(mapping.fieldConfigurationId));
    }
  }

  return Array.from(ids);
}

async function showFieldsInFieldConfigurations(projectId, fieldIds) {
  const fieldConfigurationIds = await getFieldConfigurationIdsForProject(projectId);

  for (const fieldConfigurationId of fieldConfigurationIds) {
    await jiraPut(`/rest/api/3/fieldconfiguration/${encodeURIComponent(fieldConfigurationId)}/fields`, {
      fieldConfigurationItems: fieldIds.map(fieldId => ({
        id: fieldId,
        isHidden: false,
        isRequired: false,
      })),
    });
  }

  return fieldConfigurationIds.length;
}

async function getPrimaryScreenTabId(screenId) {
  const tabs = await jiraGet(`/rest/api/3/screens/${encodeURIComponent(screenId)}/tabs`);
  const preferredTab = (tabs || []).find(tab => ['field tab', 'general', 'default'].includes(String(tab.name || '').toLowerCase()));
  return (preferredTab || tabs?.[0])?.id || null;
}

async function addFieldToScreenTab(screenId, tabId, fieldId) {
  try {
    await jiraPost(`/rest/api/3/screens/${encodeURIComponent(screenId)}/tabs/${encodeURIComponent(tabId)}/fields`, {
      fieldId,
    });
  } catch (err) {
    const message = err.message.toLowerCase();

    // Jira returns a validation error when the field is already present. That
    // is the desired end state, so this branch keeps reruns idempotent.
    if (message.includes('already') || message.includes('exists')) {
      return;
    }

    throw err;
  }
}

async function ensureDemoDateFieldsOnProjectScreens(projectId, projectKey) {
  const diagnostics = [];
  const addDiagnostic = message => {
    const line = `Date fields ${projectKey}: ${message}`;
    console.log(`DEMO_DATE_DIAGNOSTIC ${line}`);
    diagnostics.push(line);
  };

  addDiagnostic(`starting setup for projectId=${projectId}`);

  const demoDateFields = await getProjectDemoDateFieldIds(projectKey, diagnostics);
  const fieldIds = [
    demoDateFields.createdDateFieldId,
    demoDateFields.resolvedDateFieldId,
  ].filter(Boolean);
  const boardVisibleScreenFieldIds = ['assignee', 'duedate'];

  addDiagnostic(`field lookup result createdDateFieldId=${demoDateFields.createdDateFieldId || 'NOT_FOUND'}, resolvedDateFieldId=${demoDateFields.resolvedDateFieldId || 'NOT_FOUND'}`);

  if (fieldIds.length === 0) {
    return {
      success: false,
      message: 'Could not find custom fields named "Created date" and/or "Resolved Date".',
      demoDateFields,
      diagnostics,
    };
  }

  let fieldConfigurationCount = 0;
  try {
    fieldConfigurationCount = await showFieldsInFieldConfigurations(projectId, fieldIds);
    addDiagnostic(`field configuration update completed for ${fieldConfigurationCount} configuration(s)`);
  } catch (err) {
    addDiagnostic(`field configuration update failed: ${err.message}`);
    return {
      success: false,
      message: `Could not show demo date fields in the field configuration: ${err.message}`,
      demoDateFields,
      diagnostics,
    };
  }

  let issueTypeScreenSchemeId;
  try {
    issueTypeScreenSchemeId = await getProjectIssueTypeScreenSchemeId(projectId);
    addDiagnostic(`issue type screen scheme id=${issueTypeScreenSchemeId || 'NOT_FOUND'}`);
  } catch (err) {
    addDiagnostic(`issue type screen scheme lookup failed: ${err.message}`);
    return {
      success: false,
      message: `Could not look up the issue type screen scheme: ${err.message}`,
      demoDateFields,
      diagnostics,
    };
  }

  let screenSchemeIds = [];
  let schemeScreenIds = [];
  let namedScreenIds = [];
  try {
    if (issueTypeScreenSchemeId) {
      screenSchemeIds = await getScreenSchemeIdsForIssueTypeScreenScheme(issueTypeScreenSchemeId);
      schemeScreenIds = await getScreenIdsForScreenSchemes(screenSchemeIds);
    } else {
      addDiagnostic('issue type screen scheme not available; falling back to project-named screens and post-create field updates');
    }
    namedScreenIds = await findProjectScreenIdsByName(projectKey);
    addDiagnostic(`screen scheme ids=${screenSchemeIds.join(',') || 'NONE'}`);
    addDiagnostic(`screens from schemes=${schemeScreenIds.join(',') || 'NONE'}`);
    addDiagnostic(`screens found by project key=${namedScreenIds.join(',') || 'NONE'}`);
  } catch (err) {
    addDiagnostic(`screen lookup failed: ${err.message}`);
    return {
      success: false,
      message: `Could not look up project screens: ${err.message}`,
      demoDateFields,
      diagnostics,
    };
  }

  const screenIds = Array.from(new Set([...schemeScreenIds, ...namedScreenIds]));
  addDiagnostic(`final screen ids to update=${screenIds.join(',') || 'NONE'}`);

  if (screenIds.length === 0) {
    return {
      success: true,
      screenCount: 0,
      fieldConfigurationCount,
      fieldCount: fieldIds.length,
      message: `No classic create/edit/view screens were found for ${projectKey}; demo dates will be written after issue creation with screen override.`,
      demoDateFields,
      diagnostics,
    };
  }

  const addFailures = [];
  for (const screenId of screenIds) {
    let tabId;
    try {
      tabId = await getPrimaryScreenTabId(screenId);
      addDiagnostic(`screen ${screenId} primary tab=${tabId || 'NOT_FOUND'}`);
    } catch (err) {
      addFailures.push(`screen ${screenId} tab lookup failed: ${err.message}`);
      addDiagnostic(`screen ${screenId} tab lookup failed: ${err.message}`);
      continue;
    }

    if (!tabId) {
      addFailures.push(`screen ${screenId} has no tab`);
      continue;
    }

    for (const fieldId of [...fieldIds, ...boardVisibleScreenFieldIds]) {
      try {
        await addFieldToScreenTab(screenId, tabId, fieldId);
        addDiagnostic(`field ${fieldId} added or already present on screen ${screenId}, tab ${tabId}`);
      } catch (err) {
        addFailures.push(`field ${fieldId} -> screen ${screenId}: ${err.message}`);
        addDiagnostic(`field ${fieldId} failed on screen ${screenId}, tab ${tabId}: ${err.message}`);
      }
    }
  }

  if (addFailures.length > 0) {
    return {
      success: false,
      message: `Could not add all demo date fields to screens: ${addFailures.join('; ')}`,
      demoDateFields,
      diagnostics,
    };
  }

  return {
    success: true,
    screenCount: screenIds.length,
    fieldConfigurationCount,
    fieldCount: fieldIds.length,
    demoDateFields,
    diagnostics,
  };
}

async function getAssignableUsers(projectKey, fallbackAccountId) {
  if (assignableUsersByProjectCache.has(projectKey)) {
    return assignableUsersByProjectCache.get(projectKey);
  }

  try {
    // Prefer Jira's project-assignable directory so generated assignees are
    // valid for this specific project.
    let accountIds = await getProjectAssignableAccountIds(projectKey);

    // Newly-created demo projects often expose only the project creator as
    // assignable. For richer demos, add a handful of active humans from the
    // site into the project's contributor-style roles, then re-check Jira's
    // assignable directory so we still only use users Jira accepts.
    if (accountIds.length < 2) {
      await ensureProjectHasDemoAssignableUsers(projectKey, fallbackAccountId);
      accountIds = await getProjectAssignableAccountIds(projectKey);
    }

    if (accountIds.length < 2) {
      accountIds = mergeUniqueAccountIds(accountIds, await getActiveHumanAccountIds());
    }

    if (accountIds.length === 0 && fallbackAccountId) {
      accountIds.push(fallbackAccountId);
    }

    assignableUsersByProjectCache.set(projectKey, accountIds);
    return accountIds;
  } catch (err) {
    console.warn(`Assignable user lookup failed for ${projectKey}: ${err.message}`);
    const fallbackUsers = fallbackAccountId ? [fallbackAccountId] : [];
    assignableUsersByProjectCache.set(projectKey, fallbackUsers);
    return fallbackUsers;
  }
}

async function getProjectAssignableAccountIds(projectKey) {
  const assignable = await jiraGet(`/rest/api/3/user/assignable/search?project=${encodeURIComponent(projectKey)}&maxResults=1000`);
  return mergeUniqueAccountIds((assignable || [])
    .filter(isActiveHumanUser)
    .map(user => user.accountId));
}

async function getActiveHumanAccountIds() {
  const users = await jiraGet('/rest/api/3/users/search?maxResults=1000');
  return mergeUniqueAccountIds((users || [])
    .filter(isActiveHumanUser)
    .map(user => user.accountId));
}

function mergeUniqueAccountIds(...accountIdLists) {
  return Array.from(new Set(
    accountIdLists
      .flat()
      .filter(Boolean)
      .map(accountId => String(accountId))
  ));
}

async function ensureProjectHasDemoAssignableUsers(projectKey, fallbackAccountId) {
  const activeUsers = await getActiveHumanAccountIds();
  const demoUsers = mergeUniqueAccountIds(
    activeUsers.filter(accountId => accountId !== fallbackAccountId),
    fallbackAccountId ? [fallbackAccountId] : []
  ).slice(0, 8);

  if (demoUsers.length < 2) {
    return;
  }

  try {
    const projectRoles = await jiraGet(`/rest/api/3/project/${encodeURIComponent(projectKey)}/role`);
    const roleTargets = Object.entries(projectRoles || {})
      .map(([name, roleUrl]) => ({
        name,
        id: String(roleUrl || '').match(/\/role\/(\d+)(?:\?|$)/)?.[1],
      }))
      .filter(role => role.id && isDemoAssignableRoleName(role.name));

    for (const role of roleTargets) {
      try {
        // Project role membership is the standard way to make users eligible
        // for project permissions such as Assignable User. This is best-effort:
        // if a tenant has custom permission schemes, the later assignable-user
        // recheck remains the source of truth.
        await jiraPost(`/rest/api/3/project/${encodeURIComponent(projectKey)}/role/${encodeURIComponent(role.id)}`, {
          user: demoUsers,
        });
      } catch (err) {
        console.warn(`Could not add demo users to project role ${role.name} for ${projectKey}: ${err.message}`);
      }
    }

    if (roleTargets.length > 0) {
      await wait(1200);
    }
  } catch (err) {
    console.warn(`Could not prepare demo assignable users for ${projectKey}: ${err.message}`);
  }
}

function isDemoAssignableRoleName(roleName) {
  const normalised = normaliseFieldName(roleName);
  return [
    'servicedeskteam',
    'developers',
    'members',
    'users',
  ].some(candidate => normalised.includes(candidate));
}

function chooseDemoAssigneeAccountId(assignableUsers, itemIndex, projectIndex) {
  if (!Array.isArray(assignableUsers) || assignableUsers.length === 0) {
    return null;
  }

  // Leave a small, predictable slice unassigned so queues look realistic. The
  // pattern deliberately keeps the first few generated rows assigned, then
  // leaves roughly one in five open for triage rather than making a whole demo
  // project look abandoned.
  if ((itemIndex + projectIndex) % 5 === 3) {
    return null;
  }

  const assigneeIndex = buildRealisticAssigneeIndex(itemIndex, projectIndex, assignableUsers.length);
  return assignableUsers[assigneeIndex] || null;
}

function isActiveHumanUser(user) {
  if (!user?.accountId) {
    return false;
  }

  if (user.active !== true) {
    return false;
  }

  if (user.accountType && user.accountType !== 'atlassian') {
    return false;
  }

  const searchableText = [
    user.displayName,
    user.emailAddress,
    user.name,
  ].filter(Boolean).join(' ').toLowerCase();

  return ![
    ' bot',
    '-bot',
    '_bot',
    'no bot',
    'automation',
    'bitbucket',
    'pipeline',
    'provision',
    'service account',
    'svc-',
  ].some(marker => searchableText.includes(marker));
}

async function getCreatableIssueTypes(projectKey) {
  if (projectIssueTypeCache.has(projectKey)) {
    return projectIssueTypeCache.get(projectKey);
  }

  const data = await jiraGet(`/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`);
  const issueTypes = Array.isArray(data.issueTypes) ? data.issueTypes : [];
  projectIssueTypeCache.set(projectKey, issueTypes);
  return issueTypes;
}

function chooseFallbackIssueType(issueTypes, preferredTypeName) {
  const byLowerName = new Map(
    issueTypes
      .filter(issueType => issueType?.name)
      .map(issueType => [issueType.name.toLowerCase(), issueType])
  );
  const lowerPreferred = String(preferredTypeName || '').toLowerCase();
  const containsAny = keywords => issueTypes.find(issueType => {
    const name = String(issueType?.name || '').toLowerCase();
    return keywords.some(keyword => name.includes(keyword));
  });

  const preferredNames = [
    preferredTypeName,
    preferredTypeName === 'Bug' ? 'Task' : null,
    preferredTypeName === 'Story' ? 'Task' : null,
    lowerPreferred === 'incident' ? 'Report a system problem' : null,
    lowerPreferred === 'problem' ? 'Investigate a problem' : null,
    lowerPreferred === 'change' ? 'Request a change' : null,
    lowerPreferred === 'service request' ? 'Get IT help' : null,
    'Bug',
    'Task',
    'Story',
    'Work item',
    'Issue',
  ].filter(Boolean);

  for (const candidateName of preferredNames) {
    const candidate = byLowerName.get(candidateName.toLowerCase());
    if (candidate) {
      return candidate;
    }
  }

  if (lowerPreferred === 'incident') {
    return containsAny(['incident', 'report a system problem', 'system problem', 'it help', 'support']);
  }

  if (lowerPreferred === 'problem') {
    return containsAny(['problem', 'investigate']);
  }

  if (lowerPreferred === 'change') {
    return containsAny(['change']);
  }

  if (lowerPreferred === 'service request') {
    return containsAny(['service request', 'request', 'get it help', 'help']);
  }

  return issueTypes[0] || null;
}

async function setIssueProperty(issueKey, propertyKey, value) {
  await jiraPut(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/properties/${encodeURIComponent(propertyKey)}`, value);
}

function removeOptionalIssueFields(fields) {
  const safeFields = { ...fields };

  delete safeFields.assignee;
  delete safeFields.duedate;
  delete safeFields.customfield_10014;
  delete safeFields.fixVersions;
  delete safeFields.versions;
  delete safeFields.components;
  delete safeFields.labels;

  for (const fieldKey of Object.keys(safeFields)) {
    if (fieldKey.startsWith('customfield_')) {
      delete safeFields[fieldKey];
    }
  }

  return safeFields;
}

async function saveLifecycleProperty(issue, options, lifecycle) {
  if (!lifecycle || !issue?.key) {
    return;
  }

  await setIssueProperty(issue.key, TICKET_RETENTION_PROPERTY, createTicketProperty({
    environmentName: options.environmentName,
    retentionPeriodDays: options.retentionPeriodDays,
    archiveRetentionDays: ARCHIVE_RETENTION_DAYS,
    lifecycle,
    projectKind: options.projectKind,
  }));
}

function buildDemoDateFieldValues(demoDateFields, lifecycle) {
  const values = {};
  const createdDate = lifecycle?.createdAt ? toJiraDateOnly(lifecycle.createdAt) : null;
  const resolvedDate = lifecycle ? getDemoResolvedDate(lifecycle) : null;

  if (demoDateFields?.createdDateFieldId && createdDate) {
    values[demoDateFields.createdDateFieldId] = createdDate;
  }

  if (demoDateFields?.resolvedDateFieldId && resolvedDate) {
    values[demoDateFields.resolvedDateFieldId] = resolvedDate;
  }

  return values;
}

function getDemoResolvedDate(lifecycle) {
  if (!lifecycle?.createdAt) {
    return null;
  }

  const createdAt = new Date(lifecycle.createdAt);
  const now = new Date();
  const targetStatus = lifecycle.targetStatus || '';

  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }

  if (isDoneLikeStatus(targetStatus)) {
    if (lifecycle.resolutionDate) {
      return toJiraDateOnly(lifecycle.resolutionDate);
    }

    const updatedAt = lifecycle.updatedAt ? new Date(lifecycle.updatedAt) : now;
    return toJiraDateOnly(updatedAt > now ? now : updatedAt);
  }

  // The custom "Resolved Date" field is demo metadata, not Jira's system
  // resolution date. For open work, use a forecast date in the future so the
  // generated data tells the same story as the Jira status.
  return toJiraDateOnly(addDays(now, getForecastResolutionOffsetDays(lifecycle)));
}

function getForecastResolutionOffsetDays(lifecycle) {
  const normalisedStatus = normaliseStatusName(lifecycle?.targetStatus);
  const ageDays = Math.max(1, Number.parseInt(lifecycle?.ageDays, 10) || 1);

  if (normalisedStatus.includes('review')) {
    return 1 + (ageDays % 7);
  }

  if (normalisedStatus.includes('progress')) {
    return 3 + (ageDays % 18);
  }

  return 10 + (ageDays % 45);
}

function isDoneLikeStatus(value) {
  const normalised = normaliseStatusName(value);
  return ['resolved', 'rejected', 'done', 'closed', 'complete', 'completed'].includes(normalised);
}

function ensureResolvedLifecycleForStatus(lifecycle, status) {
  if (!lifecycle) {
    return lifecycle;
  }

  if (!isDoneLikeStatus(status)) {
    return {
      ...lifecycle,
      targetStatus: status || lifecycle.targetStatus,
      resolutionDate: null,
    };
  }

  if (lifecycle.resolutionDate) {
    return {
      ...lifecycle,
      targetStatus: status || lifecycle.targetStatus,
    };
  }

  return {
    ...lifecycle,
    targetStatus: status || lifecycle.targetStatus,
    resolutionDate: lifecycle.updatedAt || new Date().toISOString(),
  };
}

async function updateIssueDemoDateFields(issueKey, demoDateFields, lifecycle, diagnostics = []) {
  const fields = buildDemoDateFieldValues(demoDateFields, lifecycle);

  if (Object.keys(fields).length === 0) {
    return;
  }

  try {
    // The normal edit path is preferred because the app already adds the demo
    // fields to the project screens before creating issues. Passing Jira's
    // override flags unnecessarily can cause a 403 even for admin users.
    await jiraPut(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?notifyUsers=false`, { fields });
    diagnostics.push(`Date fields ${issueKey}: updated ${Object.keys(fields).join(', ')}`);
    return;
  } catch (normalErr) {
    try {
      // Some team-managed projects do not expose classic screens consistently.
      // In those cases, retry with Jira's admin override. This is only a
      // fallback because some tenants reject the override flags for Forge calls.
      await jiraPut(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}?notifyUsers=false&overrideScreenSecurity=true&overrideEditableFlag=true`,
        { fields }
      );
      diagnostics.push(`Date fields ${issueKey}: updated with screen override ${Object.keys(fields).join(', ')}`);
    } catch (overrideErr) {
      const message = `Date fields ${issueKey}: update failed. Normal update: ${normalErr.message}. Override update: ${overrideErr.message}`;
      diagnostics.push(message);
      console.warn(message);
    }
  }
}

async function updateIssueBoardVisibleFields(issueKey, { assigneeAccountId, dueDate }, diagnostics = []) {
  if (dueDate) {
    try {
      // Due date is a standard Jira field and is shown directly in Software
      // board/list views when the project exposes it. We set it after creation
      // as well because fallback issue creation can drop optional fields.
      await jiraPut(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?notifyUsers=false`, {
        fields: {
          duedate: dueDate,
        },
      });
      diagnostics.push(`Board fields ${issueKey}: due date set to ${dueDate}`);
    } catch (err) {
      const message = `Board fields ${issueKey}: due date update failed: ${err.message}`;
      diagnostics.push(message);
      console.warn(message);
    }
  }

  if (assigneeAccountId) {
    try {
      // Assignees come from Jira's project-assignable user directory. Updating
      // separately keeps a tenant-specific assignee rejection from also losing
      // due date or demo date values.
      await jiraPut(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?notifyUsers=false`, {
        fields: {
          assignee: { accountId: assigneeAccountId },
        },
      });
      diagnostics.push(`Board fields ${issueKey}: assignee set`);
    } catch (err) {
      const message = `Board fields ${issueKey}: assignee update failed: ${err.message}`;
      diagnostics.push(message);
      console.warn(message);
    }
  }
}

async function createIssue(projectKey, title, type, epicKey, priority, dueDate, versionId, options = {}) {
  const lifecycle = options.lifecycle || null;
  const demoDateFields = options.demoDateFields || {};
  const assigneeAccountId = options.assigneeAccountId || null;
  const descriptionLines = options.description
    ? [
        String(options.description),
        `Priority: ${priority}. Due date: ${dueDate || 'not set'}.`,
        'This record was generated for the demo environment and should align with the selected business domain.',
      ]
    : [
        `This ${type.toLowerCase()} is part of the ${projectKey} project.`,
        `${title}. This work item represents realistic work the engineering team would undertake.`,
        'Acceptance criteria to be defined during sprint planning.',
      ];
  const fields = {
    project: { key: projectKey },
    issuetype: { name: type },
    summary: title,
    description: buildADF(descriptionLines),
    priority: { name: priority },
    duedate: dueDate,
  };

  // Only set the epic link. We intentionally avoid setting the sprint custom
  // field during issue creation because Jira Software manages sprint membership
  // through the Agile API after the issue exists.
  if (epicKey && !options.skipEpicLink) fields.customfield_10014 = epicKey;
  if (versionId) fields.fixVersions = [{ id: String(versionId) }];
  if (options.affectsVersionId) fields.versions = [{ id: String(options.affectsVersionId) }];
  if (Array.isArray(options.labels) && options.labels.length > 0) fields.labels = options.labels;
  if (Array.isArray(options.components) && options.components.length > 0) {
    fields.components = options.components.map(component => ({ name: String(component) }));
  }
  if (assigneeAccountId) fields.assignee = { accountId: assigneeAccountId };

  // These are customer-created date fields, not Jira's immutable system Created
  // and Resolved fields. If the site exposes "Created date" and "Resolved Date"
  // on the create screen, the generated dates appear directly in those columns.
  Object.assign(fields, buildDemoDateFieldValues(demoDateFields, lifecycle));

  console.log('DEMO_DATE_DIAGNOSTIC issue create date field payload', JSON.stringify({
    projectKey,
    title,
    createdDateFieldId: demoDateFields.createdDateFieldId || null,
    createdDateValue: demoDateFields.createdDateFieldId ? fields[demoDateFields.createdDateFieldId] || null : null,
    resolvedDateFieldId: demoDateFields.resolvedDateFieldId || null,
    resolvedDateValue: demoDateFields.resolvedDateFieldId ? fields[demoDateFields.resolvedDateFieldId] || null : null,
  }));

  try {
    const issue = await jiraPost('/rest/api/3/issue', { fields });
    console.log('DEMO_DATE_DIAGNOSTIC issue created with optional date fields intact', JSON.stringify({
      issueKey: issue.key,
      projectKey,
    }));
    await saveLifecycleProperty(issue, options, lifecycle);
    await updateIssueDemoDateFields(issue.key, demoDateFields, lifecycle, options.diagnostics);
    await updateIssueBoardVisibleFields(issue.key, { assigneeAccountId, dueDate }, options.diagnostics);
    return issue;
  } catch (err) {
    const errorMessage = String(err?.message || '');
    const lowerError = errorMessage.toLowerCase();

    // Business-style projects often do not expose Bug/Story, while software projects do.
    // We inspect the project's create metadata and retry with the closest valid type so
    // the demo data still gets created instead of failing the whole run.
    if (
      lowerError.includes('the issue type selected is invalid') ||
      lowerError.includes('specify a valid issue type') ||
      lowerError.includes('"issuetype"')
    ) {
      const issueTypes = await getCreatableIssueTypes(projectKey);
      const fallbackIssueType = chooseFallbackIssueType(issueTypes, type);

      if (!fallbackIssueType) {
        throw err;
      }

      const retryFields = {
        ...fields,
        issuetype: fallbackIssueType.id
          ? { id: String(fallbackIssueType.id) }
          : { name: fallbackIssueType.name },
      };

      const issue = await jiraPost('/rest/api/3/issue', { fields: retryFields });
      console.log('DEMO_DATE_DIAGNOSTIC issue created after issue-type fallback', JSON.stringify({
        issueKey: issue.key,
        projectKey,
        fallbackIssueType: fallbackIssueType.name || fallbackIssueType.id,
      }));
      await saveLifecycleProperty(issue, options, lifecycle);
      await updateIssueDemoDateFields(issue.key, demoDateFields, lifecycle, options.diagnostics);
      await updateIssueBoardVisibleFields(issue.key, { assigneeAccountId, dueDate }, options.diagnostics);
      return issue;
    }

    // Some customer screens do not allow setting optional fields at creation
    // time. We retry once with the required fields, then keep the lifecycle in
    // an issue property so reporting still has the generated date data.
    if (
      lowerError.includes('customfield') ||
      lowerError.includes('assignee') ||
      lowerError.includes('duedate') ||
      lowerError.includes('cannot be assigned issues') ||
      lowerError.includes('fixversions') ||
      lowerError.includes('versions') ||
      lowerError.includes('components') ||
      lowerError.includes('labels') ||
      lowerError.includes('not on the appropriate screen')
    ) {
      console.warn(`DEMO_DATE_DIAGNOSTIC Retrying issue creation with only safe fields for "${title}" because Jira rejected optional/custom fields: ${errorMessage}`);
      const issue = await jiraPost('/rest/api/3/issue', { fields: removeOptionalIssueFields(fields) });
      console.log('DEMO_DATE_DIAGNOSTIC issue created after dropping optional/custom fields', JSON.stringify({
        issueKey: issue.key,
        projectKey,
      }));
      await saveLifecycleProperty(issue, options, lifecycle);
      await updateIssueDemoDateFields(issue.key, demoDateFields, lifecycle, options.diagnostics);
      await updateIssueBoardVisibleFields(issue.key, { assigneeAccountId, dueDate }, options.diagnostics);
      return issue;
    }
    throw err;
  }
}

async function transitionIssue(issueKey, targetStatus) {
  try {
    const data = await jiraGet(`/rest/api/3/issue/${issueKey}/transitions`);
    const transitions = data.transitions || [];
    const targetAliases = {
      todo: ['todo', 'open', 'backlog'],
      inprogress: ['inprogress', 'progress', 'doing', 'active'],
      underreview: ['underreview', 'review', 'testing', 'qa', 'readyforreview'],
      resolved: ['resolved', 'done', 'complete', 'completed', 'closed'],
      rejected: ['rejected', 'declined', 'cancelled', 'canceled', 'wontdo'],
    };
    const targetKey = normaliseStatusName(targetStatus);
    const aliases = targetAliases[targetKey] || [targetKey];
    const t = transitions.find(transition => {
      const candidate = normaliseStatusName(transition?.to?.name);
      return aliases.some(alias => candidate.includes(alias));
    });

    if (t) {
      await api.asUser().requestJira(
        route`/rest/api/3/issue/${issueKey}/transitions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transition: { id: String(t.id) } }),
        }
      );
    }
  } catch (err) {
    console.error(`Transition ${issueKey} -> ${targetStatus}: ${err.message}`);
  }
}

async function getBoardId(projectKey, boardType = 'scrum') {
  const safeBoardType = normaliseSoftwareTemplate(boardType) === 'kanban' ? 'kanban' : 'scrum';
  const boardPath = `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&type=${safeBoardType}`;

  // Newly-created software projects do not always surface their Scrum board instantly.
  // A short retry loop makes the sprint step far more reliable without needing a manual rerun.
  for (let attempt = 0; attempt < 4; attempt++) {
    const data = await jiraGet(boardPath);
    const boardId = data.values?.[0]?.id;

    if (boardId) {
      return boardId;
    }

    await wait(1500);
  }

  return null;
}

async function createSoftwareBoardForProject(project, boardType = 'scrum') {
  const safeBoardType = normaliseSoftwareTemplate(boardType) === 'kanban' ? 'kanban' : 'scrum';
  const filter = await createSavedFilter({
    name: `${project.name} - ${safeBoardType === 'scrum' ? 'Scrum' : 'Kanban'} Board Filter`,
    description: `Auto-generated board filter for ${project.name}.`,
    jql: `project = "${project.key}" ORDER BY Rank ASC`,
  });

  const board = await jiraPost('/rest/agile/1.0/board', {
    name: `${project.name} - ${safeBoardType === 'scrum' ? 'Scrum' : 'Kanban'} Board`,
    type: safeBoardType,
    filterId: Number(filter.id),
    location: {
      type: 'project',
      projectKeyOrId: project.key,
    },
  });

  await favoriteSavedFilter(filter.id);
  return board.id || null;
}

async function createSprint(boardId, name, startDate, endDate) {
  // FIX: Jira API does NOT accept 'state' on sprint creation — always creates as 'future'
  // State changes (active/closed) must be done via separate start/complete calls
  return await jiraPost('/rest/agile/1.0/sprint', {
    name,
    originBoardId: boardId,
    startDate: formatDateForJira(startDate),
    endDate: formatDateForJira(endDate),
  });
}

async function updateSprint(sprintId, body) {
  const res = await api.asUser().requestJira(buildTrustedJiraRoute(`/rest/agile/1.0/sprint/${sprintId}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT /rest/agile/1.0/sprint/${sprintId} failed: ${res.status} ${text}`);
  }

  return res.json();
}

function getSprintSchedule(sprintIndex) {
  // Jira only allows one active sprint per board. We model a realistic cadence:
  // sprint 1 is completed, sprint 2 is current, later sprints are future.
  if (sprintIndex === 0) {
    const startDate = createShiftedDate(-35);
    const endDate = createShiftedDate(-21);
    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      targetState: 'closed',
      shouldActivate: false,
    };
  }

  if (sprintIndex === 1) {
    const startDate = createShiftedDate(-7);
    const endDate = createShiftedDate(7);
    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      targetState: 'active',
      shouldActivate: true,
    };
  }

  const startDate = createShiftedDate(7 + ((sprintIndex - 2) * 14));
  const endDate = createShiftedDate(21 + ((sprintIndex - 2) * 14));
  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    targetState: 'future',
    shouldActivate: false,
  };
}

async function moveIssuesToSprint(sprintId, issueKeys) {
  if (issueKeys.length === 0) return;
  await jiraPost(`/rest/agile/1.0/sprint/${sprintId}/issue`, { issues: issueKeys });
}

async function createIssueLink(inwardKey, outwardKey, typeName = 'Blocks') {
  if (!inwardKey || !outwardKey || inwardKey === outwardKey) {
    return false;
  }

  try {
    await jiraPost('/rest/api/3/issueLink', {
      type: { name: typeName },
      inwardIssue: { key: inwardKey },
      outwardIssue: { key: outwardKey },
    });
    return true;
  } catch (err) {
    console.error(`Link ${inwardKey} -> ${outwardKey} (${typeName}): ${err.message}`);
    return false;
  }
}

function buildEnvironmentFilterDefinition(config, state) {
  const projectKeys = [
    ...state.results.jsmProjects.map(project => project.key),
    ...state.results.softwareProjects.map(project => project.key),
  ].filter(Boolean);

  if (projectKeys.length === 0) {
    return null;
  }

  const projectClause = buildProjectInClause(projectKeys);
  const runLabel = state.metadata.runLabel || createRunLabel();
  const filterName = `${config.environmentName} - Open Work (${runLabel})`;
  const filterDescription = `Auto-generated by the Cprime Demo Environment Creator for ${config.environmentName} run ${runLabel}.`;
  const jql = `project in (${projectClause}) AND statusCategory != Done ORDER BY priority DESC, duedate ASC`;
  const allWorkJql = `project in (${projectClause}) ORDER BY priority DESC, duedate ASC`;

  return {
    name: filterName,
    description: filterDescription,
    jql,
    allWorkJql,
    projectKeys,
  };
}

function getDashboardProjectContext(config, state, target) {
  const isEnterprise = target.projectKind === 'business-enterprise' || target.projectKind === 'software-enterprise';
  const isSoftware = target.projectKind === 'software' || target.projectKind === 'software-enterprise';
  const projectCollection = isSoftware ? state.results.softwareProjects : state.results.jsmProjects;
  const targetProjects = isEnterprise
    ? projectCollection.filter(project => project?.key)
    : [target.projectKind === 'software'
    ? state.results.softwareProjects[target.projectIndex]
    : state.results.jsmProjects[target.projectIndex]].filter(project => project?.key);

  if (targetProjects.length === 0) {
    return null;
  }

  const project = targetProjects[0];
  const fallbackTitle = isSoftware ? 'Software Dashboard' : 'Service Management Dashboard';
  const dashboardSelection = target.dashboardSelection || {
    title: fallbackTitle,
    prompt: '',
    value: 'default',
  };
  const dashboardIntent = inferDashboardIntent(dashboardSelection.prompt, config.industry, dashboardSelection.value);
  const dashboardTitle = dashboardSelection.value === 'default'
    ? fallbackTitle
    : `${fallbackTitle} - ${dashboardSelection.title}`;
  const filterTitle = dashboardSelection.value === 'default'
    ? fallbackTitle
    : dashboardSelection.title;
  const dashboardOwnerName = isEnterprise ? config.environmentName : project.name;
  const projectKeys = targetProjects.map(item => item.key).filter(Boolean);
  const customDateFields = targetProjects
    .map(item => item.demoDateFields)
    .find(fields => fields?.createdDateFieldId || fields?.resolvedDateFieldId) || {};

  return {
    dashboardIndex: target.dashboardIndex,
    dashboardSelection,
    dashboardIntent,
    dashboardProfile: dashboardIntent.title,
    project,
    projectKeys,
    customDateFields,
    projectTypeLabel: isSoftware ? 'Dev' : 'ITSM',
    dashboardName: `${dashboardOwnerName} - ${dashboardTitle}`,
    filterName: `${dashboardOwnerName} - ${filterTitle} Open Work (${state.metadata.runLabel || createRunLabel()})`,
    filterDescription: `Auto-generated ${filterTitle} filter by the Cprime Demo Environment Creator for ${dashboardOwnerName}.`,
    projects: isSoftware
      ? targetProjects.map(softwareProject => ({
          key: softwareProject.key,
          name: softwareProject.name,
          type: 'Software',
          projectManagementStyle: getProjectManagementStyleLabel(softwareProject.softwareProjectStyle),
          count: softwareProject.issueCount,
          boardId: softwareProject.boardId,
          dateFields: softwareProject.demoDateFields || {},
          versions: softwareProject.versions.map(version => ({
            id: String(version.id),
            name: version.name,
            releaseDate: version.releaseDate || null,
            released: Boolean(version.released),
          })),
          sprints: softwareProject.sprints || [],
        }))
      : targetProjects.map(jsmProject => ({
          key: jsmProject.key,
          name: jsmProject.name,
          type: 'ITSM',
          count: jsmProject.incidents.length,
          requestTypes: jsmProject.requestTypes || [],
          queues: jsmProject.queues || [],
          knowledgeBase: jsmProject.knowledgeBase || null,
          dateFields: jsmProject.demoDateFields || {},
        })),
  };
}

function buildProjectFilterDefinition(context) {
  const projectClause = buildProjectInClause(context.projectKeys);
  const issueTypeClause = context.projectTypeLabel === 'Dev' ? ' AND issuetype != Epic' : '';
  // Some Jira custom date fields can be displayed and queried but cannot be
  // used in ORDER BY clauses. Saved filters must therefore sort by Jira fields
  // that support ordering, while Forge dashboard gadgets still read the custom
  // Created Date / Resolved Date values directly for charts and trends.
  const jql = `project in (${projectClause})${issueTypeClause} AND statusCategory != Done ORDER BY priority DESC, duedate ASC`;
  const allWorkJql = `project in (${projectClause})${issueTypeClause} ORDER BY priority DESC, duedate ASC`;

  return {
    name: context.filterName,
    description: context.filterDescription,
    jql,
    allWorkJql,
    projectKeys: context.projectKeys,
    customDateFields: context.customDateFields || {},
  };
}

async function createSavedFilter({ name, description, jql }) {
  const filterNames = [
    name,
    `${name} ${Date.now().toString().slice(-6)}`,
    `${name} ${Date.now().toString().slice(-6)}-${getRandomInt(100, 999)}`,
  ];
  let lastError = null;

  for (const candidateName of filterNames) {
    try {
      return await jiraPost('/rest/api/2/filter', {
        name: candidateName,
        description,
        jql,
      });
    } catch (err) {
      lastError = err;

      if (!String(err?.message || '').toLowerCase().includes('filter with same name already exists')) {
        throw err;
      }
    }
  }

  throw lastError;
}

async function getSavedFilter(filterId) {
  return await jiraGet(`/rest/api/2/filter/${encodeURIComponent(filterId)}`);
}

async function favoriteSavedFilter(filterId) {
  try {
    await jiraPut(`/rest/api/2/filter/${encodeURIComponent(filterId)}/favourite`, {});
  } catch (err) {
    console.warn(`Unable to favourite filter ${filterId}: ${err.message}`);
  }
}

async function createDashboard(name) {
  try {
    return await jiraPost('/rest/api/3/dashboard', {
      name,
      sharePermissions: [{ type: 'authenticated' }],
    });
  } catch (err) {
    if (!err.message.includes('Dashboard with same name already exists')) {
      throw err;
    }

    const retryName = `${name} (${new Date().toISOString().replace(/[:.]/g, '-')})`;
    return await jiraPost('/rest/api/3/dashboard', {
      name: retryName,
      sharePermissions: [{ type: 'authenticated' }],
    });
  }
}

async function copyDashboard(sourceDashboardId, name) {
  const res = await api.asUser().requestJira(buildTrustedJiraRoute(`/rest/api/3/dashboard/${sourceDashboardId}/copy`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      sharePermissions: [{ type: 'authenticated' }],
      editPermissions: [],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /rest/api/3/dashboard/${sourceDashboardId}/copy failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function getAvailableDashboardGadgets() {
  const data = await jiraGet('/rest/api/3/dashboard/gadgets');
  return Array.isArray(data.gadgets) ? data.gadgets : [];
}

function normaliseDashboardGadgets(availableGadgets) {
  return availableGadgets
    .map(gadget => ({
      title: String(gadget.title || '').trim(),
      moduleKey: gadget.moduleKey || null,
      uri: gadget.uri || null,
    }))
    .filter(gadget => gadget.title && (gadget.moduleKey || gadget.uri));
}

function findDashboardGadgetByKeywords(availableGadgets, keywords, seenKeys = new Set()) {
  const lowerKeywords = keywords.map(keyword => keyword.toLowerCase());
  const normalised = normaliseDashboardGadgets(availableGadgets);

  return normalised.find(gadget => {
    const identity = gadget.moduleKey || gadget.uri;
    if (!identity || seenKeys.has(identity)) {
      return false;
    }

    const title = gadget.title.toLowerCase();
    return lowerKeywords.some(keyword => title.includes(keyword));
  }) || null;
}

function findDashboardGadget(availableGadgets, plan, seenKeys = new Set()) {
  const normalised = normaliseDashboardGadgets(availableGadgets);
  const preferredModuleKeys = plan.moduleKeys || [];

  for (const moduleKey of preferredModuleKeys) {
    const match = normalised.find(gadget => {
      const identity = gadget.moduleKey || gadget.uri;
      return identity && !seenKeys.has(identity) && gadget.moduleKey === moduleKey;
    });

    if (match) {
      return match;
    }
  }

  return findDashboardGadgetByKeywords(availableGadgets, plan.keywords, seenKeys);
}

function buildDashboardGadgetRequests(availableGadgets) {
  const preferredKeywords = [
    'activity',
    'assigned',
    'filter',
    'sprint',
    'project',
    'average',
    'created',
    'introduction',
  ];

  const normalised = normaliseDashboardGadgets(availableGadgets);

  const selected = [];
  const seenKeys = new Set();

  for (const keyword of preferredKeywords) {
    const match = normalised.find(gadget => {
      const identity = gadget.moduleKey || gadget.uri;
      return !seenKeys.has(identity) && gadget.title.toLowerCase().includes(keyword);
    });

    if (match) {
      const identity = match.moduleKey || match.uri;
      seenKeys.add(identity);
      selected.push(match);
    }

    if (selected.length >= 4) {
      break;
    }
  }

  for (const gadget of normalised) {
    const identity = gadget.moduleKey || gadget.uri;

    if (seenKeys.has(identity)) {
      continue;
    }

    seenKeys.add(identity);
    selected.push(gadget);

    if (selected.length >= 4) {
      break;
    }
  }

  return selected.map((gadget, index) => ({
    title: gadget.title,
    moduleKey: gadget.moduleKey,
    uri: gadget.uri,
    row: Math.floor(index / 2),
    column: index % 2,
  }));
}

async function addGadget(dashboardId, moduleKey, position, title) {
  const body = {
    position: { row: position.row, column: position.column },
    title,
  };

  if (moduleKey) {
    body.moduleKey = moduleKey;
  }

  return await jiraPost(`/rest/api/3/dashboard/${dashboardId}/gadget`, body);
}

async function addDiscoveredDashboardGadget(dashboardId, gadget) {
  const body = {
    position: { row: gadget.row, column: gadget.column },
    title: gadget.title,
  };

  if (gadget.moduleKey) {
    body.moduleKey = gadget.moduleKey;
  }

  if (gadget.uri) {
    body.uri = gadget.uri;
  }

  return await jiraPost(`/rest/api/3/dashboard/${dashboardId}/gadget`, body);
}

async function setDashboardItemProperty(dashboardId, itemId, propertyKey, value) {
  return await jiraPut(`/rest/api/3/dashboard/${dashboardId}/items/${itemId}/properties/${propertyKey}`, value);
}

async function getDashboardItemProperty(dashboardId, itemId, propertyKey) {
  const data = await jiraGet(`/rest/api/3/dashboard/${dashboardId}/items/${itemId}/properties/${propertyKey}`);
  return data.value;
}

async function setDashboardGadgetPreferences(dashboardId, gadgetId, preferences) {
  // Jira's built-in dashboard gadgets still read their edit-form values from
  // legacy gadget preferences. The documented dashboard item property API is
  // useful for app-owned dashboard items, but many stock gadgets ignore it when
  // deciding whether they are fully configured.
  const res = await api.asUser().requestJira(buildTrustedJiraRoute(`/rest/dashboards/1.0/${dashboardId}/gadget/${gadgetId}/prefs`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT /rest/dashboards/1.0/${dashboardId}/gadget/${gadgetId}/prefs failed: ${res.status} ${text}`);
  }
}

async function setDashboardGadgetPreferencesWithPropertyFallback(dashboardId, gadgetId, preferences, propertyValues = {}) {
  try {
    await setDashboardGadgetPreferences(dashboardId, gadgetId, preferences);
    return;
  } catch (err) {
    console.warn(`Legacy dashboard gadget preference update failed for ${gadgetId}: ${err.message}`);
  }

  for (const [propertyKey, value] of Object.entries(propertyValues)) {
    await setDashboardItemProperty(dashboardId, gadgetId, propertyKey, value);
  }
}

async function applyFilterToDashboardGadget(dashboardId, itemId, filter) {
  // Jira's stock gadgets persist their selection as dashboard item properties.
  // Different gadgets can look for slightly different keys, so we write the
  // canonical pair (`id`, `name`) plus common aliases used by filter-driven
  // gadgets. Unknown keys are ignored by Jira and do not harm the gadget.
  await setDashboardItemProperty(dashboardId, itemId, 'id', String(filter.id));
  await setDashboardItemProperty(dashboardId, itemId, 'name', String(filter.name));
  await setDashboardItemProperty(dashboardId, itemId, 'filterId', String(filter.id));
  await setDashboardItemProperty(dashboardId, itemId, 'filterName', String(filter.name));
}

async function configureFilterResultsGadget(dashboardId, itemId, filter) {
  const propertyConfig = {
    filterId: String(filter.id),
    num: '10',
    refresh: 'true',
    isConfigured: 'true',
    columnNames: 'issuetype|issuekey|summary|priority|status|assignee',
  };

  await setDashboardGadgetPreferencesWithPropertyFallback(
    dashboardId,
    itemId,
    {
      up_isConfigured: 'true',
      up_filterId: String(filter.id),
      up_num: '10',
      up_refresh: 'false',
      up_columnNames: 'issuetype|issuekey|summary|priority|status|assignee',
    },
    { config: propertyConfig }
  );
}

async function configureTextGadget(dashboardId, itemId, state, filter) {
  const projectListItems = [
    ...state.results.jsmProjects.map(project => `<li><strong>${project.key}</strong>: ${project.name}</li>`),
    ...state.results.softwareProjects.map(project => `<li><strong>${project.key}</strong>: ${project.name}</li>`),
  ].join('');
;;;;;;;;;;;;
  const html = [
    `<p><strong>Environment dashboard generated automatically.</strong></p>`,
    `<p>Saved filter: <a href="${filter.viewUrl || `/issues/?filter=${filter.id}`}">${filter.name}</a></p>`,
    `<p>Project scope:</p>`,
    `<ul>${projectListItems}</ul>`,
    `<p>Total ITSM work items: ${state.results.totalIncidents}<br/>Total software issues: ${state.results.totalIssues}</p>`,
  ].join('');

  await setDashboardItemProperty(dashboardId, itemId, 'isConfigured', 'true');
  await setDashboardItemProperty(dashboardId, itemId, 'refresh', 'false');
  await setDashboardItemProperty(dashboardId, itemId, 'html', html);
}

async function configurePieChartGadget(dashboardId, itemId, filter, statType, gadgetTitle) {
  await setDashboardGadgetPreferencesWithPropertyFallback(
    dashboardId,
    itemId,
    {
      up_isConfigured: 'true',
      up_refresh: 'false',
      up_isPopup: 'false',
      up_id: String(filter.id),
      up_name: String(filter.name),
      up_type: 'filter',
      up_projectOrFilterId: String(filter.id),
      up_statType: statType,
      up_title: gadgetTitle,
    },
    {
      isConfigured: 'true',
      refresh: 'false',
      isPopup: 'false',
      id: String(filter.id),
      name: String(filter.name),
      type: 'filter',
      projectOrFilterId: String(filter.id),
      statType,
      title: gadgetTitle,
    }
  );
}

async function configureFilterDrivenChartGadget(dashboardId, itemId, filter, extraProperties = {}) {
  const prefixedProperties = Object.fromEntries(
    Object.entries(extraProperties).map(([key, value]) => [`up_${key}`, value])
  );

  await setDashboardGadgetPreferencesWithPropertyFallback(
    dashboardId,
    itemId,
    {
      up_isConfigured: 'true',
      up_refresh: 'false',
      up_id: String(filter.id),
      up_name: String(filter.name),
      up_type: 'filter',
      up_projectOrFilterId: String(filter.id),
      ...prefixedProperties,
    },
    {
      isConfigured: 'true',
      refresh: 'false',
      id: String(filter.id),
      name: String(filter.name),
      type: 'filter',
      projectOrFilterId: String(filter.id),
      ...extraProperties,
    }
  );
}

async function configureForgeDemoGadget(dashboardId, itemId, gadgetPlan, state, filter, environmentConfig, dashboardContext = null) {
  const config = {
    viewType: gadgetPlan.role.replace('forge-', ''),
    title: gadgetPlan.title,
    subtitle: gadgetPlan.subtitle || '',
    visualType: gadgetPlan.visualType || 'standard',
    sectionLabel: gadgetPlan.sectionLabel || '',
    environmentName: dashboardContext?.dashboardName || state.results.dashboardName || environmentConfig.environmentName,
    dashboardSelection: dashboardContext?.dashboardSelection || null,
    dashboardProfile: dashboardContext?.dashboardIntent?.title || null,
    dashboardLevel: dashboardContext?.dashboardIntent?.level || null,
    dashboardDomain: dashboardContext?.dashboardIntent?.domain || null,
    dashboardMetrics: dashboardContext?.dashboardIntent?.metrics || [],
    dashboardQuestions: dashboardContext?.dashboardIntent?.questions || [],
    dashboardKpis: dashboardContext?.dashboardIntent?.kpis || [],
    filterId: String(filter.id),
    filterName: String(filter.name),
    jql: filter.jql,
    allWorkJql: filter.allWorkJql || filter.jql,
    customDateFields: filter.customDateFields || dashboardContext?.customDateFields || {},
    // The retention period is supplied from the global page form and stored on
    // every Forge dashboard gadget item. Keeping it in the gadget property means
    // each gadget can explain how long the generated demo environment should be
    // kept, even when Jira loads the gadgets independently.
    retentionPeriodDays: environmentConfig.retentionPeriodDays,
    dateRange: environmentConfig.dateRange,
    dateRangeDays: environmentConfig.dateRangeDays,
    generatedAt: new Date().toISOString().split('T')[0],
    confluenceSpaces: state.results.confluenceSpaces || [],
    projects: dashboardContext?.projects || [
      ...state.results.jsmProjects.map(project => ({
        key: project.key,
        name: project.name,
        type: 'ITSM',
        count: project.incidents.length,
        requestTypes: project.requestTypes || [],
        queues: project.queues || [],
        knowledgeBase: project.knowledgeBase || null,
        dateFields: project.demoDateFields || {},
      })),
      ...state.results.softwareProjects.map(project => ({
        key: project.key,
        name: project.name,
        type: 'Software',
        projectManagementStyle: getProjectManagementStyleLabel(project.softwareProjectStyle),
        count: project.issueCount,
        boardId: project.boardId,
        versions: project.versions.map(version => ({
          id: String(version.id),
          name: version.name,
          releaseDate: version.releaseDate || null,
          released: Boolean(version.released),
        })),
        sprints: project.sprints || [],
        dateFields: project.demoDateFields || {},
      })),
    ],
  };

  await setDashboardItemProperty(dashboardId, itemId, 'config', config);
}

async function ensureSavedFilter(config, state) {
  if (state.results.savedFilter?.id) {
    return state.results.savedFilter;
  }

  const filterDefinition = buildEnvironmentFilterDefinition(config, state);
  if (!filterDefinition) {
    return null;
  }

  const createdFilter = await createSavedFilter(filterDefinition);
  state.results.savedFilter = {
    id: String(createdFilter.id),
    name: createdFilter.name || filterDefinition.name,
    jql: createdFilter.jql || filterDefinition.jql,
    allWorkJql: filterDefinition.allWorkJql,
    viewUrl: createdFilter.viewUrl || null,
    source: 'generated',
  };

  await favoriteSavedFilter(state.results.savedFilter.id);
  return state.results.savedFilter;
}

async function ensureProjectSavedFilter(state, dashboardContext) {
  const existingFilter = state.results.savedFilters[dashboardContext.dashboardIndex];
  if (existingFilter?.id) {
    return existingFilter;
  }

  const filterDefinition = buildProjectFilterDefinition(dashboardContext);
  const createdFilter = await createSavedFilter(filterDefinition);
  const savedFilter = {
    id: String(createdFilter.id),
    name: createdFilter.name || filterDefinition.name,
    jql: createdFilter.jql || filterDefinition.jql,
    allWorkJql: filterDefinition.allWorkJql,
    viewUrl: createdFilter.viewUrl || null,
    source: 'generated',
    projectKeys: filterDefinition.projectKeys,
    customDateFields: filterDefinition.customDateFields || {},
  };

  state.results.savedFilters[dashboardContext.dashboardIndex] = savedFilter;
  if (!state.results.savedFilter) {
    state.results.savedFilter = savedFilter;
  }

  await favoriteSavedFilter(savedFilter.id);
  return savedFilter;
}

async function createManagedDashboard(config, state, filter) {
  const dashboard = await createDashboard(`${config.environmentName} - Release Dashboard`);
  const availableGadgets = await getAvailableDashboardGadgets();
  const seenKeys = new Set();
  let filterApplied = false;

  const plannedGadgets = [
    {
      role: 'text',
      title: `${config.environmentName} Summary`,
      keywords: ['text'],
    },
    {
      role: 'filter-results',
      title: `${config.environmentName} Open Work`,
      keywords: ['filter results', 'filter'],
    },
    {
      role: 'pie-chart-status',
      title: 'Work by Status',
      keywords: ['pie chart'],
    },
    {
      role: 'activity',
      title: 'Activity Stream',
      keywords: ['activity'],
    },
  ];

  const matchedGadgets = [];

  for (const plan of plannedGadgets) {
    const match = findDashboardGadgetByKeywords(availableGadgets, plan.keywords, seenKeys);
    if (!match) {
      addChunkedError(state, `Dashboard ${dashboard.id}: could not find a "${plan.role}" gadget in Jira's gadget catalog.`);
      continue;
    }

    const identity = match.moduleKey || match.uri;
    seenKeys.add(identity);
    matchedGadgets.push({
      ...plan,
      match,
    });
  }

  for (let index = 0; index < matchedGadgets.length; index += 1) {
    const plan = matchedGadgets[index];
    const row = Math.floor(index / 2);
    const column = index % 2;

    try {
      const added = await addDiscoveredDashboardGadget(dashboard.id, {
        ...plan.match,
        title: plan.title,
        row,
        column,
      });

      if (plan.role === 'text') {
        await configureTextGadget(dashboard.id, added.id, state, filter);
        continue;
      }

      if (plan.role === 'filter-results') {
        await configureFilterResultsGadget(dashboard.id, added.id, filter);
        await applyFilterToDashboardGadget(dashboard.id, added.id, filter);
        filterApplied = true;
        continue;
      }

      if (plan.role === 'pie-chart-status') {
        await configurePieChartGadget(dashboard.id, added.id, filter, 'statuses', plan.title);
        continue;
      }
    } catch (err) {
      addChunkedError(state, `Gadget "${plan.title}" for dashboard ${dashboard.id}: ${err.message}`);
    }
  }

  return {
    dashboard,
    filterApplied,
  };
}

// ── MAIN RESOLVER ─────────────────────────────────────────────────────────────

resolver.define('createDemoEnvironment', async ({ payload }) => {
  // FIX #2: Declare ALL variables ONCE here, outside the try block
  // (previously declared twice — once here and once inside try — causing bugs)
  console.log('🚀 createDemoEnvironment started', JSON.stringify(payload));

  const {
    industry, environmentName,
    jsmProjectCount, incidentsPerProject,
    softwareProjectCount, softwareTemplate, softwareProjectStyle, issuesPerProject, sprintsPerProject,
  } = payload;
  const dateRangeDays = parseDateRangeDays(payload.dateRange);
  const retentionPeriodDays = ACTIVE_TICKET_RETENTION_DAYS;

  const results = {
    jsmProjects: [],
    softwareProjects: [],
    totalIncidents: 0,
    totalIssues: 0,
    dashboardId: null,
    errors: [],
    diagnostics: [],
  };

  try {
    // ── AUTHENTICATION & AUTHORIZATION ───────────────────────────────────────
    console.log('📋 Checking user authentication and permissions...');
    let accountId;
    try {
      accountId = await getCurrentUser();
      console.log('✅ User authenticated:', accountId);
    } catch (err) {
      console.error('❌ Authentication failed:', err.message);
      return {
        success: false,
        summary: `Authentication Error: ${err.message}\n\nPlease ensure you are logged into Jira and try again.`,
      };
    }

    let permissions;
    try {
      permissions = await getMyGlobalPermissions();
      console.log('✅ Permissions retrieved');
    } catch (err) {
      console.error('❌ Permission check failed:', err.message);
      return {
        success: false,
        summary: `Permission Check Error: ${err.message}\n\nTry logging out and back in, then try again.`,
      };
    }

    const canAdministerJira = Boolean(permissions.ADMINISTER?.havePermission);
    if (!canAdministerJira) {
      return {
        success: false,
        summary: `The current user does not have the global "Administer Jira" permission.\nPlease open the app as a Jira administrator and try again.`,
      };
    }

    console.log('✅ All permission checks passed');

    const content = getContent(industry);
    const priorities = ['Highest', 'High', 'High', 'Medium', 'Medium', 'Medium', 'Low', 'Lowest'];

    // ── STEP 1: JSM ITSM PROJECTS + INCIDENTS ─────────────────────────────────
    console.log(`Creating ${jsmProjectCount} JSM ITSM project(s)...`);
    for (let i = 0; i < jsmProjectCount; i++) {
      try {
        const timestamp = Date.now();
        const projectName = `${environmentName} - ${industry} Ops ${i + 1} (${timestamp})`;
        const projectKeyPrefix = deriveProjectKeyPrefix(environmentName, industry);
        console.log(`Creating JSM ITSM project: ${projectName} (${projectKeyPrefix})`);
        results.diagnostics.push(`JSM Project ${i + 1}: creating Jira Service Management ITSM project using template ${getJsmItsmTemplateKeys()[0]}.`);

        const project = await createJSMProject(projectName, accountId, projectKeyPrefix, results.diagnostics);
        const screenSetup = await ensureDemoDateFieldsOnProjectScreens(project.id, project.key);
        const demoDateFields = screenSetup.demoDateFields || null;
        const assignableUsers = await getAssignableUsers(project.key, accountId);
        results.diagnostics.push(...(screenSetup.diagnostics || []));
        if (!screenSetup.success) {
          results.errors.push(`JSM Project ${project.key}: ${screenSetup.message}`);
        }

        try {
          const formSetup = await ensureDefaultSmartIntakeForm(project.key, projectName, industry);
          if (!formSetup.success) {
            results.errors.push(`JSM Project ${project.key}: ${formSetup.message}`);
          } else {
            results.diagnostics.push(`Forms ${project.key}: ${formSetup.reused ? 'reused' : 'created'} "${formSetup.name}" (request type ${formSetup.requestTypeId})`);
            if (formSetup.warning) {
              results.diagnostics.push(`Forms ${project.key}: ${formSetup.warning}`);
            }
          }
        } catch (err) {
          results.errors.push(`JSM Project ${project.key}: default smart form setup failed: ${err.message}`);
        }

        // Create incidents as regular Bug issues (no JSM API needed)
        const projectIncidents = [];
        const count = Math.min(incidentsPerProject, MAX_INCIDENTS_PER_PROJECT);
        const boardStatusCycle = ['To Do', 'In Progress', 'Done'];

        for (let j = 0; j < count; j++) {
          try {
            const inc = getCycledTemplate(content.incidents, j);
            const priority = getPriorityName(inc.priority);
            const lifecycle = createLifecycleForIssue({
              index: j,
              priority,
              issueType: 'Incident',
              maxAgeDays: dateRangeDays,
            });
            const dueDate = getDateString(getRandomInt(-60, 30));
            const assigneeAccountId = chooseDemoAssigneeAccountId(assignableUsers, j, i);
            const targetStatus = boardStatusCycle[j % boardStatusCycle.length];
            const lifecycleForStatus = ensureResolvedLifecycleForStatus(lifecycle, targetStatus);
            // Create incident as a Bug type issue using standard Jira API
            const created = await createIssue(project.key, inc.title, 'Bug', null, priority, dueDate, null, {
              assigneeAccountId,
              demoDateFields,
              diagnostics: results.diagnostics,
              environmentName,
              lifecycle: lifecycleForStatus,
              projectKind: 'business',
              retentionPeriodDays,
            });

            if (targetStatus === 'In Progress') {
              await transitionIssue(created.key, 'In Progress');
            } else if (targetStatus === 'Done') {
              await transitionIssue(created.key, 'In Progress');
              await transitionIssue(created.key, 'Resolved');
            }

            projectIncidents.push({ key: created.key, title: inc.title, priority: inc.priority, status: targetStatus });
            results.totalIncidents++;
          } catch (err) {
            results.errors.push(`Incident ${j + 1}: ${err.message}`);
          }
        }

        results.jsmProjects.push({ key: project.key, name: projectName, incidents: projectIncidents });
        console.log(`✅ JSM ITSM project ${project.key} created with ${projectIncidents.length} incidents`);
      } catch (err) {
        console.error(`JSM Project ${i + 1} error: ${err.message}`);
        results.errors.push(`JSM Project ${i + 1}: ${err.message}`);
      }
    }

    // ── STEP 2: SOFTWARE PROJECTS ─────────────────────────────────────────────
    console.log(`Creating ${softwareProjectCount} Software project(s)...`);
    for (let i = 0; i < softwareProjectCount; i++) {
      try {
        const timestamp = Date.now();
        const projectName = `${environmentName} - ${industry} Dev ${i + 1} (${timestamp})`;
        const projectKeyPrefix = deriveProjectKeyPrefix(environmentName, industry);
        console.log(`Creating software project: ${projectName} (${projectKeyPrefix})`);

        const selectedSoftwareTemplate = normaliseSoftwareTemplate(softwareTemplate);
        const selectedSoftwareProjectStyle = normaliseProjectManagementStyle(softwareProjectStyle);
        const project = await createSoftwareProject(projectName, accountId, projectKeyPrefix, selectedSoftwareTemplate, selectedSoftwareProjectStyle);
        const screenSetup = await ensureDemoDateFieldsOnProjectScreens(project.id, project.key);
        const demoDateFields = screenSetup.demoDateFields || null;
        const assignableUsers = await getAssignableUsers(project.key, accountId);
        results.diagnostics.push(...(screenSetup.diagnostics || []));

        if (!screenSetup.success) {
          results.errors.push(`Software Project ${project.key}: ${screenSetup.message}`);
        }

        try {
          const formSetup = await ensureDefaultSoftwareWorkForm(project.key, projectName, industry);
          if (!formSetup.success) {
            if (formSetup.unsupported) {
              results.diagnostics.push(formSetup.message);
            } else {
              results.errors.push(`Software Project ${project.key}: ${formSetup.message}`);
            }
          } else {
            results.diagnostics.push(`Forms ${project.key}: ${formSetup.reused ? 'reused' : 'created'} "${formSetup.name}" (issue type ${formSetup.issueTypeName || formSetup.issueTypeId})`);
            if (formSetup.warning) {
              results.diagnostics.push(`Forms ${project.key}: ${formSetup.warning}`);
            }
          }
        } catch (err) {
          results.errors.push(`Software Project ${project.key}: default work form setup failed: ${err.message}`);
        }

        // Versions
        const versions = [];
        const currentMonth = new Date().getMonth() + 1;
        for (let m = 2; m <= 5; m++) {
          try {
            const released = m < currentMonth;
            const releaseDate = `2026-${pad(m)}-28`;
            const v = await createVersion(project.id, `Version-2026.${pad(m)}`, releaseDate, released);
            versions.push(v);
          } catch (err) {
            console.warn(`Version 2026.${pad(m)} skipped: ${err.message}`);
          }
        }

        // Epics
        const epicKeys = [];
        for (let epicIndex = 0; epicIndex < content.epics.length; epicIndex++) {
          const epicName = content.epics[epicIndex];

          try {
            const dueDate = getDateString(30 + (epicIndex * 14));
            const assigneeAccountId = chooseDemoAssigneeAccountId(assignableUsers, epicIndex, i);
            const epicPriority = priorities[epicIndex % priorities.length];
            const lifecycle = createLifecycleForIssue({
              index: epicIndex,
              priority: epicPriority,
              issueType: 'Epic',
              maxAgeDays: dateRangeDays,
            });
            const epic = await createEpic(project.key, epicName, {
              assigneeAccountId,
              dueDate,
              priority: epicPriority,
              demoDateFields,
              diagnostics: results.diagnostics,
              environmentName,
              lifecycle,
              projectKind: 'software',
              retentionPeriodDays,
            });
            epicKeys.push(epic.key);
          } catch (err) {
            results.errors.push(`Epic "${epicName}": ${err.message}`);
          }
        }

        // Issues
        const issueKeys = [];
        const count = Math.min(issuesPerProject, MAX_ISSUES_PER_PROJECT);
        for (let j = 0; j < count; j++) {
          try {
            const tmpl = getCycledTemplate(content.issues, j);
            const dueDate = getDateString(getRandomInt(-90, 90));
            const assigneeAccountId = chooseDemoAssigneeAccountId(assignableUsers, j, i);
            const priority = priorities[j % priorities.length];
            const status = getDemoDevStatus(j);
            const lifecycle = createLifecycleForIssue({
              index: j,
              priority,
              issueType: tmpl.type,
              maxAgeDays: dateRangeDays,
            });
            const lifecycleForStatus = ensureResolvedLifecycleForStatus(lifecycle, status);
            const issue = await createIssue(
              project.key,
              tmpl.title,
              tmpl.type,
              epicKeys[j % epicKeys.length] || null,
              priority,
              dueDate,
              versions[j % versions.length]?.id,
              {
                assigneeAccountId,
                demoDateFields,
                diagnostics: results.diagnostics,
                environmentName,
                lifecycle: lifecycleForStatus,
                projectKind: 'software',
                retentionPeriodDays,
              }
            );
            issueKeys.push(issue.key);

            // FIX #7: transitionIssue now handles 204 No Content safely
            if (status !== 'To Do') {
              await transitionIssue(issue.key, status);
            }
            results.totalIssues++;
          } catch (err) {
            results.errors.push(`Issue ${j + 1}: ${err.message}`);
          }
        }

        // Sprints
        const boardId = await getBoardId(project.key, selectedSoftwareTemplate);
        if (selectedSoftwareTemplate === 'scrum' && boardId && issueKeys.length > 0) {
          const chunkSize = Math.max(1, Math.ceil(issueKeys.length / sprintsPerProject));

          for (let s = 0; s < sprintsPerProject; s++) {
            try {
              const daysBack = (sprintsPerProject - 1 - s) * 14;
              const startDate = getDateString(-daysBack - 14);
              const endDate = getDateString(-daysBack);

              // FIX: No 'state' param — Jira API ignores/rejects it on creation
              const sprint = await createSprint(boardId, `Sprint ${s + 1}`, startDate, endDate);

              const chunk = issueKeys.slice(s * chunkSize, (s + 1) * chunkSize);
              if (chunk.length > 0) {
                await moveIssuesToSprint(sprint.id, chunk);
              }
              console.log(`Sprint ${s + 1} created with ${chunk.length} issues`);
            } catch (err) {
              results.errors.push(`Sprint ${s + 1}: ${err.message}`);
            }
          }
        }

        results.softwareProjects.push({
          key: project.key,
          name: projectName,
          softwareProjectStyle: selectedSoftwareProjectStyle,
          issueCount: issueKeys.length,
          firstIssueKey: issueKeys[0] || null,
        });

        console.log(`✅ Software project ${project.key} created with ${issueKeys.length} issues`);
      } catch (err) {
        console.error(`Software Project ${i + 1} error: ${err.message}`);
        results.errors.push(`Software Project ${i + 1}: ${err.message}`);
      }
    }

    // ── STEP 3: DEPENDENCIES ──────────────────────────────────────────────────
    try {
      if (results.softwareProjects.length >= 2) {
        const k1 = results.softwareProjects[0].firstIssueKey;
        const k2 = results.softwareProjects[1].firstIssueKey;
        if (k1 && k2) await createIssueLink(k1, k2);
      }
      if (results.jsmProjects.length > 0 && results.softwareProjects.length > 0) {
        const jsmKey = results.jsmProjects[0].incidents[0]?.key;
        const swKey = results.softwareProjects[0].firstIssueKey;
        if (jsmKey && swKey) await createIssueLink(swKey, jsmKey);
      }
    } catch (err) {
      results.errors.push(`Dependencies: ${err.message}`);
    }

    // ── STEP 4: DASHBOARD ─────────────────────────────────────────────────────
    try {
      if (results.jsmProjects.length > 0 || results.softwareProjects.length > 0) {
        const dashboard = await createDashboard(`${environmentName} - Release Dashboard`);
        results.dashboardId = dashboard.id;

        const gadgets = [
          { key: 'com.atlassian.jira.gadgets:project-gadget', title: 'Projects Overview', row: 0, col: 0 },
          { key: 'com.atlassian.jira.gadgets:assigned-to-me-gadget', title: 'Issues Across Projects', row: 1, col: 0 },
          { key: 'com.atlassian.jira.gadgets:filter-results-gadget', title: 'Overdue Work Per Project', row: 2, col: 0 },
          { key: 'com.pyxis.greenhopper.jira:greenhopper-gadget-sprint-burndown', title: 'Sprint Burndown', row: 0, col: 1 },
          { key: 'com.pyxis.greenhopper.jira:greenhopper-sprint-health-gadget', title: 'Sprint Health', row: 1, col: 1 },
          { key: 'com.atlassian.jira.gadgets:average-age-chart-gadget', title: 'Average Time in Status', row: 2, col: 1 },
        ];

        for (const g of gadgets) {
          try {
            await addGadget(dashboard.id, g.key, { row: g.row, column: g.col }, g.title);
          } catch (err) {
            results.errors.push(`Gadget "${g.title}": ${err.message}`);
          }
        }
        console.log(`✅ Dashboard ${dashboard.id} created`);
      } else {
        results.errors.push('Dashboard skipped: no Jira projects were created successfully.');
      }
    } catch (err) {
      results.errors.push(`Dashboard: ${err.message}`);
    }

    // ── SUMMARY ───────────────────────────────────────────────────────────────
    const hasProjects = results.jsmProjects.length > 0 || results.softwareProjects.length > 0;
    const lines = [
      hasProjects
        ? `✅ "${environmentName}" demo environment created successfully!`
        : `⚠️ "${environmentName}" demo environment creation attempted but no resources were created.`,
      ``,
      `📊 Summary:`,
      `• Industry: ${industry}`,
      `• JSM ITSM Projects: ${results.jsmProjects.length} (${results.totalIncidents} ITSM work items total)`,
      `• Software Projects: ${results.softwareProjects.length} (${results.totalIssues} issues total)`,
      `• Dashboard: ${results.dashboardId ? '✅ Created' : '❌ Failed to create'}`,
      ``,
    ];

    if (results.jsmProjects.length > 0) {
      lines.push(`🛠️ JSM ITSM Projects Created:`);
      lines.push(...results.jsmProjects.map(p => `  • ${p.key}: ${p.name} (${p.incidents.length} ITSM work items)`));
      lines.push(``);
    }

    if (results.softwareProjects.length > 0) {
      lines.push(`💻 Software Projects Created:`);
      lines.push(...results.softwareProjects.map(p => `  • ${p.key}: ${p.name} (${p.issueCount} issues)`));
      lines.push(``);
    }

    if (hasProjects) {
      lines.push(`📋 Final Step (Required):`);
      lines.push(`  1. Go to Jira → Plans`);
      lines.push(`  2. Click "Create Plan"`);
      lines.push(`  3. Add all projects above`);
      lines.push(`  4. Click Save`);
      lines.push(``);
    }

    if (results.errors.length > 0) {
      lines.push(`⚠️ ${results.errors.length} error(s) occurred:`);
      lines.push(...results.errors.map(e => `  • ${e}`));
      lines.push(``);
      lines.push(`🔍 Check the browser console and run 'forge logs' for detailed error messages.`);
    } else if (hasProjects) {
      lines.push(`🎉 No errors!`);
    }

    return { success: hasProjects, summary: lines.join('\n') };

  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    return { success: false, summary: `❌ Failed: ${err.message}` };
  }
});

const INCIDENT_BATCH_SIZE = 2;
const ISSUE_BATCH_SIZE = 2;
const VERSION_BATCH_SIZE = 2;
const EPIC_BATCH_SIZE = 2;
const SOFTWARE_VERSION_COUNT = 6;
const MAX_INCIDENTS_PER_PROJECT = 60;
const MAX_ISSUES_PER_PROJECT = 60;
const MIN_SOFTWARE_SPRINTS_PER_PROJECT = 4;
const ITSM_WORK_COUNT_KEYS = [
  'incidentRequestsPerProject',
  'problemRequestsPerProject',
  'changeRequestsPerProject',
  'serviceRequestsPerProject',
  'postIncidentReviewsPerProject',
];
const ACTIVE_ITSM_WORK_COUNT_KEYS = [
  'incidentRequestsPerProject',
  'problemRequestsPerProject',
  'changeRequestsPerProject',
  'serviceRequestsPerProject',
];

const ITSM_WORK_COUNT_DEFAULTS = {
  incidentRequestsPerProject: 1,
  problemRequestsPerProject: 1,
  changeRequestsPerProject: 1,
  serviceRequestsPerProject: 1,
  postIncidentReviewsPerProject: 0,
};

function normalisePositiveInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normaliseItsmWorkCounts(payload = {}) {
  const hasExplicitItsmCounts = ITSM_WORK_COUNT_KEYS.some(key => Object.prototype.hasOwnProperty.call(payload, key));

  if (!hasExplicitItsmCounts) {
    // Older app versions sent one "incidentsPerProject" number. Keep that
    // payload working by spreading the requested total across the ITSM work
    // types in the same order the demo generator uses.
    const legacyTotal = normalisePositiveInteger(payload.incidentsPerProject, 5, 0, MAX_INCIDENTS_PER_PROJECT);
    const legacyCounts = Object.fromEntries(ITSM_WORK_COUNT_KEYS.map(key => [key, 0]));

    for (let index = 0; index < legacyTotal; index += 1) {
      legacyCounts[ACTIVE_ITSM_WORK_COUNT_KEYS[index % ACTIVE_ITSM_WORK_COUNT_KEYS.length]] += 1;
    }

    // Post-incident reviews are not part of the current UI flow. Keep this
    // hard-coded to zero so older browser payloads cannot create them.
    legacyCounts.postIncidentReviewsPerProject = 0;

    return legacyCounts;
  }

  return {
    incidentRequestsPerProject: normalisePositiveInteger(payload.incidentRequestsPerProject, ITSM_WORK_COUNT_DEFAULTS.incidentRequestsPerProject, 1, MAX_INCIDENTS_PER_PROJECT),
    problemRequestsPerProject: normalisePositiveInteger(payload.problemRequestsPerProject, ITSM_WORK_COUNT_DEFAULTS.problemRequestsPerProject, 1, MAX_INCIDENTS_PER_PROJECT),
    changeRequestsPerProject: normalisePositiveInteger(payload.changeRequestsPerProject, ITSM_WORK_COUNT_DEFAULTS.changeRequestsPerProject, 1, MAX_INCIDENTS_PER_PROJECT),
    serviceRequestsPerProject: normalisePositiveInteger(payload.serviceRequestsPerProject, ITSM_WORK_COUNT_DEFAULTS.serviceRequestsPerProject, 1, MAX_INCIDENTS_PER_PROJECT),
    // The user-facing form no longer asks for post-incident reviews. Force the
    // value to zero even if a stale Custom UI bundle or browser cache sends it.
    postIncidentReviewsPerProject: 0,
  };
}

function normaliseSoftwareProjectConfigs(payload = {}) {
  if (Array.isArray(payload.softwareProjects)) {
    return payload.softwareProjects
      .slice(0, 10)
      .map(project => ({
        softwareTemplate: normaliseSoftwareTemplate(project?.softwareTemplate),
        softwareProjectStyle: normaliseProjectManagementStyle(project?.softwareProjectStyle),
        issuesPerProject: normalisePositiveInteger(project?.issuesPerProject, 10, 1, MAX_ISSUES_PER_PROJECT),
      }));
  }

  const count = normalisePositiveInteger(payload.softwareProjectCount, 0, 0, 10);
  const softwareTemplate = normaliseSoftwareTemplate(payload.softwareTemplate);
  const softwareProjectStyle = normaliseProjectManagementStyle(payload.softwareProjectStyle);
  const issuesPerProject = normalisePositiveInteger(payload.issuesPerProject, 10, 1, MAX_ISSUES_PER_PROJECT);

  return Array.from({ length: count }, () => ({
    softwareTemplate,
    softwareProjectStyle,
    issuesPerProject,
  }));
}

function normaliseDashboardSelections(selections, selectedTypes, combinedPrompt, fallbackTitle) {
  const fromSelections = Array.isArray(selections)
    ? selections
        .filter(selection => selection?.value)
        .map(selection => ({
          value: String(selection.value),
          title: String(selection.label || selection.value).replace(/\s+Dashboard$/i, ' Dashboard'),
          prompt: String(selection.prompt || '').trim(),
        }))
    : [];

  if (fromSelections.length > 0) {
    return fromSelections;
  }

  const fromTypes = Array.isArray(selectedTypes)
    ? selectedTypes
        .filter(Boolean)
        .map(value => ({
          value: String(value),
          title: String(value)
            .split('-')
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' '),
          prompt: '',
        }))
    : [];

  if (fromTypes.length > 0) {
    return fromTypes;
  }

  return [{
    value: 'default',
    title: fallbackTitle,
    prompt: String(combinedPrompt || '').trim(),
  }];
}

function getSoftwareProjectConfig(config, projectIndex) {
  return config.softwareProjects?.[projectIndex] || {
    softwareTemplate: normaliseSoftwareTemplate(config.softwareTemplate),
    softwareProjectStyle: normaliseProjectManagementStyle(config.softwareProjectStyle),
    issuesPerProject: normalisePositiveInteger(config.issuesPerProject, 10, 1, MAX_ISSUES_PER_PROJECT),
  };
}

function getTotalItsmWorkCount(itsmWorkCounts = {}) {
  return ACTIVE_ITSM_WORK_COUNT_KEYS.reduce((total, key) => total + (Number(itsmWorkCounts[key]) || 0), 0);
}

function formatItsmWorkMix(itsmWorkCounts = {}) {
  return [
    `Incidents ${itsmWorkCounts.incidentRequestsPerProject || 0}`,
    `Problems ${itsmWorkCounts.problemRequestsPerProject || 0}`,
    `Changes ${itsmWorkCounts.changeRequestsPerProject || 0}`,
    `Service Requests ${itsmWorkCounts.serviceRequestsPerProject || 0}`,
    ...(itsmWorkCounts.postIncidentReviewsPerProject > 0 ? [`Post-incident Reviews ${itsmWorkCounts.postIncidentReviewsPerProject}`] : []),
  ].join(', ');
}

function normalisePayload(payload) {
  const environmentName = String(payload.environmentName || '').trim();
  const rawIndustry = String(payload.industry || 'Banking').trim();
  const rawCustomIndustry = String(payload.customIndustry || '').trim();
  const isCustomIndustry = Boolean(payload.isCustomIndustry || rawIndustry.toLowerCase() === 'other' || rawIndustry.toLowerCase() === 'others');
  const industry = isCustomIndustry
    ? (rawCustomIndustry || rawIndustry || 'Custom Business')
    : rawIndustry;
  const opsDashboardPrompt = String(payload.opsDashboardPrompt || payload.dashboardPrompt || '').trim();
  const softwareDashboardPrompt = String(payload.softwareDashboardPrompt || '').trim();
  const opsDashboardTypes = Array.isArray(payload.opsDashboardTypes)
    ? payload.opsDashboardTypes.filter(Boolean).map(String)
    : (payload.opsDashboardType ? [String(payload.opsDashboardType)] : []);
  const softwareDashboardTypes = Array.isArray(payload.softwareDashboardTypes)
    ? payload.softwareDashboardTypes.filter(Boolean).map(String)
    : (payload.softwareDashboardType ? [String(payload.softwareDashboardType)] : []);
  const softwareTemplate = normaliseSoftwareTemplate(payload.softwareTemplate);
  const softwareProjectStyle = normaliseProjectManagementStyle(payload.softwareProjectStyle);
  const softwareProjects = normaliseSoftwareProjectConfigs(payload);
  const itsmWorkCounts = normaliseItsmWorkCounts(payload);
  const incidentsPerProject = getTotalItsmWorkCount(itsmWorkCounts);
  const opsDashboardSelections = normaliseDashboardSelections(
    payload.opsDashboardSelections,
    opsDashboardTypes,
    opsDashboardPrompt,
    'Service Management Dashboard'
  );
  const softwareDashboardSelections = normaliseDashboardSelections(
    payload.softwareDashboardSelections,
    softwareDashboardTypes,
    softwareDashboardPrompt,
    'Software Dashboard'
  );

  return {
    industry,
    customIndustry: rawCustomIndustry,
    isCustomIndustry,
    environmentName,
    opsDashboardTypes,
    opsDashboardType: opsDashboardTypes[0] || '',
    opsDashboardSelections,
    opsDashboardPrompt,
    softwareDashboardTypes,
    softwareDashboardType: softwareDashboardTypes[0] || '',
    softwareDashboardSelections,
    softwareDashboardPrompt,
    dashboardPrompt: opsDashboardPrompt,
    dashboardIntent: inferDashboardIntent(opsDashboardPrompt, industry),
    opsDashboardIntent: inferDashboardIntent(opsDashboardPrompt, industry),
    softwareDashboardIntent: inferDashboardIntent(softwareDashboardPrompt, industry),
    runSeed: payload.runSeed || null,
    dateRange: String(payload.dateRange || '6 months'),
    dateRangeDays: parseDateRangeDays(payload.dateRange),
    jsmProjectCount: normalisePositiveInteger(payload.jsmProjectCount, 1, 0, 10),
    incidentsPerProject,
    itsmWorkCounts,
    softwareProjects,
    aiGeneratedContent: payload.aiGeneratedContent || null,
    softwareProjectCount: softwareProjects.length,
    softwareTemplate: softwareProjects[0]?.softwareTemplate || softwareTemplate,
    softwareProjectStyle: softwareProjects[0]?.softwareProjectStyle || softwareProjectStyle,
    issuesPerProject: softwareProjects[0]?.issuesPerProject || normalisePositiveInteger(payload.issuesPerProject, 10, 1, MAX_ISSUES_PER_PROJECT),
    sprintsPerProject: normalisePositiveInteger(
      payload.sprintsPerProject,
      MIN_SOFTWARE_SPRINTS_PER_PROJECT,
      MIN_SOFTWARE_SPRINTS_PER_PROJECT,
      MIN_SOFTWARE_SPRINTS_PER_PROJECT
    ),
    retentionPeriodDays: ACTIVE_TICKET_RETENTION_DAYS,
    filterId: null,
  };
}

function getCycledTemplate(templates, index) {
  if (!Array.isArray(templates) || templates.length === 0) {
    return null;
  }

  const template = templates[index % templates.length];
  const cycleNumber = Math.floor(index / templates.length) + 1;

  if (cycleNumber === 1) {
    return template;
  }

  return {
    ...template,
    title: `${template.title} - Scenario ${cycleNumber}`,
  };
}

function createChunkedExecutionState(accountId) {
  return {
    metadata: {
      accountId,
      dashboardPlan: null,
      dashboardPlans: [],
      dashboardCatalog: null,
      historicalDatePatchIssues: [],
      workerDatePatch: null,
      runLabel: createRunLabel(),
    },
    results: {
      jsmProjects: [],
      softwareProjects: [],
      confluenceSpaces: [],
      dashboards: [],
      savedFilters: [],
      totalIncidents: 0,
      totalIssues: 0,
      dashboardId: null,
      dashboardName: null,
      dashboardTemplateId: null,
      dashboardViewUrl: null,
      dashboardFilterApplied: false,
      savedFilter: null,
      errors: [],
      diagnostics: [],
    },
  };
}

function buildChunkedExecutionPlan(config) {
  const content = getConfiguredContent(config);
  const runSeed = config.runSeed || Date.now();
  const steps = [{
    type: 'generate-ai-content',
    label: 'Generate AI demo content',
  }];
  const incidentCount = config.incidentsPerProject;
  const csvIssueCreation = isCsvIssueCreationMode();

  for (let projectIndex = 0; projectIndex < config.jsmProjectCount; projectIndex++) {
    steps.push({
      type: 'create-business-project',
      projectIndex,
      projectName: `${config.environmentName} - ${config.industry} Ops ${projectIndex + 1} (${runSeed})`,
      projectKeyPrefix: deriveRunProjectKeyPrefix({ ...config, runSeed }, config.industry, projectIndex),
      label: `Create JSM ITSM project ${projectIndex + 1} of ${config.jsmProjectCount}`,
    });

    steps.push({
      type: 'configure-business-date-fields',
      projectIndex,
      label: `Configure demo date fields for JSM project ${projectIndex + 1}`,
    });

    steps.push({
      type: 'configure-itsm-foundation',
      projectIndex,
      label: `Configure queues, request types, and knowledge base for JSM project ${projectIndex + 1}`,
    });

    steps.push({
      type: 'create-business-form',
      projectIndex,
      label: `Create default form for JSM project ${projectIndex + 1}`,
    });

    if (!csvIssueCreation) {
      for (let start = 0; start < incidentCount; start += INCIDENT_BATCH_SIZE) {
        steps.push({
          type: 'create-business-incidents-batch',
          projectIndex,
          start,
          count: Math.min(INCIDENT_BATCH_SIZE, incidentCount - start),
          label: `Create ITSM work items ${start + 1}-${Math.min(start + INCIDENT_BATCH_SIZE, incidentCount)} for JSM project ${projectIndex + 1}`,
        });
      }
    }
  }

  for (let projectIndex = 0; projectIndex < config.softwareProjectCount; projectIndex++) {
    const softwareProjectConfig = getSoftwareProjectConfig(config, projectIndex);
    const issueCount = softwareProjectConfig.issuesPerProject;
    const softwareTemplate = normaliseSoftwareTemplate(softwareProjectConfig.softwareTemplate);
    const usesScrumTemplate = softwareTemplate === 'scrum';

    steps.push({
      type: 'create-software-project-shell',
      projectIndex,
      projectName: `${config.environmentName} - ${config.industry} Dev ${projectIndex + 1} (${runSeed})`,
      projectKeyPrefix: deriveRunProjectKeyPrefix({ ...config, runSeed }, config.industry, projectIndex + config.jsmProjectCount),
      label: `Create software project ${projectIndex + 1} of ${config.softwareProjectCount}`,
    });

    steps.push({
      type: 'configure-software-date-fields',
      projectIndex,
      label: `Configure demo date fields for software project ${projectIndex + 1}`,
    });

    steps.push({
      type: 'create-software-form',
      projectIndex,
      label: `Check form support for software project ${projectIndex + 1}`,
    });

    for (let start = 0; start < SOFTWARE_VERSION_COUNT; start += VERSION_BATCH_SIZE) {
      steps.push({
        type: 'create-software-versions-batch',
        projectIndex,
        startRelease: start,
        count: Math.min(VERSION_BATCH_SIZE, SOFTWARE_VERSION_COUNT - start),
        label: `Create versions batch for software project ${projectIndex + 1}`,
      });
    }

    if (!csvIssueCreation) {
      const epicCount = getConfiguredContent(config).epics.length;
      for (let start = 0; start < epicCount; start += EPIC_BATCH_SIZE) {
        steps.push({
          type: 'create-software-epics-batch',
          projectIndex,
          start,
          count: Math.min(EPIC_BATCH_SIZE, epicCount - start),
          label: `Create epics ${start + 1}-${Math.min(start + EPIC_BATCH_SIZE, epicCount)} for software project ${projectIndex + 1}`,
        });
      }
    }

    steps.push({
      type: 'lookup-software-board',
      projectIndex,
      label: `Find ${softwareTemplate === 'kanban' ? 'Kanban' : 'Scrum'} board for software project ${projectIndex + 1}`,
    });

    if (!csvIssueCreation) {
      for (let start = 0; start < issueCount; start += ISSUE_BATCH_SIZE) {
        steps.push({
          type: 'create-software-issues-batch',
          projectIndex,
          start,
          count: Math.min(ISSUE_BATCH_SIZE, issueCount - start),
          label: `Create issues ${start + 1}-${Math.min(start + ISSUE_BATCH_SIZE, issueCount)} for software project ${projectIndex + 1}`,
        });
      }
    }

    if (!csvIssueCreation && usesScrumTemplate) {
      for (let sprintIndex = 0; sprintIndex < config.sprintsPerProject; sprintIndex++) {
        steps.push({
          type: 'create-software-sprint',
          projectIndex,
          sprintIndex,
          label: `Create sprint ${sprintIndex + 1} for software project ${projectIndex + 1}`,
        });
      }
    }
  }

  if (csvIssueCreation) {
    steps.push({
      type: 'generate-worker-dataset',
      label: 'Generate CSV-ready historical dataset with real project keys',
    });
  } else {
    steps.push({
      type: 'create-dependencies',
      label: 'Create links between the sample projects',
    });

    if (isRestDatePatchMode()) {
      steps.push({
        type: 'generate-worker-date-patch',
        label: 'Generate CSV date patch for REST-created issues',
      });
    }
  }

  steps.push({
    type: 'prepare-dashboard-catalog',
    label: 'Prepare dashboard gadget catalog',
  });

  const dashboardTargets = [];
  const opsDashboardSelections = config.opsDashboardSelections?.length
    ? config.opsDashboardSelections
    : [{ value: 'default', title: 'Service Management Dashboard', prompt: '' }];
  const softwareDashboardSelections = config.softwareDashboardSelections?.length
    ? config.softwareDashboardSelections
    : [{ value: 'default', title: 'Software Dashboard', prompt: '' }];
  const isEnterpriseDashboardSelection = selection => (
    inferDashboardIntent(selection.prompt, config.industry, selection.value).level === 'Enterprise'
  );
  const isSoftwareProjectLevelDashboardAllowed = (selection, projectConfig) => {
    const selectionValue = String(selection?.value || '').toLowerCase();
    const softwareTemplate = normaliseSoftwareTemplate(projectConfig?.softwareTemplate || config.softwareTemplate);

    if (selectionValue.startsWith('scrum-')) {
      return softwareTemplate === 'scrum';
    }

    if (selectionValue.startsWith('kanban-')) {
      return softwareTemplate === 'kanban';
    }

    return true;
  };

  for (const dashboardSelection of opsDashboardSelections.filter(isEnterpriseDashboardSelection)) {
    dashboardTargets.push({
      dashboardIndex: dashboardTargets.length,
      projectKind: 'business-enterprise',
      dashboardSelection,
      label: `Enterprise ITSM ${dashboardSelection.title}`,
    });
  }

  for (let projectIndex = 0; projectIndex < config.jsmProjectCount; projectIndex += 1) {
    for (const dashboardSelection of opsDashboardSelections.filter(selection => !isEnterpriseDashboardSelection(selection))) {
      dashboardTargets.push({
        dashboardIndex: dashboardTargets.length,
        projectKind: 'business',
        projectIndex,
        dashboardSelection,
        label: `ITSM project ${projectIndex + 1} ${dashboardSelection.title}`,
      });
    }
  }

  for (const dashboardSelection of softwareDashboardSelections.filter(isEnterpriseDashboardSelection)) {
    dashboardTargets.push({
      dashboardIndex: dashboardTargets.length,
      projectKind: 'software-enterprise',
      dashboardSelection,
      label: `Enterprise Dev ${dashboardSelection.title}`,
    });
  }

  for (let projectIndex = 0; projectIndex < config.softwareProjectCount; projectIndex += 1) {
    const projectConfig = getSoftwareProjectConfig(config, projectIndex);
    const projectLevelSelections = softwareDashboardSelections
      .filter(selection => !isEnterpriseDashboardSelection(selection))
      .filter(selection => isSoftwareProjectLevelDashboardAllowed(selection, projectConfig));

    for (const dashboardSelection of projectLevelSelections) {
      dashboardTargets.push({
        dashboardIndex: dashboardTargets.length,
        projectKind: 'software',
        projectIndex,
        dashboardSelection,
        label: `Dev project ${projectIndex + 1} ${dashboardSelection.title}`,
      });
    }
  }

  for (const target of dashboardTargets) {
    steps.push({
      type: 'create-dashboard-shell',
      ...target,
      label: `Create dashboard shell for ${target.label}`,
    });

    for (let gadgetIndex = 0; gadgetIndex < MANAGED_DASHBOARD_GADGET_SLOT_COUNT; gadgetIndex++) {
      steps.push({
        type: 'create-dashboard-gadget',
        ...target,
        gadgetIndex,
        label: `Configure dashboard gadget ${gadgetIndex + 1} of ${MANAGED_DASHBOARD_GADGET_SLOT_COUNT} for ${target.label}`,
      });
    }
  }

  steps.push({
    type: 'finalize-dashboard',
    label: 'Finalize the shared release dashboard',
  });

  return steps;
}

function addChunkedError(state, message) {
  state.results.errors.push(message);
}

function addChunkedDiagnostics(state, diagnostics) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return;
  }

  state.results.diagnostics.push(...diagnostics);
}

async function validateAdminAccess() {
  let accountId;
  try {
    accountId = await getCurrentUser();
  } catch (err) {
    return {
      ok: false,
      message: `Authentication Error: ${err.message}\n\nPlease ensure you are logged into Jira and try again.`,
    };
  }

  let permissions;
  try {
    permissions = await getMyGlobalPermissions();
  } catch (err) {
    return {
      ok: false,
      message: `Permission Check Error: ${err.message}\n\nTry logging out and back in, then try again.`,
    };
  }

  if (!permissions.ADMINISTER?.havePermission) {
    return {
      ok: false,
      message: 'The current user does not have the global "Administer Jira" permission.\nPlease open the app as a Jira administrator and try again.',
    };
  }

  return {
    ok: true,
    accountId,
  };
}

async function executeBusinessProjectStep(config, state, step) {
  const timestamp = Date.now();
  const projectName = step.projectName || `${config.environmentName} - ${config.industry} Ops ${step.projectIndex + 1} (${timestamp})`;
  const projectKeyPrefix = step.projectKeyPrefix || deriveRunProjectKeyPrefix(config, config.industry, step.projectIndex);

  try {
    addChunkedDiagnostics(state, [`JSM Project ${step.projectIndex + 1}: creating Jira Service Management ITSM project using template ${getJsmItsmTemplateKeys()[0]}.`]);
    const expectedKey = generateKey(projectKeyPrefix, 0);
    const existingProject = await getProjectByKeyIfExists(expectedKey);
    const project = existingProject
      ? {
          id: existingProject.id,
          key: existingProject.key,
          serviceDeskAvailable: true,
          projectTypeKey: existingProject.projectTypeKey || 'service_desk',
        }
      : await createJSMProject(projectName, state.metadata.accountId, projectKeyPrefix, state.results.diagnostics);

    if (existingProject) {
      addChunkedDiagnostics(state, [`JSM Project ${step.projectIndex + 1}: reused existing project ${existingProject.key} after a prior create attempt.`]);
    }

    state.results.jsmProjects[step.projectIndex] = {
      id: project.id,
      key: project.key,
      name: projectName,
      serviceDeskAvailable: project.serviceDeskAvailable !== false,
      projectTypeKey: project.projectTypeKey || 'service_desk',
      incidents: [],
      itsmWorkItems: [],
      smartForm: null,
      requestTypes: [],
      queues: [],
      knowledgeBase: null,
      demoDateFields: null,
      demoDateFieldsReady: false,
      configuredItsmWorkCount: config.incidentsPerProject,
      configuredItsmWorkCounts: config.itsmWorkCounts,
    };
  } catch (err) {
    state.results.jsmProjects[step.projectIndex] = {
      id: null,
      key: null,
      name: projectName,
      failed: true,
      failureMessage: err.message,
      incidents: [],
    };
    addChunkedError(state, `JSM Project ${step.projectIndex + 1}: ${err.message}`);
  }
}

async function executeBusinessDateFieldStep(state, step) {
  const project = state.results.jsmProjects[step.projectIndex];
  if (!project?.id || !project?.key) {
    addChunkedDiagnostics(state, [`JSM Project ${step.projectIndex + 1}: skipped date field setup because the ITSM/JSM project was not created.`]);
    return;
  }

  try {
    const screenSetup = await ensureDemoDateFieldsOnProjectScreens(project.id, project.key);
    addChunkedDiagnostics(state, screenSetup.diagnostics);

    project.demoDateFields = screenSetup.demoDateFields || null;
    project.demoDateFieldsReady = Boolean(screenSetup.success);

    if (!screenSetup.success) {
      addChunkedError(state, `JSM Project ${project.key}: ${screenSetup.message}`);
    }
  } catch (err) {
    addChunkedError(state, `JSM Project ${project.key}: date field setup failed: ${err.message}`);
  }
}

async function executeBusinessFormStep(config, state, step) {
  const project = state.results.jsmProjects[step.projectIndex];
  if (!project?.key) {
    addChunkedDiagnostics(state, [`JSM Project ${step.projectIndex + 1}: skipped form setup because the ITSM/JSM project was not created.`]);
    return;
  }

  try {
    const formSetup = await ensureDefaultSmartIntakeForm(project.key, project.name, config.industry);
    if (!formSetup.success) {
      addChunkedError(state, `JSM Project ${project.key}: ${formSetup.message}`);
      return;
    }

    project.smartForm = {
      id: formSetup.id || null,
      name: formSetup.name || null,
      requestTypeId: formSetup.requestTypeId || null,
      reused: Boolean(formSetup.reused),
    };

    addChunkedDiagnostics(state, [`Forms ${project.key}: ${formSetup.reused ? 'reused' : 'created'} "${formSetup.name}" (request type ${formSetup.requestTypeId})`]);
    if (formSetup.warning) {
      addChunkedDiagnostics(state, [`Forms ${project.key}: ${formSetup.warning}`]);
    }
  } catch (err) {
    addChunkedError(state, `JSM Project ${project.key}: default smart form setup failed: ${err.message}`);
  }
}

async function executeItsmFoundationStep(config, state, step) {
  const project = state.results.jsmProjects[step.projectIndex];
  if (!project?.key) {
    addChunkedDiagnostics(state, [`JSM Project ${step.projectIndex + 1}: skipped ITSM foundation setup because the ITSM/JSM project was not created.`]);
    return;
  }

  const serviceDeskId = await getServiceDeskIdWithRetry(project.key, {
    attempts: 8,
    delayMs: 1500,
    diagnostics: state.results.diagnostics,
    label: 'ITSM foundation service desk lookup',
  });
  if (!serviceDeskId) {
    addChunkedDiagnostics(state, [`ITSM foundation ${project.key}: service desk id was not found yet. Jira may still be provisioning the ITSM project.`]);
  } else {
    project.serviceDeskId = serviceDeskId;

    try {
      const requestTypes = await getServiceDeskRequestTypes(serviceDeskId);
      project.requestTypes = requestTypes.map(requestType => ({
        id: requestType.id,
        name: requestType.name,
        issueTypeId: requestType.issueTypeId || null,
      }));
      const requestTypeNames = project.requestTypes.map(requestType => requestType.name).join(', ') || 'none';
      addChunkedDiagnostics(state, [`ITSM foundation ${project.key}: request types available=${requestTypeNames}.`]);
    } catch (err) {
      addChunkedDiagnostics(state, [`ITSM foundation ${project.key}: request type lookup failed: ${err.message}`]);
    }

    try {
      const queues = await getServiceDeskQueues(serviceDeskId);
      project.queues = queues.map(queue => ({
        id: queue.id,
        name: queue.name,
      }));
      const queueNames = project.queues.map(queue => queue.name).join(', ') || 'none';
      addChunkedDiagnostics(state, [`ITSM foundation ${project.key}: queues available=${queueNames}.`]);
    } catch (err) {
      addChunkedDiagnostics(state, [`ITSM foundation ${project.key}: queue lookup failed: ${err.message}`]);
    }
  }

  const knowledgeBase = await ensureKnowledgeBaseSpace(project.key, project.name, config.industry, state.results.diagnostics);
  project.knowledgeBase = knowledgeBase;

  if (knowledgeBase.success) {
    state.results.confluenceSpaces.push(knowledgeBase);
    addChunkedDiagnostics(state, [`Knowledge base ${project.key}: created ${knowledgeBase.pages.length} page(s) for incident, problem, change, and service request guidance.`]);
  }
}

async function executeBusinessIncidentBatchStep(config, state, step) {
  const project = state.results.jsmProjects[step.projectIndex];
  if (!project?.key) {
    addChunkedDiagnostics(state, [`JSM Project ${step.projectIndex + 1}: skipped ITSM work item batch because the ITSM/JSM project was not created.`]);
    return;
  }

  const content = getConfiguredContent(config);
  const boardStatusCycle = ['To Do', 'In Progress', 'Done'];
  const demoDateFields = project.demoDateFields || await getProjectDemoDateFieldIds(project.key, state.results.diagnostics);
  project.demoDateFields = demoDateFields;
  if (!project.serviceDeskId) {
    project.serviceDeskId = await getServiceDeskIdWithRetry(project.key, {
      attempts: 4,
      delayMs: 1000,
      diagnostics: state.results.diagnostics,
      label: 'ITSM batch service desk lookup',
    });
  }
  const assignableUsers = await getAssignableUsers(project.key, state.metadata.accountId);
  addChunkedDiagnostics(state, [`Assignable users ${project.key}: ${assignableUsers.length} available for ITSM work assignment.`]);

  for (let offset = 0; offset < step.count; offset++) {
    const workIndex = step.start + offset;
    const workItem = getItsmWorkItem(content, workIndex, config.itsmWorkCounts);

    if (!workItem?.title) {
      continue;
    }

    try {
      const priority = getPriorityName(workItem.priority);
      const lifecycle = createLifecycleForIssue({
        index: workIndex,
        priority,
        issueType: workItem.workType,
        maxAgeDays: config.dateRangeDays,
      });
      const targetStatus = boardStatusCycle[workIndex % boardStatusCycle.length];
      const lifecycleForStatus = ensureResolvedLifecycleForStatus(lifecycle, targetStatus);
      const dueDate = buildDueDateFromLifecycle(lifecycleForStatus, priority, workIndex);
      const assigneeAccountId = chooseDemoAssigneeAccountId(assignableUsers, workIndex, step.projectIndex);
      let created;
      let requestTypeName = null;

      try {
        const jsmCreated = await createJsmRequestWorkItem(project, workItem, {
          diagnostics: state.results.diagnostics,
        });
        created = { key: jsmCreated.key };
        requestTypeName = jsmCreated.requestTypeName;
        await saveLifecycleProperty(created, {
          environmentName: config.environmentName,
          projectKind: 'business',
          retentionPeriodDays: config.retentionPeriodDays,
        }, lifecycleForStatus);
        await updateIssueDemoDateFields(created.key, demoDateFields, lifecycleForStatus, state.results.diagnostics);
        await updateIssueBoardVisibleFields(created.key, { assigneeAccountId, dueDate }, state.results.diagnostics);
        try {
          await jiraPut(`/rest/api/3/issue/${encodeURIComponent(created.key)}?notifyUsers=false`, {
            fields: { priority: { name: priority } },
          });
        } catch (priorityErr) {
          state.results.diagnostics.push(`Board fields ${created.key}: priority update skipped: ${priorityErr.message}`);
        }
      } catch (requestErr) {
        state.results.diagnostics.push(`ITSM work ${project.key}: request API create failed for ${workItem.workType}; falling back to Jira issue create. ${requestErr.message}`);
        created = await createIssue(project.key, workItem.title, workItem.issueType, null, priority, dueDate, null, {
          assigneeAccountId,
          demoDateFields,
          diagnostics: state.results.diagnostics,
          environmentName: config.environmentName,
          lifecycle: lifecycleForStatus,
          projectKind: 'business',
          retentionPeriodDays: config.retentionPeriodDays,
          description: workItem.description,
        });
      }
      // Keep board demos visually useful by distributing generated incidents
      // across the default board columns that exist in team-managed projects.

      if (targetStatus === 'In Progress') {
        await transitionIssue(created.key, 'In Progress');
      } else if (targetStatus === 'Done') {
        await transitionIssue(created.key, 'In Progress');
        await transitionIssue(created.key, 'Resolved');
      }

      const createdItem = {
        key: created.key,
        title: workItem.title,
        priority: workItem.priority,
        status: targetStatus,
        workType: workItem.workType,
        requestTypeName,
      };
      addHistoricalDatePatchIssue(state, {
        key: created.key,
        summary: workItem.title,
        lifecycle: lifecycleForStatus,
        status: targetStatus,
      });
      project.incidents.push(createdItem);
      project.itsmWorkItems = [...(project.itsmWorkItems || []), createdItem];
      state.results.totalIncidents++;
    } catch (err) {
      addChunkedError(state, `${workItem.workType} ${workIndex + 1} for ${project.key}: ${err.message}`);
    }
  }
}

async function executeSoftwareProjectStep(config, state, step) {
  const timestamp = Date.now();
  const projectName = step.projectName || `${config.environmentName} - ${config.industry} Dev ${step.projectIndex + 1} (${timestamp})`;
  const projectKeyPrefix = step.projectKeyPrefix || deriveRunProjectKeyPrefix(config, config.industry, step.projectIndex + config.jsmProjectCount);
  const softwareProjectConfig = getSoftwareProjectConfig(config, step.projectIndex);
  const softwareTemplate = normaliseSoftwareTemplate(softwareProjectConfig.softwareTemplate);
  const softwareProjectStyle = normaliseProjectManagementStyle(softwareProjectConfig.softwareProjectStyle);

  try {
    addChunkedDiagnostics(state, [`Software Project ${step.projectIndex + 1}: creating ${getProjectManagementStyleLabel(softwareProjectStyle)} ${softwareTemplate === 'kanban' ? 'Kanban' : 'Scrum'} project from selected dropdown values.`]);
    const expectedKey = generateKey(projectKeyPrefix, 0);
    const existingProject = await getProjectByKeyIfExists(expectedKey);
    const project = existingProject
      ? existingProject
      : await createSoftwareProject(projectName, state.metadata.accountId, projectKeyPrefix, softwareTemplate, softwareProjectStyle);

    if (existingProject) {
      addChunkedDiagnostics(state, [`Software Project ${step.projectIndex + 1}: reused existing project ${existingProject.key} after a prior create attempt.`]);
    }

    state.results.softwareProjects[step.projectIndex] = {
      id: project.id,
      key: project.key,
      name: projectName,
      issueCount: 0,
      issueKeys: [],
      issueRecords: [],
      firstIssueKey: null,
      versions: [],
      epicKeys: [],
      sprints: [],
      boardId: null,
      softwareTemplate,
      softwareProjectStyle,
      configuredIssueCount: softwareProjectConfig.issuesPerProject,
      demoDateFields: null,
      demoDateFieldsReady: false,
      skipDemoDateFieldWrites: softwareProjectStyle === 'team-managed',
      smartForm: null,
    };
  } catch (err) {
    addChunkedError(state, `Software Project ${step.projectIndex + 1}: ${err.message}`);
  }
}

async function executeSoftwareDateFieldStep(state, step) {
  const project = state.results.softwareProjects[step.projectIndex];
  if (!project?.id || !project?.key) {
    addChunkedError(state, `Software Project ${step.projectIndex + 1}: skipped date field setup because the project was not created.`);
    return;
  }

  if (project.skipDemoDateFieldWrites) {
    project.demoDateFields = {};
    project.demoDateFieldsReady = false;
    addChunkedDiagnostics(state, [
      `Date fields ${project.key}: skipped custom Created Date / Resolved Date writes because team-managed Software projects do not expose classic screens reliably. Dashboard date visuals now use custom demo date fields only, so date-based trend visuals may be empty for this project unless Jira allows those fields on the project.`,
    ]);
    return;
  }

  try {
    const screenSetup = await ensureDemoDateFieldsOnProjectScreens(project.id, project.key);
    addChunkedDiagnostics(state, screenSetup.diagnostics);

    project.demoDateFields = screenSetup.demoDateFields || null;
    project.demoDateFieldsReady = Boolean(screenSetup.success);

    if (!screenSetup.success) {
      addChunkedError(state, `Software Project ${project.key}: ${screenSetup.message}`);
    }
  } catch (err) {
    addChunkedError(state, `Software Project ${project.key}: date field setup failed: ${err.message}`);
  }
}

async function executeSoftwareFormStep(config, state, step) {
  const project = state.results.softwareProjects[step.projectIndex];
  if (!project?.key) {
    addChunkedError(state, `Software Project ${step.projectIndex + 1}: skipped form setup because the project was not created.`);
    return;
  }

  try {
    const formSetup = await ensureDefaultSoftwareWorkForm(project.key, project.name, config.industry);
    if (!formSetup.success) {
      if (formSetup.unsupported) {
        addChunkedDiagnostics(state, [formSetup.message]);
      } else {
        addChunkedError(state, `Software Project ${project.key}: ${formSetup.message}`);
      }
      return;
    }

    project.smartForm = {
      id: formSetup.id || null,
      name: formSetup.name || null,
      issueTypeId: formSetup.issueTypeId || null,
      issueTypeName: formSetup.issueTypeName || null,
      reused: Boolean(formSetup.reused),
    };

    addChunkedDiagnostics(state, [`Forms ${project.key}: ${formSetup.reused ? 'reused' : 'created'} "${formSetup.name}" (issue type ${formSetup.issueTypeName || formSetup.issueTypeId})`]);
    if (formSetup.warning) {
      addChunkedDiagnostics(state, [`Forms ${project.key}: ${formSetup.warning}`]);
    }
  } catch (err) {
    addChunkedError(state, `Software Project ${project.key}: default work form setup failed: ${err.message}`);
  }
}

async function executeSoftwareVersionBatchStep(state, step) {
  const project = state.results.softwareProjects[step.projectIndex];
  if (!project?.id || !project?.key) {
    addChunkedError(state, `Software Project ${step.projectIndex + 1}: skipped version batch because the project was not created.`);
    return;
  }

  for (let offset = 0; offset < step.count; offset++) {
    const releaseIndex = (step.startRelease ?? step.startMonth ?? 0) + offset;
    const releasePlan = getSoftwareReleasePlan(project, releaseIndex);

    try {
      const createdVersion = await createVersion(project.id, releasePlan.name, releasePlan.releaseDate, releasePlan.released);
      project.versions.push({
        ...createdVersion,
        name: createdVersion.name || releasePlan.name,
        releaseDate: createdVersion.releaseDate || releasePlan.releaseDate,
        released: Boolean(createdVersion.released ?? releasePlan.released),
        releaseStage: releasePlan.stage,
        methodology: releasePlan.methodology,
      });
      addChunkedDiagnostics(state, [`Version ${project.key}: created ${releasePlan.stage} ${releasePlan.name} (${releasePlan.releaseDate}).`]);
    } catch (err) {
      addChunkedError(state, `Version ${releasePlan.name} for ${project.key}: ${err.message}`);
    }
  }
}

async function executeSoftwareEpicBatchStep(config, state, step) {
  const project = state.results.softwareProjects[step.projectIndex];
  if (!project?.key) {
    addChunkedError(state, `Software Project ${step.projectIndex + 1}: skipped epic batch because the project was not created.`);
    return;
  }

  const epics = getConfiguredContent(config).epics;
  const demoDateFields = project.skipDemoDateFieldWrites
    ? {}
    : (project.demoDateFields || await getProjectDemoDateFieldIds(project.key, state.results.diagnostics));
  const assignableUsers = await getAssignableUsers(project.key, state.metadata.accountId);
  project.demoDateFields = demoDateFields;

  for (let offset = 0; offset < step.count; offset++) {
    const epicIndex = step.start + offset;
    const epicName = epics[epicIndex];

    if (!epicName) {
      continue;
    }

    try {
      const dueDate = getDateString(30 + (epicIndex * 14));
      const assigneeAccountId = chooseDemoAssigneeAccountId(assignableUsers, epicIndex, step.projectIndex);
      const epicPriorities = ['Highest', 'High', 'Medium', 'Low'];
      const epicPriority = epicPriorities[epicIndex % epicPriorities.length];
      const lifecycle = createLifecycleForIssue({
        index: epicIndex,
        priority: epicPriority,
        issueType: 'Epic',
        maxAgeDays: config.dateRangeDays,
      });
      const epic = await createEpic(project.key, epicName, {
        assigneeAccountId,
        dueDate,
        priority: epicPriority,
        demoDateFields,
        diagnostics: state.results.diagnostics,
        environmentName: config.environmentName,
        lifecycle,
        projectKind: 'software',
        retentionPeriodDays: config.retentionPeriodDays,
      });
      project.epicKeys.push(epic.key);
      addHistoricalDatePatchIssue(state, {
        key: epic.key,
        summary: epicName,
        lifecycle,
        status: lifecycle.targetStatus,
      });
    } catch (err) {
      addChunkedError(state, `Epic "${epicName}" for ${project.key}: ${err.message}`);
    }
  }
}

async function executeSoftwareBoardLookupStep(config, state, step) {
  const project = state.results.softwareProjects[step.projectIndex];
  if (!project?.key) {
    addChunkedError(state, `Software Project ${step.projectIndex + 1}: skipped board lookup because the project was not created.`);
    return;
  }

  try {
    const softwareTemplate = normaliseSoftwareTemplate(project.softwareTemplate || config.softwareTemplate);
    project.boardId = await getBoardId(project.key, softwareTemplate);

    if (!project.boardId) {
      project.boardId = await createSoftwareBoardForProject(project, softwareTemplate);
      if (project.boardId) {
        addChunkedDiagnostics(state, [`Board ${project.key}: created ${softwareTemplate} board ${project.boardId} because Jira did not expose one automatically.`]);
      }
    }
  } catch (err) {
    addChunkedError(state, `Board lookup for ${project.key}: ${err.message}`);
  }
}

async function executeSoftwareIssueBatchStep(config, state, step) {
  const project = state.results.softwareProjects[step.projectIndex];
  if (!project?.key) {
    addChunkedError(state, `Software Project ${step.projectIndex + 1}: skipped issue batch because the project was not created.`);
    return;
  }

  const content = getConfiguredContent(config);
  const priorities = ['Highest', 'High', 'High', 'Medium', 'Medium', 'Medium', 'Low', 'Lowest'];
  const demoDateFields = project.skipDemoDateFieldWrites
    ? {}
    : (project.demoDateFields || await getProjectDemoDateFieldIds(project.key, state.results.diagnostics));
  project.demoDateFields = demoDateFields;
  const assignableUsers = await getAssignableUsers(project.key, state.metadata.accountId);
  const softwareTemplate = normaliseSoftwareTemplate(project.softwareTemplate || config.softwareTemplate);

  for (let offset = 0; offset < step.count; offset++) {
    const issueIndex = step.start + offset;
    const template = getCycledTemplate(content.issues, issueIndex);

    if (!template) {
      continue;
    }

    try {
      const priority = priorities[issueIndex % priorities.length];
      const lifecycle = createLifecycleForIssue({
        index: issueIndex,
        priority,
        issueType: template.type,
        maxAgeDays: config.dateRangeDays,
      });
      const assigneeAccountId = chooseDemoAssigneeAccountId(assignableUsers, issueIndex, step.projectIndex);
      const status = getDemoDevStatus(issueIndex);
      const lifecycleForStatus = ensureResolvedLifecycleForStatus(lifecycle, status);
      const dueDate = buildDueDateFromLifecycle(lifecycleForStatus, priority, issueIndex);
      const releaseVersions = chooseReleaseVersionIds(project, issueIndex, template.type);
      const methodologyDescription = getSoftwareMethodologyDescription(project, issueIndex);
      const epicKey = softwareTemplate === 'kanban'
        ? null
        : project.epicKeys[issueIndex % (project.epicKeys.length || 1)] || null;
      const issue = await createIssue(
        project.key,
        template.title,
        template.type,
        epicKey,
        priority,
        dueDate,
        releaseVersions.fixVersionId,
        {
          assigneeAccountId,
          affectsVersionId: releaseVersions.affectsVersionId,
          demoDateFields,
          diagnostics: state.results.diagnostics,
          environmentName: config.environmentName,
          lifecycle: lifecycleForStatus,
          projectKind: 'software',
          retentionPeriodDays: config.retentionPeriodDays,
          description: [template.description || '', methodologyDescription].filter(Boolean).join('\n\n'),
          skipEpicLink: softwareTemplate === 'kanban',
          labels: getSoftwareMethodologyLabels(project, issueIndex, template.type),
        }
      );

      project.issueKeys.push(issue.key);
      project.issueRecords.push({
        key: issue.key,
        title: template.title,
        issueType: template.type,
        status,
        priority,
        epicKey,
        fixVersionId: releaseVersions.fixVersionId,
        affectsVersionId: releaseVersions.affectsVersionId,
        methodologyPhase: getWaterfallPhase(issueIndex),
      });
      project.issueCount++;
      state.results.totalIssues++;

      if (!project.firstIssueKey) {
        project.firstIssueKey = issue.key;
      }

      addHistoricalDatePatchIssue(state, {
        key: issue.key,
        summary: template.title,
        lifecycle: lifecycleForStatus,
        status,
      });

      if (status !== 'To Do') {
        await transitionIssue(issue.key, status);
      }
    } catch (err) {
      addChunkedError(state, `Issue ${issueIndex + 1} for ${project.key}: ${err.message}`);
    }
  }
}

async function executeSoftwareSprintStep(config, state, step) {
  const project = state.results.softwareProjects[step.projectIndex];
  if (!project?.key) {
    addChunkedError(state, `Software Project ${step.projectIndex + 1}: skipped sprint ${step.sprintIndex + 1} because the project was not created.`);
    return;
  }

  if (normaliseSoftwareTemplate(project.softwareTemplate || config.softwareTemplate) !== 'scrum') {
    addChunkedDiagnostics(state, [`Sprint ${project.key}: skipped because Jira Kanban boards do not support sprints.`]);
    return;
  }

  if (!project.boardId) {
    try {
      project.boardId = await getBoardId(project.key, 'scrum');

      if (!project.boardId) {
        project.boardId = await createSoftwareBoardForProject(project, 'scrum');
        addChunkedDiagnostics(state, [`Sprint ${project.key}: created Scrum board ${project.boardId} during sprint setup.`]);
      }
    } catch (err) {
      addChunkedError(state, `Sprint ${step.sprintIndex + 1} for ${project.key}: board lookup/create failed: ${err.message}`);
      return;
    }
  }

  if (!project.boardId) {
    addChunkedError(state, `Sprint ${step.sprintIndex + 1} for ${project.key}: Scrum board not found, so sprint creation was skipped.`);
    return;
  }

  if (project.issueKeys.length === 0) {
    addChunkedError(state, `Sprint ${step.sprintIndex + 1} for ${project.key}: no issues were created, so the sprint was skipped.`);
    return;
  }

  try {
    const chunkSize = Math.max(1, Math.ceil(project.issueKeys.length / config.sprintsPerProject));
    const schedule = getSprintSchedule(step.sprintIndex);
    const sprint = await createSprint(project.boardId, `${project.key} Sprint ${step.sprintIndex + 1}`, schedule.startDate, schedule.endDate);
    const issueChunk = project.issueKeys.slice(step.sprintIndex * chunkSize, (step.sprintIndex + 1) * chunkSize);

    if (issueChunk.length > 0) {
      await moveIssuesToSprint(sprint.id, issueChunk);
      addChunkedDiagnostics(state, [`Sprint ${sprint.id}: moved ${issueChunk.length} issue(s) into ${sprint.name}.`]);
    }

    if (schedule.targetState === 'closed') {
      try {
        await updateSprint(sprint.id, {
          name: sprint.name,
          startDate: formatDateForJira(schedule.startDate),
          endDate: formatDateForJira(schedule.endDate),
          state: 'active',
        });
        await updateSprint(sprint.id, {
          name: sprint.name,
          startDate: formatDateForJira(schedule.startDate),
          endDate: formatDateForJira(schedule.endDate),
          completeDate: formatDateForJira(schedule.endDate),
          state: 'closed',
        });
        addChunkedDiagnostics(state, [`Sprint ${sprint.id}: completed historical sprint ${sprint.name}.`]);
      } catch (sprintStateErr) {
        addChunkedDiagnostics(state, [`Sprint ${sprint.id}: historical closed-state update skipped: ${sprintStateErr.message}`]);
      }
    } else if (schedule.shouldActivate) {
      try {
        await updateSprint(sprint.id, {
          name: sprint.name,
          startDate: formatDateForJira(schedule.startDate),
          endDate: formatDateForJira(schedule.endDate),
          state: 'active',
        });
        addChunkedDiagnostics(state, [`Sprint ${sprint.id}: started active sprint ${sprint.name}.`]);
      } catch (sprintStateErr) {
        addChunkedDiagnostics(state, [`Sprint ${sprint.id}: active-state update skipped: ${sprintStateErr.message}`]);
      }
    }

    project.sprints.push({
      id: sprint.id,
      name: sprint.name,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      state: schedule.targetState || (schedule.shouldActivate ? 'active' : 'future'),
      issueCount: issueChunk.length,
    });
  } catch (err) {
    addChunkedError(state, `Sprint ${step.sprintIndex + 1} for ${project.key}: ${err.message}`);
  }
}

async function executeDependencyStep(state) {
  const linked = [];

  const linkAndTrack = async (fromKey, toKey, typeName, label) => {
    const ok = await createIssueLink(fromKey, toKey, typeName);
    if (ok) {
      linked.push(label || `${fromKey} ${typeName} ${toKey}`);
    }
  };

  try {
    for (const project of state.results.softwareProjects || []) {
      const records = project?.issueRecords || [];

      for (let index = 1; index < Math.min(records.length, 8); index += 1) {
        const current = records[index];
        const previous = records[index - 1];

        if (!current?.key || !previous?.key) {
          continue;
        }

        if (String(current.issueType || '').toLowerCase() === 'bug') {
          await linkAndTrack(current.key, previous.key, 'Blocks', `Software dependency: defect ${current.key} blocks ${previous.key}.`);
        } else if (current.epicKey) {
          await linkAndTrack(current.key, current.epicKey, 'Relates', `Software traceability: ${current.key} relates to epic ${current.epicKey}.`);
        } else if (index % 3 === 0) {
          await linkAndTrack(current.key, previous.key, 'Relates', `Software dependency: ${current.key} relates to ${previous.key}.`);
        }
      }
    }

    if (state.results.softwareProjects.length >= 2) {
      const firstSoftwareIssue = state.results.softwareProjects[0]?.firstIssueKey;
      const secondSoftwareIssue = state.results.softwareProjects[1]?.firstIssueKey;

      if (firstSoftwareIssue && secondSoftwareIssue) {
        await linkAndTrack(firstSoftwareIssue, secondSoftwareIssue, 'Blocks', `Cross-project software dependency: ${firstSoftwareIssue} blocks ${secondSoftwareIssue}.`);
      }
    }

    for (const jsmProject of state.results.jsmProjects || []) {
      const workItems = jsmProject?.itsmWorkItems || jsmProject?.incidents || [];
      const firstIncident = workItems.find(item => item.workType === 'Incident')?.key;
      const firstProblem = workItems.find(item => item.workType === 'Problem')?.key;
      const firstChange = workItems.find(item => item.workType === 'Change')?.key;
      const firstServiceRequest = workItems.find(item => item.workType === 'Service Request')?.key;

      if (firstIncident && firstProblem) {
        await linkAndTrack(firstProblem, firstIncident, 'Relates', `ITSM relationship: problem ${firstProblem} relates to incident ${firstIncident}.`);
      }

      if (firstProblem && firstChange) {
        await linkAndTrack(firstChange, firstProblem, 'Relates', `ITSM relationship: change ${firstChange} relates to problem ${firstProblem}.`);
      }

      if (firstServiceRequest && firstChange) {
        await linkAndTrack(firstServiceRequest, firstChange, 'Relates', `ITSM relationship: service request ${firstServiceRequest} relates to change ${firstChange}.`);
      }
    }

    if (state.results.jsmProjects.length > 0 && state.results.softwareProjects.length > 0) {
      const firstIncident = state.results.jsmProjects[0]?.itsmWorkItems?.find(item => item.workType === 'Incident')?.key
        || state.results.jsmProjects[0]?.incidents?.[0]?.key;
      const firstSoftwareIssue = state.results.softwareProjects[0]?.firstIssueKey;

      if (firstIncident && firstSoftwareIssue) {
        await linkAndTrack(firstSoftwareIssue, firstIncident, 'Blocks', `DevOps relationship: software issue ${firstSoftwareIssue} blocks incident ${firstIncident}.`);
      }
    }

    if (linked.length > 0) {
      addChunkedDiagnostics(state, linked.slice(0, 12));
    }
  } catch (err) {
    addChunkedError(state, `Dependencies: ${err.message}`);
  }
}

function buildManagedDashboardPlan(config, availableGadgets, state, dashboardContext = null) {
  const seenKeys = new Set();
  const matchedGadgets = [];
  const dashboardIntent = dashboardContext?.dashboardIntent
    || (dashboardContext?.projectTypeLabel === 'Dev'
      ? config.softwareDashboardIntent
      : config.opsDashboardIntent);
  const orderedPlans = orderDashboardGadgetPlans(MANAGED_DASHBOARD_GADGET_PLANS, dashboardIntent);

  for (const plan of orderedPlans) {
    if (plan.disabled) {
      continue;
    }

    const match = findDashboardGadget(
      availableGadgets,
      plan,
      plan.allowDuplicate ? new Set() : seenKeys
    );

    if (!match) {
      if (plan.required) {
        addChunkedError(state, `Dashboard: could not find a required "${plan.role}" gadget in Jira's gadget catalog.`);
      }
      continue;
    }

    const identity = match.moduleKey || match.uri;
    if (!plan.allowDuplicate) {
      seenKeys.add(identity);
    }

    matchedGadgets.push({
      role: plan.role,
      title: plan.title || `${config.environmentName} ${plan.titleSuffix}`,
      subtitle: plan.subtitle || '',
      visualType: plan.visualType || 'standard',
      sectionLabel: plan.sectionLabel || '',
      moduleKey: match.moduleKey,
      uri: match.uri,
    });
  }

  return matchedGadgets;
}

async function executeDashboardCatalogStep(config, state) {
  try {
    const availableGadgets = await getAvailableDashboardGadgets();
    state.metadata.dashboardCatalog = {
      availableGadgets,
    };
  } catch (err) {
    addChunkedError(state, `Dashboard catalog: ${err.message}`);
  }
}

async function executeDashboardShellStep(config, state, step) {
  try {
    const dashboardContext = getDashboardProjectContext(config, state, step || {});
    if (!dashboardContext) {
      addChunkedDiagnostics(state, [`Dashboard skipped: project for ${step?.label || 'this dashboard'} was not created successfully.`]);
      return;
    }

    const filter = await ensureProjectSavedFilter(state, dashboardContext);
    const dashboard = await createDashboard(dashboardContext.dashboardName);
    const dashboardRecord = {
      id: dashboard.id,
      name: dashboard.name,
      viewUrl: dashboard.view || null,
      templateId: 'managed-layout',
      filterApplied: false,
      filterId: filter?.id || null,
      projectKey: dashboardContext.projectKeys.join(','),
      projectType: dashboardContext.projectTypeLabel,
      dashboardProfile: dashboardContext.dashboardProfile,
    };

    state.results.dashboards[dashboardContext.dashboardIndex] = dashboardRecord;

    if (!state.results.dashboardId) {
      state.results.dashboardId = dashboard.id;
      state.results.dashboardName = dashboard.name;
      state.results.dashboardViewUrl = dashboard.view || null;
      state.results.dashboardTemplateId = 'managed-layout';
      state.results.dashboardFilterApplied = false;
    }

    if (!filter) {
      state.metadata.dashboardPlans = state.metadata.dashboardPlans || [];
      state.metadata.dashboardPlans[dashboardContext.dashboardIndex] = {
        mode: 'empty',
        gadgets: [],
      };
      return;
    }

    state.metadata.dashboardPlans = state.metadata.dashboardPlans || [];
    state.metadata.dashboardPlans[dashboardContext.dashboardIndex] = {
      mode: 'managed',
      filterId: filter.id,
      gadgets: buildManagedDashboardPlan(config, state.metadata.dashboardCatalog?.availableGadgets || [], state, dashboardContext),
      context: dashboardContext,
    };
  } catch (err) {
    addChunkedError(state, `Dashboard: ${err.message}`);
  }
}

async function executeDashboardGadgetStep(config, state, step) {
  const dashboardRecord = state.results.dashboards?.[step.dashboardIndex];
  const dashboardId = dashboardRecord?.id;
  const plan = state.metadata.dashboardPlans?.[step.dashboardIndex];
  const filter = state.results.savedFilters?.[step.dashboardIndex];
  const dashboardContext = plan?.context;

  if (!dashboardId || !plan || plan.mode !== 'managed' || !filter) {
    return;
  }

  const gadgetPlan = plan.gadgets?.[step.gadgetIndex];
  if (!gadgetPlan) {
    return;
  }

  const row = Math.floor(step.gadgetIndex / 2);
  const column = step.gadgetIndex % 2;

  try {
    const added = await addDiscoveredDashboardGadget(dashboardId, {
      title: gadgetPlan.title,
      moduleKey: gadgetPlan.moduleKey,
      uri: gadgetPlan.uri,
      row,
      column,
    });

    if (gadgetPlan.role.startsWith('forge-')) {
      await configureForgeDemoGadget(dashboardId, added.id, gadgetPlan, state, filter, config, dashboardContext);
      dashboardRecord.filterApplied = true;
      state.results.dashboardFilterApplied = true;
      return;
    }

    if (gadgetPlan.role === 'text') {
      await configureTextGadget(dashboardId, added.id, state, filter);
      return;
    }

    if (gadgetPlan.role === 'filter-results') {
      await configureFilterResultsGadget(dashboardId, added.id, filter);
      await applyFilterToDashboardGadget(dashboardId, added.id, filter);
      dashboardRecord.filterApplied = true;
      state.results.dashboardFilterApplied = true;
      return;
    }

    if (gadgetPlan.role === 'pie-chart-status') {
      await configurePieChartGadget(dashboardId, added.id, filter, 'statuses', gadgetPlan.title);
      await applyFilterToDashboardGadget(dashboardId, added.id, filter);
      dashboardRecord.filterApplied = true;
      state.results.dashboardFilterApplied = true;
      return;
    }

    if (gadgetPlan.role === 'pie-chart-priority') {
      await configurePieChartGadget(dashboardId, added.id, filter, 'priorities', gadgetPlan.title);
      await applyFilterToDashboardGadget(dashboardId, added.id, filter);
      dashboardRecord.filterApplied = true;
      state.results.dashboardFilterApplied = true;
      return;
    }

    if (gadgetPlan.role === 'pie-chart-assignee') {
      await configurePieChartGadget(dashboardId, added.id, filter, 'assignees', gadgetPlan.title);
      await applyFilterToDashboardGadget(dashboardId, added.id, filter);
      dashboardRecord.filterApplied = true;
      state.results.dashboardFilterApplied = true;
      return;
    }

    if (gadgetPlan.role === 'created-vs-resolved') {
      await configureFilterDrivenChartGadget(dashboardId, added.id, filter, {
        daysprevious: '30',
        periodName: 'daily',
        isCumulative: 'true',
      });
      dashboardRecord.filterApplied = true;
      state.results.dashboardFilterApplied = true;
      return;
    }

    if (gadgetPlan.role === 'average-age') {
      await configureFilterDrivenChartGadget(dashboardId, added.id, filter, {
        daysprevious: '30',
        periodName: 'daily',
      });
      dashboardRecord.filterApplied = true;
      state.results.dashboardFilterApplied = true;
      return;
    }

    if (gadgetPlan.role === 'recently-created') {
      await configureFilterDrivenChartGadget(dashboardId, added.id, filter, {
        daysprevious: '30',
        periodName: 'daily',
      });
      dashboardRecord.filterApplied = true;
      state.results.dashboardFilterApplied = true;
    }
  } catch (err) {
    addChunkedError(state, `Gadget "${gadgetPlan.title}" for dashboard ${dashboardId}: ${err.message}`);
  }
}

async function searchDemoDashboardIssues(jql, customDateFields = {}) {
  const customFieldIds = [
    customDateFields.createdDateFieldId,
    customDateFields.resolvedDateFieldId,
  ].filter(Boolean);
  const data = await jiraPost('/rest/api/3/search/jql', {
    jql,
    maxResults: 1000,
    // Dashboard visuals must use the demo timeline fields generated by this app,
    // not Jira's native Created / Resolved system fields. Native Created reflects
    // the actual API insertion time, which would make every demo trend bunch up
    // around the run time instead of the selected ticket data duration.
    fields: ['summary', 'status', 'priority', 'assignee', 'issuetype', 'duedate', 'project', 'fixVersions', ...customFieldIds],
  });
  return Array.isArray(data.issues) ? data.issues : [];
}

function getDemoCreatedDate(issue, config = {}) {
  return getCustomDemoCreatedDate(issue, config);
}

function getDashboardResolvedDate(issue, config = {}) {
  const isDone = issue.fields?.status?.statusCategory?.key === 'done';
  return isDone ? getCustomDemoResolvedDate(issue, config) : null;
}

function getCustomDemoCreatedDate(issue, config = {}) {
  const customFieldId = config.customDateFields?.createdDateFieldId;
  return customFieldId ? issue.fields?.[customFieldId] || null : null;
}

function getCustomDemoResolvedDate(issue, config = {}) {
  const customFieldId = config.customDateFields?.resolvedDateFieldId;
  return customFieldId ? issue.fields?.[customFieldId] || null : null;
}

function countIssuesByField(issues, fieldName, fallback) {
  const counts = new Map();

  for (const issue of issues) {
    const fieldValue = issue.fields?.[fieldName];
    const name = fieldValue?.name || fieldValue?.displayName || fallback;
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function countOverdueIssuesByProject(issues) {
  const today = new Date().toISOString().split('T')[0];
  const counts = new Map();

  for (const issue of issues) {
    const dueDate = issue.fields?.duedate;
    const statusCategory = issue.fields?.status?.statusCategory?.key;

    if (!dueDate || dueDate >= today || statusCategory === 'done') {
      continue;
    }

    const projectKey = issue.fields?.project?.key || 'Unknown';
    counts.set(projectKey, (counts.get(projectKey) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function buildTicketAging(issues, config = {}) {
  const buckets = [
    { name: '0-7 days', count: 0 },
    { name: '8-14 days', count: 0 },
    { name: '15-30 days', count: 0 },
    { name: '31+ days', count: 0 },
  ];

  for (const issue of issues) {
    if (issue.fields?.status?.statusCategory?.key === 'done') {
      continue;
    }

    const ageInDays = getWholeDaysBetween(getDemoCreatedDate(issue, config));
    if (ageInDays === null) {
      continue;
    }

    if (ageInDays <= 7) {
      buckets[0].count += 1;
    } else if (ageInDays <= 14) {
      buckets[1].count += 1;
    } else if (ageInDays <= 30) {
      buckets[2].count += 1;
    } else {
      buckets[3].count += 1;
    }
  }

  return buckets;
}

function buildEscalationMetrics(issues) {
  const today = new Date().toISOString().split('T')[0];
  const sevenDaysFromNow = addDays(new Date(), 7).toISOString().split('T')[0];
  const metrics = {
    'Within SLA': 0,
    'Nearing Breach': 0,
    'SLA Breached': 0,
    'High Priority': 0,
  };

  for (const issue of issues) {
    if (issue.fields?.status?.statusCategory?.key === 'done') {
      continue;
    }

    const dueDate = issue.fields?.duedate;
    const priority = issue.fields?.priority?.name || '';

    if (['Highest', 'High', 'Critical'].includes(priority)) {
      metrics['High Priority'] += 1;
    }

    if (dueDate && dueDate < today) {
      metrics['SLA Breached'] += 1;
    } else if (dueDate && dueDate <= sevenDaysFromNow) {
      metrics['Nearing Breach'] += 1;
    } else {
      metrics['Within SLA'] += 1;
    }
  }

  return Object.entries(metrics).map(([name, count]) => ({ name, count }));
}

function buildDashboardReports(config) {
  const baseJql = config.allWorkJql || config.jql || '';
  const baseWithoutOrder = baseJql.replace(/\s+ORDER\s+BY\s+.+$/i, '').trim();
  const buildIssueSearchUrl = suffix => {
    const jql = baseWithoutOrder ? `${baseWithoutOrder}${suffix}` : suffix.replace(/^ AND /, '');
    return `/issues/?jql=${encodeURIComponent(jql)}`;
  };
  const profile = config.dashboardProfile || 'Dashboard';
  const primaryKpi = config.dashboardKpis?.[0] || 'delivery risk';

  return [
    {
      name: `${profile}: urgent work`,
      description: `High-priority records supporting the ${primaryKpi} conversation.`,
      issueSearchUrl: buildIssueSearchUrl(' AND priority in (Highest, High, Critical)'),
    },
    {
      name: `${profile}: risk queue`,
      description: 'Open work ordered for follow-up, aging, and escalation review.',
      issueSearchUrl: buildIssueSearchUrl(' AND statusCategory != Done ORDER BY duedate ASC'),
    },
    {
      name: `${profile}: completed trend`,
      description: 'Resolved work for trend, throughput, and closure discussion.',
      issueSearchUrl: buildIssueSearchUrl(' AND statusCategory = Done ORDER BY duedate DESC'),
    },
  ];
}

function getWholeDaysBetween(startValue, endValue = new Date()) {
  if (!startValue || !endValue) {
    return null;
  }

  const start = new Date(startValue);
  const end = new Date(endValue);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

function buildAverageTimeInStatus(issues, config = {}) {
  const totalsByStatus = new Map();

  for (const issue of issues) {
    const statusName = issue.fields?.status?.name || 'Unknown';
    // Use the generated custom Created Date only. Jira's native status category
    // timestamp changes during this demo run and makes the chart look current.
    const statusStartedAt = getDemoCreatedDate(issue, config);
    const ageInDays = getWholeDaysBetween(statusStartedAt);
    if (ageInDays === null) {
      continue;
    }

    const current = totalsByStatus.get(statusName) || { name: statusName, totalDays: 0, count: 0 };

    current.totalDays += ageInDays;
    current.count += 1;
    totalsByStatus.set(statusName, current);
  }

  return Array.from(totalsByStatus.values())
    .map(item => ({
      name: item.name,
      count: item.count === 0 ? 0 : Math.round((item.totalDays / item.count) * 10) / 10,
      issueCount: item.count,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function createEmptyCreatedResolvedBuckets(days = 30) {
  const buckets = [];
  const now = new Date();

  for (let offset = days - 1; offset >= 0; offset--) {
    const date = addDays(now, -offset).toISOString().split('T')[0];
    buckets.push({ name: date, created: 0, resolved: 0 });
  }

  return buckets;
}

function formatMonthBucketName(date) {
  return date.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function formatShortDateBucketName(date) {
  return date.toLocaleString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
}

function getTrendBucketKey(date, mode) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) {
    return null;
  }

  if (mode === 'month') {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}`;
  }

  if (mode === 'week') {
    const day = value.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = addDays(value, mondayOffset);
    return monday.toISOString().split('T')[0];
  }

  return value.toISOString().split('T')[0];
}

function createCreatedResolvedBucketsForDuration(days = 30) {
  const safeDays = Math.max(30, Math.min(730, Number.parseInt(days, 10) || 30));
  const now = new Date();
  const start = addDays(now, -(safeDays - 1));
  const mode = safeDays > 120 ? 'month' : safeDays > 45 ? 'week' : 'day';
  const buckets = [];

  if (mode === 'month') {
    let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    while (cursor <= end) {
      buckets.push({
        key: getTrendBucketKey(cursor, mode),
        name: formatMonthBucketName(cursor),
        created: 0,
        resolved: 0,
      });
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
  } else {
    const stepDays = mode === 'week' ? 7 : 1;
    let cursor = mode === 'week'
      ? new Date(`${getTrendBucketKey(start, mode)}T00:00:00.000Z`)
      : new Date(start);

    while (cursor <= now) {
      buckets.push({
        key: getTrendBucketKey(cursor, mode),
        name: mode === 'week' ? `Week of ${formatShortDateBucketName(cursor)}` : cursor.toISOString().split('T')[0],
        created: 0,
        resolved: 0,
      });
      cursor = addDays(cursor, stepDays);
    }
  }

  return {
    mode,
    buckets,
    bucketByKey: new Map(buckets.map(bucket => [bucket.key, bucket])),
  };
}

function buildCreatedResolvedTrend(issues, days = 30, config = {}) {
  const { mode, buckets, bucketByKey } = createCreatedResolvedBucketsForDuration(days);

  for (const issue of issues) {
    // This chart intentionally uses only the demo custom fields created by the
    // app. Jira's native Created/Resolved fields reflect the actual API create
    // time, which would flatten the demo timeline and make the trend misleading.
    const createdDate = getCustomDemoCreatedDate(issue, config);
    const createdKey = getTrendBucketKey(createdDate, mode);

    if (createdKey && bucketByKey.has(createdKey)) {
      bucketByKey.get(createdKey).created += 1;
    }

    // Only completed work should count as resolved in the trend. Open tickets
    // may have a future forecast in the custom Resolved Date field, but that is
    // not an actual resolution event.
    const isDone = issue.fields?.status?.statusCategory?.key === 'done';

    if (isDone) {
      const resolvedDate = getCustomDemoResolvedDate(issue, config);
      const resolvedKey = getTrendBucketKey(resolvedDate, mode);
      if (resolvedKey && bucketByKey.has(resolvedKey)) {
        bucketByKey.get(resolvedKey).resolved += 1;
      }
    }
  }

  return buckets;
}

function buildSprintHealth(issues, projects) {
  const softwareProjects = projects.filter(project => project.type === 'Software');
  const total = issues.length;
  const done = issues.filter(issue => issue.fields?.status?.statusCategory?.key === 'done').length;
  const inProgress = issues.filter(issue => issue.fields?.status?.statusCategory?.key === 'indeterminate').length;
  const todo = Math.max(total - done - inProgress, 0);

  return {
    total,
    done,
    inProgress,
    todo,
    activeSprints: softwareProjects.flatMap(project => project.sprints || []).filter(sprint => sprint.state === 'active'),
  };
}

function buildRoadmap(projects) {
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysFromNow = addDays(new Date(), 30).toISOString().split('T')[0];

  return projects
    .filter(project => project.type === 'Software')
    .flatMap(project => (project.versions || []).map(version => ({
      projectKey: project.key,
      name: version.name,
      releaseDate: version.releaseDate,
      released: version.released,
    })))
    .filter(version => version.releaseDate && version.releaseDate >= today && version.releaseDate <= thirtyDaysFromNow)
    .sort((a, b) => String(a.releaseDate || '').localeCompare(String(b.releaseDate || '')));
}

function calculateAverageResolutionDays(issues, config = {}) {
  const resolvedIssues = issues
    .filter(issue => issue.fields?.status?.statusCategory?.key === 'done')
    .map(issue => ({
      createdAt: getDemoCreatedDate(issue, config),
      resolvedAt: getDashboardResolvedDate(issue, config),
    }))
    .map(item => getWholeDaysBetween(item.createdAt, item.resolvedAt))
    .filter(days => days !== null);

  if (resolvedIssues.length === 0) {
    return null;
  }

  const totalDays = resolvedIssues.reduce((sum, days) => sum + days, 0);

  return Math.round((totalDays / resolvedIssues.length) * 10) / 10;
}

function buildDashboardKpiCards(config, issues) {
  const total = issues.length;
  const done = issues.filter(issue => issue.fields?.status?.statusCategory?.key === 'done').length;
  const open = Math.max(total - done, 0);
  const highPriority = issues.filter(issue => ['Highest', 'High', 'Critical'].includes(issue.fields?.priority?.name || '')).length;
  const criticalPriority = issues.filter(issue => ['Highest', 'Critical'].includes(issue.fields?.priority?.name || '')).length;
  const defects = issues.filter(issue => String(issue.fields?.issuetype?.name || '').toLowerCase().includes('bug')).length;
  const openDefects = issues.filter(issue => (
    String(issue.fields?.issuetype?.name || '').toLowerCase().includes('bug') &&
    issue.fields?.status?.statusCategory?.key !== 'done'
  )).length;
  const inProgress = issues.filter(issue => issue.fields?.status?.statusCategory?.key === 'indeterminate').length;
  const overdue = countOverdueIssuesByProject(issues).reduce((sum, item) => sum + item.count, 0);
  const resolutionRate = total === 0 ? 0 : Math.round((done / total) * 100);
  const breachRate = open === 0 ? 0 : Math.round((overdue / open) * 100);
  const averageResolutionDays = calculateAverageResolutionDays(issues, config);
  const openRate = total === 0 ? 0 : Math.round((open / total) * 100);
  const highPriorityRate = total === 0 ? 0 : Math.round((highPriority / total) * 100);
  const defectRate = total === 0 ? 0 : Math.round((defects / total) * 100);
  const openDefectRate = total === 0 ? 0 : Math.round((openDefects / total) * 100);
  const flowEfficiency = total === 0 ? 0 : Math.round((done / Math.max(done + inProgress + open, 1)) * 100);
  const projectHealthScore = Math.max(0, Math.min(100, 100 - breachRate - Math.round(highPriorityRate / 2) - Math.round(openDefectRate / 2)));
  const releaseSuccess = Math.max(0, 100 - openDefectRate - Math.round(breachRate / 2));
  const onTimeDelivery = Math.max(0, 100 - breachRate);
  const valueByKpi = {
    'sla compliance %': { value: `${onTimeDelivery}%`, detail: `${overdue} open ticket(s) past due` },
    'sla achievement %': { value: `${onTimeDelivery}%`, detail: `${overdue} ticket(s) currently breaching due date` },
    'response sla %': { value: `${onTimeDelivery}%`, detail: 'Open due-date risk proxy' },
    'resolution sla %': { value: `${resolutionRate}%`, detail: 'Done work / total work' },
    'breach %': { value: `${breachRate}%`, detail: 'Open work past due' },
    'sla breach %': { value: `${breachRate}%`, detail: 'Open work past due' },
    mttr: { value: averageResolutionDays === null ? 'N/A' : `${averageResolutionDays}d`, detail: averageResolutionDays === null ? 'No resolved custom date data yet' : 'Custom Created Date to Resolved Date' },
    'first response time': { value: averageResolutionDays === null ? 'N/A' : `${averageResolutionDays}d`, detail: 'Custom date lifecycle proxy' },
    'average response time': { value: averageResolutionDays === null ? 'N/A' : `${averageResolutionDays}d`, detail: 'Custom date lifecycle proxy' },
    'average resolution time': { value: averageResolutionDays === null ? 'N/A' : `${averageResolutionDays}d`, detail: 'Custom date lifecycle proxy' },
    'resolution rate %': { value: `${resolutionRate}%`, detail: `${done} of ${total} completed` },
    'closure %': { value: `${resolutionRate}%`, detail: `${done} of ${total} completed` },
    'incident closure rate': { value: `${resolutionRate}%`, detail: `${done} of ${total} completed` },
    'problem closure rate': { value: `${resolutionRate}%`, detail: `${done} of ${total} completed` },
    'problem closure %': { value: `${resolutionRate}%`, detail: `${done} of ${total} completed` },
    'request distribution %': { value: total === 0 ? '0%' : '100%', detail: `${total} tickets in dashboard scope` },
    'demand distribution %': { value: total === 0 ? '0%' : '100%', detail: `${total} tickets in dashboard scope` },
    throughput: { value: done, detail: 'Completed work items' },
    'average throughput': { value: done, detail: 'Completed work items' },
    'project health score': { value: `${projectHealthScore}%`, detail: 'Adjusted for SLA, priority, and defect risk' },
    'on-time delivery %': { value: `${onTimeDelivery}%`, detail: `${overdue} overdue open item(s)` },
    'delivery predictability %': { value: `${Math.max(0, 100 - breachRate - Math.round(openRate / 4))}%`, detail: 'Due-date and open-work proxy' },
    'milestone completion %': { value: `${resolutionRate}%`, detail: `${done} of ${total} completed` },
    'release success %': { value: `${releaseSuccess}%`, detail: `${openDefects} open defect risk item(s)` },
    'release readiness %': { value: `${Math.max(0, resolutionRate - openDefectRate)}%`, detail: 'Completion adjusted by open defects' },
    'deployment success %': { value: `${releaseSuccess}%`, detail: 'Release risk proxy from open defects' },
    'defect leakage %': { value: `${defectRate}%`, detail: `${defects} bug item(s) in scope` },
    'defect density': { value: `${defectRate}%`, detail: `${defects} bug item(s) / ${total} total` },
    'reopen %': { value: '0%', detail: 'Reopen status is not generated by default' },
    'escaped defect rate %': { value: `${openDefectRate}%`, detail: `${openDefects} open bug item(s)` },
    'sprint completion %': { value: `${resolutionRate}%`, detail: `${done} of ${total} sprint item(s) done` },
    velocity: { value: done, detail: 'Completed sprint work items' },
    'average velocity': { value: done, detail: 'Completed sprint work items' },
    'burndown adherence %': { value: `${Math.max(0, 100 - openRate)}%`, detail: `${open} item(s) still open` },
    'scope change %': { value: '0%', detail: 'Scope-change events are not generated by default' },
    'flow efficiency %': { value: `${flowEfficiency}%`, detail: `${done} completed, ${inProgress} in progress` },
    'average cycle time': { value: averageResolutionDays === null ? 'N/A' : `${averageResolutionDays}d`, detail: 'Custom Created Date to Resolved Date' },
    'average lead time': { value: averageResolutionDays === null ? 'N/A' : `${averageResolutionDays}d`, detail: 'Custom Created Date to Resolved Date' },
    'wip compliance %': { value: `${Math.max(0, 100 - openRate)}%`, detail: `${open} active work item(s)` },
    'capacity utilization %': { value: open === 0 ? '0%' : `${Math.min(100, openRate)}%`, detail: 'Open work / total work' },
    'utilization %': { value: open === 0 ? '0%' : `${Math.min(100, openRate)}%`, detail: 'Open work / total work' },
    'queue backlog %': { value: `${total === 0 ? 0 : Math.round((open / total) * 100)}%`, detail: `${open} open work items` },
    'workload balance ratio': { value: highPriority, detail: 'High-priority assigned work proxy' },
    'escalation %': { value: `${highPriorityRate}%`, detail: 'High priority / total work' },
    'escalation rate': { value: `${highPriorityRate}%`, detail: 'High priority / total work' },
    'major incident frequency': { value: criticalPriority, detail: 'Critical/highest priority work' },
    'csat score': { value: 'N/A', detail: 'CSAT field is not captured in generated tickets' },
    csat: { value: 'N/A', detail: 'CSAT field is not captured in generated tickets' },
    'service availability %': { value: 'N/A', detail: 'Availability telemetry is not captured in Jira tickets' },
    'service satisfaction score': { value: 'N/A', detail: 'CSAT field is not captured in generated tickets' },
    'portal adoption %': { value: 'N/A', detail: 'Portal analytics are not captured by this generator' },
    'knowledge deflection %': { value: 'N/A', detail: 'Requires portal/search analytics' },
    'article usefulness %': { value: 'N/A', detail: 'Requires knowledge feedback analytics' },
    'search success rate': { value: 'N/A', detail: 'Requires knowledge search analytics' },
    'asset utilization %': { value: 'N/A', detail: 'Requires JSM Assets data' },
    'compliance %': { value: 'N/A', detail: 'Requires asset compliance data' },
  };

  return (config.dashboardKpis || []).slice(0, 4).map(kpi => {
    const normalized = String(kpi).toLowerCase();
    const calculated = valueByKpi[normalized] || { value: total, detail: 'Tickets in dashboard scope' };
    return {
      label: kpi,
      value: calculated.value,
      detail: calculated.detail,
    };
  });
}

function buildDashboardDataNotes(config) {
  const notes = [];
  if (!config.customDateFields?.createdDateFieldId || !config.customDateFields?.resolvedDateFieldId) {
    notes.push({
      label: 'Custom demo date fields',
      message: 'Created/Resolved trend visuals use only the generated Created Date and Resolved Date custom fields. Jira native Created/Resolved fields are not used.',
    });
  }

  const unsupportedSignals = [
    'csat',
    'service availability',
    'portal',
    'knowledge deflection',
    'article',
    'search',
    'asset',
    'license',
    'warranty',
    'test',
    'automation coverage',
    'deployment frequency',
    'build success',
    'pipeline',
  ];
  const requestedSignals = [
    ...(config.dashboardMetrics || []),
    ...(config.dashboardKpis || []),
  ];
  const missingSignals = requestedSignals.filter(signal => {
    const normalized = String(signal || '').toLowerCase();
    return unsupportedSignals.some(unsupported => normalized.includes(unsupported));
  });

  if (missingSignals.length === 0) {
    return notes;
  }

  return notes.concat(Array.from(new Set(missingSignals)).slice(0, 4).map(signal => ({
    label: signal,
    message: 'Not captured in generated Jira tickets; dashboard does not invent this value.',
  })));
}

resolver.define('getDemoDashboardGadgetData', async ({ payload }) => {
  const dashboardId = payload?.dashboardId;
  const gadgetId = payload?.gadgetId;

  if (!dashboardId || !gadgetId) {
    return {
      success: false,
      message: 'Dashboard context was not available for this gadget.',
    };
  }

  try {
    const config = await getDashboardItemProperty(dashboardId, gadgetId, 'config');
    const issues = config.allWorkJql ? await searchDemoDashboardIssues(config.allWorkJql, config.customDateFields || {}) : [];
    const projects = config.projects || [];
    const sprintHealth = buildSprintHealth(issues, projects);

    return {
      success: true,
      config,
      issues: issues.map(issue => ({
        key: issue.key,
        summary: issue.fields?.summary || '',
        status: issue.fields?.status?.name || 'Unknown',
        priority: issue.fields?.priority?.name || 'None',
        assignee: issue.fields?.assignee?.displayName || 'Unassigned',
        issueType: issue.fields?.issuetype?.name || 'Issue',
        projectKey: issue.fields?.project?.key || '',
        dueDate: issue.fields?.duedate || null,
      })),
      statusCounts: countIssuesByField(issues, 'status', 'Unknown'),
      priorityCounts: countIssuesByField(issues, 'priority', 'None'),
      issueTypeCounts: countIssuesByField(issues, 'issuetype', 'Issue'),
      kpiCards: buildDashboardKpiCards(config, issues),
      dataNotes: buildDashboardDataNotes(config),
      overdueByProject: countOverdueIssuesByProject(issues),
      averageTimeInStatus: buildAverageTimeInStatus(issues, config),
      ticketAging: buildTicketAging(issues, config),
      escalationMetrics: buildEscalationMetrics(issues),
      reports: buildDashboardReports(config),
      drilldowns: {
        allWork: { url: `/issues/?jql=${encodeURIComponent(config.allWorkJql || config.jql || '')}` },
        open: { url: `/issues/?jql=${encodeURIComponent(config.jql || config.allWorkJql || '')}` },
        slaBreached: {
          url: `/issues/?jql=${encodeURIComponent(`${(config.allWorkJql || config.jql || '').replace(/\s+ORDER\s+BY\s+.+$/i, '').trim()} AND statusCategory != Done ORDER BY duedate ASC`)}`,
        },
      },
      createdResolvedTrend: buildCreatedResolvedTrend(issues, config.dateRangeDays || 30, config),
      sprintHealth,
      burndown: [
        { name: 'To Do', count: sprintHealth.todo },
        { name: 'In Progress', count: sprintHealth.inProgress },
        { name: 'Done', count: sprintHealth.done },
      ],
      roadmap: buildRoadmap(projects),
    };
  } catch (err) {
    return {
      success: false,
      message: err.message,
    };
  }
});

async function finalizeDashboardStep(state) {
  const createdDashboards = state.results.dashboards?.filter(Boolean) || [];
  if (createdDashboards.length === 0 && !state.results.dashboardId) {
    return;
  }

  for (const dashboard of createdDashboards) {
    if (!dashboard.filterApplied) {
      addChunkedError(state, `Dashboard ${dashboard.id}: no filter-driven gadget was configured successfully.`);
    }
  }
}

function addUniqueChunkedError(state, message) {
  if (!state.results.errors.includes(message)) {
    addChunkedError(state, message);
  }
}

function validateGeneratedVolumeAccuracy(config, state) {
  if (state.metadata.volumeValidationComplete) {
    return;
  }

  if (isCsvIssueCreationMode()) {
    state.metadata.volumeValidationComplete = true;
    return;
  }

  const createdJsmProjects = state.results.jsmProjects.filter(project => project?.key && !project.failed);
  const expectedItsmPerProject = config.incidentsPerProject;

  for (const project of createdJsmProjects) {
    const actual = project.incidents?.length || 0;
    const expected = project.configuredItsmWorkCount ?? expectedItsmPerProject;

    if (actual !== expected) {
      addUniqueChunkedError(
        state,
        `Volume mismatch ${project.key}: expected ${expected} ITSM work item(s) from selected counts (${formatItsmWorkMix(config.itsmWorkCounts)}), but created ${actual}.`
      );
    }
  }

  for (const [projectIndex, project] of state.results.softwareProjects.entries()) {
    if (!project?.key || project.failed) {
      continue;
    }

    const expected = project.configuredIssueCount || getSoftwareProjectConfig(config, projectIndex).issuesPerProject;
    const actual = project.issueCount || 0;

    if (actual !== expected) {
      addUniqueChunkedError(
        state,
        `Volume mismatch ${project.key}: expected ${expected} software issue(s) from the selected Issues value, but created ${actual}. Epics are excluded from this selected issue count and from software dashboard filters.`
      );
    }
  }

  const expectedItsmTotal = createdJsmProjects.length * expectedItsmPerProject;
  if (state.results.totalIncidents !== expectedItsmTotal) {
    addUniqueChunkedError(
      state,
      `Volume mismatch total ITSM work: expected ${expectedItsmTotal}, but created ${state.results.totalIncidents}.`
    );
  }

  const expectedSoftwareTotal = state.results.softwareProjects
    .filter(item => item?.key && !item.failed)
    .reduce((total, project) => total + (project.configuredIssueCount || 0), 0);
  if (state.results.totalIssues !== expectedSoftwareTotal) {
    addUniqueChunkedError(
      state,
      `Volume mismatch total software issues: expected ${expectedSoftwareTotal}, but created ${state.results.totalIssues}.`
    );
  }

  state.metadata.volumeValidationComplete = true;
}

function buildChunkedSummary(config, state) {
  validateGeneratedVolumeAccuracy(config, state);

  const results = state.results;
  const createdJsmProjects = results.jsmProjects.filter(project => project?.key && !project.failed);
  const hasProjects = createdJsmProjects.length > 0 || results.softwareProjects.length > 0;
  const softwareTemplates = Array.from(new Set((config.softwareProjects || []).map(project => normaliseSoftwareTemplate(project.softwareTemplate))));
  const softwareStyles = Array.from(new Set((config.softwareProjects || []).map(project => getProjectManagementStyleLabel(project.softwareProjectStyle))));
  const softwareTemplateSummary = softwareTemplates.length === 0
    ? normaliseSoftwareTemplate(config.softwareTemplate)
    : softwareTemplates.map(template => template === 'kanban' ? 'Kanban' : 'Scrum').join(', ');
  const softwareStyleSummary = softwareStyles.length === 0
    ? getProjectManagementStyleLabel(config.softwareProjectStyle)
    : softwareStyles.join(', ');
  const scrumProjectCount = (config.softwareProjects || []).filter(project => normaliseSoftwareTemplate(project.softwareTemplate) === 'scrum').length;
  const softwareVersions = results.softwareProjects.flatMap(project => project.versions || []);
  const softwareSprints = results.softwareProjects.flatMap(project => project.sprints || []);
  const releaseStageCounts = softwareVersions.reduce((counts, version) => {
    const stage = version.releaseStage || (version.released ? 'past' : 'upcoming');
    counts[stage] = (counts[stage] || 0) + 1;
    return counts;
  }, {});
  const sprintStateCounts = softwareSprints.reduce((counts, sprint) => {
    const state = sprint.state || 'future';
    counts[state] = (counts[state] || 0) + 1;
    return counts;
  }, {});
  const dashboards = results.dashboards?.filter(Boolean) || [];
  const savedFilters = results.savedFilters?.filter(Boolean) || [];
  const confluenceSpaces = results.confluenceSpaces?.filter(space => space?.success) || [];
  const projectKeys = [
    ...createdJsmProjects.map(project => project.key),
    ...results.softwareProjects.map(project => project.key),
  ].filter(Boolean);
  const automationBlueprints = buildAutomationBlueprints(projectKeys);
  const workerDataset = state.metadata.workerDataset;
  const workerDatePatch = state.metadata.workerDatePatch;
  const workerAiBlueprint = workerDataset?.metadata?.aiBlueprint;
  const lines = [
    hasProjects
      ? `"${config.environmentName}" demo environment created successfully.`
      : `"${config.environmentName}" demo environment creation was attempted, but no resources were created.`,
    '',
    'Summary:',
    `- Industry: ${config.industry}`,
    `- Ticket Data Duration: ${config.dateRange}`,
    `- JSM ITSM Projects: ${createdJsmProjects.length} (${results.totalIncidents} ITSM work items total)`,
    `- ITSM Work Mix per JSM Project: ${formatItsmWorkMix(config.itsmWorkCounts)}`,
    `- Software Projects: ${results.softwareProjects.length} (${results.totalIssues} issues total)`,
    `- Software Templates: ${softwareTemplateSummary}`,
    `- Dev Project Management: ${softwareStyleSummary}`,
    `- Sprints per Scrum Software Project: ${scrumProjectCount > 0 ? config.sprintsPerProject : 0}`,
    `- Software Release Coverage: ${softwareVersions.length} version(s) modelled (${releaseStageCounts.past || 0} past, ${releaseStageCounts.current || 0} current, ${releaseStageCounts.upcoming || 0} upcoming); fix versions and affected versions are populated where Jira allows them.`,
    `- Sprint Coverage: ${softwareSprints.length} sprint(s) modelled (${sprintStateCounts.closed || 0} completed, ${sprintStateCounts.active || 0} active, ${sprintStateCounts.future || 0} upcoming).`,
    '- Delivery Method Coverage: Scrum/Kanban execution plus waterfall phase labels for requirements, design, build, test, and release traceability.',
    `- Ticket Lifecycle: archive generated tickets after 6 months, then delete them after 1 year in archived state`,
    `- Issue Creation Mode: ${isCsvIssueCreationMode() ? 'CSV-first historical import' : isRestDatePatchMode() ? 'Forge REST creation + CSV date patch' : 'Forge REST issue creation'}`,
    ...(isCsvIssueCreationMode()
      ? []
      : [
          '- Historical Date Strategy: generated Created Date and Resolved Date custom fields are populated from the selected ticket duration.',
          '- Native Jira Created/Updated: Jira REST keeps these as Jira audit fields from the actual create/update time.',
        ]),
    ...(isCsvIssueCreationMode()
      ? [
          `- Historical CSV Rows Generated: ${workerDataset?.success ? (workerDataset.ticketCount || 0) : 'Not generated'}`,
          `- Worker AI Blueprint: ${workerAiBlueprint?.source || 'Not confirmed'}${workerAiBlueprint?.model ? ` (${workerAiBlueprint.model})` : ''}`,
        ]
      : []),
    `- Dashboards: ${dashboards.length > 0 ? `${dashboards.length} created` : 'Not created'}`,
    `- Dashboard Template: ${results.dashboardTemplateId || 'Generated gadget layout'}`,
    `- Saved Filters: ${savedFilters.length > 0 ? `${savedFilters.length} auto-created` : 'Auto-created filter not available'}`,
    `- Knowledge Bases: ${confluenceSpaces.length > 0 ? `${confluenceSpaces.length} Confluence space(s) created` : 'Not created'}`,
    `- Dashboard Filter Wiring: ${dashboards.length > 0 && dashboards.every(dashboard => dashboard.filterApplied) ? 'Applied automatically' : 'Needs verification'}`,
    '',
  ];

  if (createdJsmProjects.length > 0) {
    lines.push('JSM ITSM Projects Created:');
    lines.push(...createdJsmProjects.map(project => `- ${project.key}: ${project.name} (${isCsvIssueCreationMode() ? 'CSV import pending' : `${project.incidents.length} ITSM work items`})`));
    const projectsWithForms = createdJsmProjects.filter(project => project.smartForm?.name);
    if (projectsWithForms.length > 0) {
      lines.push('');
      lines.push('Forms Created:');
      lines.push(...projectsWithForms.map(project => `- ${project.key}: ${project.smartForm.name} (${project.smartForm.reused ? 'reused' : 'created'})`));
    }
    const projectsWithItsmConfig = createdJsmProjects.filter(project => (project.requestTypes?.length || project.queues?.length || project.knowledgeBase?.success));
    if (projectsWithItsmConfig.length > 0) {
      lines.push('');
      lines.push('ITSM Setup:');
      lines.push(...projectsWithItsmConfig.map(project => {
        const requestTypes = (project.requestTypes || []).map(requestType => requestType.name).slice(0, 6).join(', ') || 'template defaults';
        const queues = (project.queues || []).map(queue => queue.name).slice(0, 6).join(', ') || 'template defaults';
        const kb = project.knowledgeBase?.success ? `${project.knowledgeBase.key} (${project.knowledgeBase.pages.length} pages)` : 'not created';
        return `- ${project.key}: request types=${requestTypes}; queues=${queues}; knowledge base=${kb}`;
      }));
    }
    lines.push('');
  }

  if (results.softwareProjects.length > 0) {
    lines.push('Software Projects Created:');
    lines.push(...results.softwareProjects.map(project => {
      const versions = project.versions || [];
      const sprints = project.sprints || [];
      const projectReleaseCounts = versions.reduce((counts, version) => {
        const stage = version.releaseStage || (version.released ? 'past' : 'upcoming');
        counts[stage] = (counts[stage] || 0) + 1;
        return counts;
      }, {});
      const projectSprintCounts = sprints.reduce((counts, sprint) => {
        const state = sprint.state || 'future';
        counts[state] = (counts[state] || 0) + 1;
        return counts;
      }, {});
      const releaseSummary = `${versions.length} versions: ${projectReleaseCounts.past || 0} past, ${projectReleaseCounts.current || 0} current, ${projectReleaseCounts.upcoming || 0} upcoming`;
      const sprintSummary = normaliseSoftwareTemplate(project.softwareTemplate) === 'scrum'
        ? `; sprints ${projectSprintCounts.closed || 0} done, ${projectSprintCounts.active || 0} active, ${projectSprintCounts.future || 0} upcoming`
        : '; Kanban flow/WIP labels applied';
      return `- ${project.key}: ${project.name} (${isCsvIssueCreationMode() ? 'CSV import pending' : `${project.issueCount} issues`}, ${getProjectManagementStyleLabel(project.softwareProjectStyle)}, board ${project.boardId || 'pending'}; ${releaseSummary}${sprintSummary})`;
    }));
    const softwareProjectsWithForms = results.softwareProjects.filter(project => project.smartForm?.name);
    if (softwareProjectsWithForms.length > 0) {
      lines.push('');
      lines.push('Software Forms Created:');
      lines.push(...softwareProjectsWithForms.map(project => `- ${project.key}: ${project.smartForm.name} (${project.smartForm.reused ? 'reused' : 'created'})`));
    }
    lines.push('');
  }

  if (dashboards.length > 0) {
    lines.push('Dashboards Created:');
    lines.push(...dashboards.map(dashboard => `- ${dashboard.projectKey} ${dashboard.projectType}: ${dashboard.name} (${dashboard.id})${dashboard.viewUrl ? ` - ${dashboard.viewUrl}` : ''}`));
    lines.push('');
  }

  if (savedFilters.length > 0) {
    lines.push('Saved Filters Ready:');
    lines.push(...savedFilters.map(filter => `- ${filter.name} (${filter.id})${filter.viewUrl ? ` - ${filter.viewUrl}` : ''}`));
    lines.push('');
  }

  if (isCsvIssueCreationMode()) {
    lines.push('Historical CSV Import Required:');
    if (workerDataset?.success) {
      lines.push(`- Ticket CSV: ${workerDataset.ticketCsvPath || 'worker path not returned'}`);
      lines.push(`- Release CSV: ${workerDataset.releaseCsvPath || 'worker path not returned'}`);
      lines.push('- Import this CSV through Jira External System Import to create issues with historical Created and Resolved dates.');
      lines.push('- Forge REST issue creation was skipped to avoid Jira stamping today as Created/Updated.');
    } else {
      lines.push(`- Worker dataset was not generated: ${workerDataset?.message || 'worker result not available'}`);
    }
    lines.push('');
  }

  if (isRestDatePatchMode()) {
    lines.push('Historical Date Patch CSV:');
    if (workerDatePatch?.success) {
      lines.push(`- Rows: ${workerDatePatch.ticketCount || 0} existing Jira issues`);
      lines.push('- Download it from the app using the Historical Date Patch CSV button.');
      lines.push('- Import this small CSV through Jira External System Import to update existing issue Created and Resolved dates.');
      lines.push('- Jira Cloud does not reliably import the system Updated date; it is normally set to the import/update time.');
    } else {
      lines.push(`- Date patch CSV was not generated: ${workerDatePatch?.message || 'worker result not available'}`);
    }
    lines.push('');
  }

  if (automationBlueprints.length > 0) {
    lines.push('Automation Rules To Configure:');
    for (const rule of automationBlueprints) {
      lines.push(`- ${rule.name}`);
      lines.push(`  Trigger: ${rule.trigger}`);
      lines.push(`  Condition: ${rule.condition}`);
      lines.push(`  Action: ${rule.action}`);
      if (rule.emailSubject) {
        lines.push(`  Subject: ${rule.emailSubject}`);
      }
      if (rule.emailBody) {
        lines.push('  Body:');
        lines.push(...String(rule.emailBody || '').split('\n').map(line => `    ${line}`));
      }
      lines.push(`  Scope: ${rule.scope || 'created projects'}`);
    }
    lines.push('Note: Jira Automation rule creation is not exposed through the supported Jira project/issue REST APIs used by this app. The app lists only the two requested rule blueprints and does not invent extra automation behavior.');
    lines.push('');
  }

  if (hasProjects) {
    lines.push('Final Step (Required):');
    lines.push('1. Go to Jira -> Plans');
    lines.push('2. Click "Create Plan"');
    lines.push('3. Add all projects above');
    lines.push('4. Click Save');
    lines.push('');
  }

  if (results.diagnostics.length > 0) {
    const diagnosticLines = results.diagnostics.slice(-80);
    lines.push(`Setup Diagnostics (${diagnosticLines.length}${results.diagnostics.length > diagnosticLines.length ? ` of ${results.diagnostics.length}` : ''}):`);
    lines.push(...diagnosticLines.map(item => `- ${item}`));
    lines.push('');
  }

  if (results.errors.length > 0) {
    lines.push(`Warnings / Errors (${results.errors.length}):`);
    lines.push(...results.errors.map(error => `- ${error}`));
    lines.push('');
    lines.push("If something still looks off, run 'forge logs' to inspect the resolver output.");
  } else if (hasProjects) {
    lines.push('No errors were reported. That is a Forge-tunate finish.');
  }

  return {
    success: hasProjects,
    summary: lines.join('\n'),
  };
}

resolver.define('prepareDemoEnvironment', async ({ payload }) => {
  console.log('prepareDemoEnvironment started', JSON.stringify(payload));

  const config = normalisePayload(payload);
  config.runSeed = config.runSeed || Date.now();
  if (!config.environmentName) {
    return {
      success: false,
      summary: 'Please enter an Environment Name before starting the demo creation.',
    };
  }

  const access = await validateAdminAccess();
  if (!access.ok) {
    return {
      success: false,
      summary: access.message,
    };
  }

  return {
    success: true,
    config,
    plan: buildChunkedExecutionPlan(config),
    state: createChunkedExecutionState(access.accountId),
  };
});

resolver.define('executeDemoEnvironmentStep', async ({ payload }) => {
  let config = normalisePayload(payload.config || {});
  const state = payload.state || createChunkedExecutionState(null);
  const step = payload.step;
  const startedAt = Date.now();

  if (!step?.type) {
    return {
      success: false,
      message: 'Invalid execution step.',
      state,
    };
  }

  console.log('executeDemoEnvironmentStep started', JSON.stringify({
    type: step.type,
    label: step.label,
    projectIndex: step.projectIndex,
    start: step.start,
    count: step.count,
    gadgetIndex: step.gadgetIndex,
  }));

  switch (step.type) {
    case 'generate-ai-content':
      config = await executeAiContentGenerationStep(config, state);
      break;
    case 'generate-worker-dataset':
      await executeWorkerDatasetGenerationStep(config, state);
      break;
    case 'generate-worker-date-patch':
      await executeWorkerDatePatchGenerationStep(config, state);
      break;
    case 'create-business-project':
      await executeBusinessProjectStep(config, state, step);
      break;
    case 'configure-business-date-fields':
      await executeBusinessDateFieldStep(state, step);
      break;
    case 'create-business-form':
      await executeBusinessFormStep(config, state, step);
      break;
    case 'configure-itsm-foundation':
      await executeItsmFoundationStep(config, state, step);
      break;
    case 'create-business-incidents-batch':
      await executeBusinessIncidentBatchStep(config, state, step);
      break;
    case 'create-software-project-shell':
      await executeSoftwareProjectStep(config, state, step);
      break;
    case 'configure-software-date-fields':
      await executeSoftwareDateFieldStep(state, step);
      break;
    case 'create-software-form':
      await executeSoftwareFormStep(config, state, step);
      break;
    case 'create-software-versions-batch':
      await executeSoftwareVersionBatchStep(state, step);
      break;
    case 'create-software-epics-batch':
      await executeSoftwareEpicBatchStep(config, state, step);
      break;
    case 'lookup-software-board':
      await executeSoftwareBoardLookupStep(config, state, step);
      break;
    case 'create-software-issues-batch':
      await executeSoftwareIssueBatchStep(config, state, step);
      break;
    case 'create-software-sprint':
      await executeSoftwareSprintStep(config, state, step);
      break;
    case 'create-dependencies':
      await executeDependencyStep(state);
      break;
    case 'prepare-dashboard-catalog':
      await executeDashboardCatalogStep(config, state);
      break;
    case 'create-dashboard-shell':
      await executeDashboardShellStep(config, state, step);
      break;
    case 'create-dashboard-gadget':
      await executeDashboardGadgetStep(config, state, step);
      break;
    case 'finalize-dashboard':
      await finalizeDashboardStep(state);
      break;
    default:
      return {
        success: false,
        message: `Unknown execution step: ${step.type}`,
        state,
      };
  }

  console.log('executeDemoEnvironmentStep completed', JSON.stringify({
    type: step.type,
    label: step.label,
    durationMs: Date.now() - startedAt,
  }));

  return {
    success: true,
    message: step.label || step.type,
    config,
    state,
  };
});

resolver.define('finalizeDemoEnvironment', async ({ payload }) => {
  const config = normalisePayload(payload.config || {});
  const state = payload.state || createChunkedExecutionState(null);
  return buildChunkedSummary(config, state);
});

function addDaysToDate(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function isValidDate(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

async function getIssueRetentionPropertyAsApp(issueKey) {
  try {
    return await jiraAppGet(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/properties/${encodeURIComponent(TICKET_RETENTION_PROPERTY)}`);
  } catch (err) {
    if (String(err.message || '').includes('404')) {
      return null;
    }
    throw err;
  }
}

async function setIssueRetentionPropertyAsApp(issueKey, value) {
  await jiraAppPut(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/properties/${encodeURIComponent(TICKET_RETENTION_PROPERTY)}`, value);
}

async function transitionIssueAsApp(issueKey, targetStatus) {
  const data = await jiraAppGet(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`);
  const transitions = data.transitions || [];
  const targetKey = normaliseStatusName(targetStatus);
  const aliases = targetKey === 'archived'
    ? ['archived', 'archive']
    : [targetKey];
  const transition = transitions.find(item => {
    const candidate = normaliseStatusName(item?.to?.name);
    return aliases.some(alias => candidate.includes(alias));
  });

  if (!transition) {
    console.warn(`Cleanup could not find an "${targetStatus}" transition for ${issueKey}.`);
    return false;
  }

  await jiraAppPost(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    transition: { id: String(transition.id) },
  });
  return true;
}

async function findGeneratedIssuesForCleanup() {
  const issues = [];
  let nextPageToken = null;

  for (let page = 0; page < 10; page += 1) {
    const body = {
      jql: `issue.property[${TICKET_RETENTION_PROPERTY}].retention.appliesTo = "issue" ORDER BY created ASC`,
      maxResults: 100,
      fields: ['status'],
    };

    if (nextPageToken) {
      body.nextPageToken = nextPageToken;
    }

    const data = await jiraAppPost('/rest/api/3/search/jql', body);
    issues.push(...(Array.isArray(data.issues) ? data.issues : []));

    if (!data.nextPageToken) {
      break;
    }

    nextPageToken = data.nextPageToken;
  }

  return issues;
}

async function applyRetentionPolicyToIssue(issue, now) {
  const issueKey = issue.key;
  const property = await getIssueRetentionPropertyAsApp(issueKey);
  const value = property?.value;
  const lifecycleCreatedAt = value?.lifecycle?.createdAt;

  if (!value?.retention || !isValidDate(lifecycleCreatedAt)) {
    return 'skipped-no-retention-property';
  }

  const retention = value.retention;
  const archiveAt = isValidDate(retention.retainUntil)
    ? new Date(retention.retainUntil)
    : addDaysToDate(new Date(lifecycleCreatedAt), ACTIVE_TICKET_RETENTION_DAYS);
  const archivedAt = retention.archivedAt && isValidDate(retention.archivedAt)
    ? new Date(retention.archivedAt)
    : null;
  const deleteAfter = archivedAt
    ? addDaysToDate(archivedAt, retention.archiveRetentionDays || ARCHIVE_RETENTION_DAYS)
    : null;

  if (archivedAt && deleteAfter && now >= deleteAfter) {
    await jiraAppDelete(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`);
    return 'deleted';
  }

  if (!archivedAt && now >= archiveAt) {
    await transitionIssueAsApp(issueKey, 'Archived');
    const archivedAtIso = now.toISOString();
    await setIssueRetentionPropertyAsApp(issueKey, {
      ...value,
      retention: {
        ...retention,
        archivedAt: archivedAtIso,
        deleteAfter: addDaysToDate(now, retention.archiveRetentionDays || ARCHIVE_RETENTION_DAYS).toISOString(),
      },
    });
    return 'archived';
  }

  return 'retained';
}

export async function scheduledCleanup(event) {
  const now = new Date();
  const summary = {
    retained: 0,
    archived: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
  };

  const issues = await findGeneratedIssuesForCleanup();

  for (const issue of issues) {
    try {
      const result = await applyRetentionPolicyToIssue(issue, now);
      if (result === 'archived') summary.archived += 1;
      else if (result === 'deleted') summary.deleted += 1;
      else if (result === 'retained') summary.retained += 1;
      else summary.skipped += 1;
    } catch (err) {
      summary.failed += 1;
      console.error(`Cleanup failed for ${issue.key}: ${err.message}`);
    }
  }

  console.log('scheduledCleanup completed', JSON.stringify({
    triggerTime: event?.context?.triggerTime || null,
    scanned: issues.length,
    ...summary,
  }));
}

export const handler = resolver.getDefinitions();
