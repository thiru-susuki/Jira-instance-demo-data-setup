import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { writeRecordsCsv, writeTicketsCsv } from '../utils/csvWriter.js';
import { info } from '../utils/logger.js';
import {
  choosePriority,
  chooseStatus,
  chooseWeightedIssueType,
  normaliseInput,
} from './distributions.js';
import { buildDomainDescription, buildDomainSummary, getDomainContent } from './domainContent.js';
import { formatJiraDateTime, generateCreatedDate } from './generateDates.js';
import { buildReleaseCatalogRecords, buildReleaseVersions, selectVersionForTicket } from './releaseVersions.js';
import { generateResolutionDate, getSlaForTicket } from './slaRules.js';

dotenv.config();

function parseArgs(argv) {
  const values = {};

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      continue;
    }

    const key = item.slice(2);
    const next = argv[index + 1];
    values[key] = next && !next.startsWith('--') ? next : true;

    if (next && !next.startsWith('--')) {
      index += 1;
    }
  }

  return values;
}

function createInputFromEnvAndArgs() {
  const args = parseArgs(process.argv.slice(2));

  return normaliseInput({
    project: args.project || process.env.PROJECT_KEY,
    ticketCount: args.ticketCount || process.env.TICKET_COUNT,
    dateRange: args.dateRange || process.env.DATE_RANGE,
    industry: args.industry || process.env.INDUSTRY,
    incidentRatio: args.incidentRatio || process.env.INCIDENT_RATIO,
    serviceRequestRatio: args.serviceRequestRatio || process.env.SERVICE_REQUEST_RATIO,
    problemRatio: args.problemRatio || process.env.PROBLEM_RATIO,
    changeRatio: args.changeRatio || process.env.CHANGE_RATIO,
  });
}

function appendLink(record, fieldName, issueKey) {
  if (!issueKey || record['Issue key'] === issueKey) {
    return;
  }

  const existing = String(record[fieldName] || '').split(' ').filter(Boolean);
  if (!existing.includes(issueKey)) {
    record[fieldName] = [...existing, issueKey].join(' ');
  }
}

function linkRecords(recordsByType) {
  const incidents = recordsByType.get('Incident') || [];
  const serviceRequests = recordsByType.get('Service Request') || [];
  const problems = recordsByType.get('Problem') || [];
  const changes = recordsByType.get('Change') || [];
  const maxLinks = Math.max(incidents.length, serviceRequests.length, problems.length, changes.length);

  for (let index = 0; index < maxLinks; index += 1) {
    const incident = incidents[index % incidents.length];
    const serviceRequest = serviceRequests[index % serviceRequests.length];
    const problem = problems[index % problems.length];
    const change = changes[index % changes.length];

    if (incident && problem) {
      appendLink(problem, 'Causes', incident['Issue key']);
    }

    if (incident && change) {
      appendLink(incident, 'Relates', change['Issue key']);
      appendLink(change, 'Relates', incident['Issue key']);
    }

    if (incident && serviceRequest) {
      appendLink(incident, 'Relates', serviceRequest['Issue key']);
      appendLink(serviceRequest, 'Relates', incident['Issue key']);
    }

    if (problem && change) {
      appendLink(problem, 'Relates', change['Issue key']);
      appendLink(change, 'Relates', problem['Issue key']);
    }

    if (change && serviceRequest && index % 4 === 0) {
      appendLink(change, 'Blocks', serviceRequest['Issue key']);
    }
  }
}

function selectBlueprintScenario(aiBlueprint, issueType, index) {
  const scenarios = Array.isArray(aiBlueprint?.jsmScenarios) ? aiBlueprint.jsmScenarios : [];
  const matching = scenarios.filter(scenario => scenario.issueType === issueType);
  const pool = matching.length ? matching : scenarios;
  return pool.length ? pool[index % pool.length] : null;
}

export function generateTickets(input, options = {}) {
  const normalizedInput = normaliseInput(input);
  const domain = getDomainContent(normalizedInput.industry);
  const releaseVersions = buildReleaseVersions({
    projectKey: normalizedInput.project,
    dateRange: normalizedInput.dateRange,
  });
  const tickets = [];
  const recordsByType = new Map();

  for (let index = 0; index < normalizedInput.ticketCount; index += 1) {
    const issueType = chooseWeightedIssueType(normalizedInput, index).label;
    const blueprintScenario = selectBlueprintScenario(options.aiBlueprint, issueType, index);
    const priority = blueprintScenario?.priority || choosePriority(issueType, index);
    const createdDate = generateCreatedDate(issueType, normalizedInput.dateRange);
    const status = chooseStatus(index, issueType === 'Service Request' ? 0.82 : 0.72);
    const sla = getSlaForTicket(issueType, priority);
    const resolvedDate = status === 'Done'
      ? generateResolutionDate(createdDate, sla, { breachRate: priority === 'P1' ? 0.08 : 0.14 })
      : null;
    const summary = blueprintScenario?.summary || buildDomainSummary(issueType, normalizedInput.industry, index);
    const issueKey = `${normalizedInput.project}-${index + 1}`;
    const version = selectVersionForTicket(releaseVersions, index, issueType);
    const component = blueprintScenario?.component || domain.components[index % domain.components.length];
    const team = blueprintScenario?.team || domain.teams[index % domain.teams.length];
    const record = {
      'Issue key': issueKey,
      'Issue id': index + 1,
      'Project key': normalizedInput.project,
      'Project name': input.projectName || normalizedInput.project,
      'Project type': input.projectType || 'service_desk',
      Summary: `${summary} #${index + 1}`,
      'Issue Type': issueType,
      Priority: priority,
      Status: status,
      Created: formatJiraDateTime(createdDate),
      Resolved: resolvedDate ? formatJiraDateTime(resolvedDate) : '',
      'Fix Version/s': issueType === 'Change' || issueType === 'Problem' ? version?.name || '' : '',
      'Affects Version/s': issueType === 'Incident' ? version?.name || '' : '',
      'Component/s': component,
      Team: team,
      Causes: '',
      Relates: '',
      Blocks: '',
      Description: blueprintScenario?.description || buildDomainDescription({
        issueType,
        industry: normalizedInput.industry,
        component,
        team,
        versionName: version?.name,
      }),
      Labels: `demo-data,historical-import,${String(normalizedInput.industry).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    };

    tickets.push(record);
    releaseVersions[index % releaseVersions.length].issueKeys.push(issueKey);
    recordsByType.set(issueType, [...(recordsByType.get(issueType) || []), record]);
  }

  linkRecords(recordsByType);

  return {
    tickets,
    releaseVersions,
  };
}

async function main() {
  const input = createInputFromEnvAndArgs();
  const args = parseArgs(process.argv.slice(2));
  const outputPath = args.output || process.env.CSV_OUTPUT || 'exports/tickets.csv';
  const releaseOutputPath = args.releaseOutput || process.env.RELEASE_CSV_OUTPUT || 'exports/release-versions.csv';
  const { tickets, releaseVersions } = generateTickets(input);
  const writtenPath = await writeTicketsCsv(tickets, outputPath);
  const releaseWrittenPath = await writeRecordsCsv(
    buildReleaseCatalogRecords(releaseVersions),
    releaseOutputPath,
    [
      { id: 'Version name', title: 'Version name' },
      { id: 'Released', title: 'Released' },
      { id: 'Release date', title: 'Release date' },
      { id: 'Description', title: 'Description' },
      { id: 'Issue count', title: 'Issue count' },
      { id: 'Linked issue keys', title: 'Linked issue keys' },
    ]
  );

  info(`Generated ${tickets.length} ticket records`, {
    output: writtenPath,
    releaseCatalog: releaseWrittenPath,
    industry: input.industry,
    dateRange: input.dateRange,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
