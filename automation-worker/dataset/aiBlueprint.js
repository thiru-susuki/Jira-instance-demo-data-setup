const DEFAULT_MODEL = 'gpt-4.1-mini';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

function parseCount(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function normalizePriority(value, fallback = 'P3') {
  const normalized = String(value || '').toUpperCase();
  if (['P1', 'P2', 'P3', 'P4', 'P5'].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeIssueType(value, fallback, allowed) {
  const text = normalizeText(value, fallback);
  return allowed.includes(text) ? text : fallback;
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

function buildSchema() {
  const jsmIssueTypes = ['Incident', 'Service Request', 'Problem', 'Change'];
  const softwareIssueTypes = ['Epic', 'Story', 'Bug', 'Task'];

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      narrative: { type: 'string' },
      jsmScenarios: {
        type: 'array',
        minItems: 8,
        maxItems: 40,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            issueType: { type: 'string', enum: jsmIssueTypes },
            summary: { type: 'string' },
            description: { type: 'string' },
            service: { type: 'string' },
            component: { type: 'string' },
            team: { type: 'string' },
            priority: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4', 'P5'] },
            relationshipHint: { type: 'string' },
          },
          required: ['issueType', 'summary', 'description', 'service', 'component', 'team', 'priority', 'relationshipHint'],
        },
      },
      softwareScenarios: {
        type: 'array',
        minItems: 8,
        maxItems: 40,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            issueType: { type: 'string', enum: softwareIssueTypes },
            summary: { type: 'string' },
            description: { type: 'string' },
            component: { type: 'string' },
            team: { type: 'string' },
            priority: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4', 'P5'] },
            releaseTheme: { type: 'string' },
            dependencyHint: { type: 'string' },
          },
          required: ['issueType', 'summary', 'description', 'component', 'team', 'priority', 'releaseTheme', 'dependencyHint'],
        },
      },
      releaseThemes: {
        type: 'array',
        minItems: 4,
        maxItems: 12,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            businessOutcome: { type: 'string' },
            riskSignal: { type: 'string' },
          },
          required: ['name', 'businessOutcome', 'riskSignal'],
        },
      },
      dashboardInsights: {
        type: 'array',
        minItems: 4,
        maxItems: 16,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            dashboardType: { type: 'string' },
            audience: { type: 'string' },
            questionAnswered: { type: 'string' },
            kpis: { type: 'array', minItems: 3, maxItems: 8, items: { type: 'string' } },
          },
          required: ['dashboardType', 'audience', 'questionAnswered', 'kpis'],
        },
      },
    },
    required: ['narrative', 'jsmScenarios', 'softwareScenarios', 'releaseThemes', 'dashboardInsights'],
  };
}

function buildPrompt(payload) {
  const jsmProjectCount = parseCount(payload.jsmProjectCount, 0);
  const softwareProjects = Array.isArray(payload.softwareProjects) ? payload.softwareProjects : [];
  const jsmCounts = {
    incidents: parseCount(payload.incidentRequestsPerProject, 0),
    serviceRequests: parseCount(payload.serviceRequestsPerProject, 0),
    changes: parseCount(payload.changeRequestsPerProject, 0),
    problems: parseCount(payload.problemRequestsPerProject, 0),
  };
  const softwareSummary = softwareProjects.map((project, index) => ({
    project: index + 1,
    template: project.softwareTemplate || 'scrum',
    management: project.softwareProjectStyle || 'team-managed',
    issues: parseCount(project.issuesPerProject, 10),
  }));

  return [
    `Client/demo name: ${payload.environmentName || 'Demo client'}`,
    `Business domain: ${payload.customIndustry || payload.industry || 'banking'}`,
    `Ticket data duration: ${payload.dateRange || '6_months'}`,
    `JSM project count: ${jsmProjectCount}`,
    `JSM work mix per project: ${JSON.stringify(jsmCounts)}`,
    `Software projects: ${JSON.stringify(softwareSummary)}`,
    `Selected ITSM dashboards: ${JSON.stringify(payload.opsDashboardTypes || [])}`,
    `Selected software dashboards: ${JSON.stringify(payload.softwareDashboardTypes || [])}`,
    '',
    'Create an enterprise realistic demo-data blueprint for Jira Service Management and Jira Software.',
    'The blueprint must be specific to the domain and client, with realistic services, components, teams, operational failure modes, change themes, problem investigations, release work, sprint work, and dashboard questions.',
    'Do not create generic examples like "system issue" or "test ticket".',
    'JSM scenarios must support real-world links such as Incident caused by Problem, Incident relates to Change, Incident relates to Service Request, and Problem relates to Change.',
    'Software scenarios must support epics, stories, bugs, tasks, versions, releases, affected versions, fix versions, dependencies, sprint trends, and release readiness reporting.',
    'Return only JSON matching the schema.',
  ].join('\n');
}

function normalizeBlueprint(rawBlueprint) {
  const jsmAllowed = ['Incident', 'Service Request', 'Problem', 'Change'];
  const softwareAllowed = ['Epic', 'Story', 'Bug', 'Task'];
  const normalizeScenario = (item, index, allowed, fallbackType) => ({
    issueType: normalizeIssueType(item?.issueType, fallbackType, allowed),
    summary: normalizeText(item?.summary, `${fallbackType} scenario ${index + 1}`).slice(0, 240),
    description: normalizeText(item?.description, 'AI-generated domain-specific demo record.').slice(0, 1200),
    service: normalizeText(item?.service, ''),
    component: normalizeText(item?.component, ''),
    team: normalizeText(item?.team, ''),
    priority: normalizePriority(item?.priority),
    relationshipHint: normalizeText(item?.relationshipHint || item?.dependencyHint, ''),
    releaseTheme: normalizeText(item?.releaseTheme, ''),
  });

  const jsmScenarios = Array.isArray(rawBlueprint?.jsmScenarios)
    ? rawBlueprint.jsmScenarios.map((item, index) => normalizeScenario(item, index, jsmAllowed, 'Incident'))
    : [];
  const softwareScenarios = Array.isArray(rawBlueprint?.softwareScenarios)
    ? rawBlueprint.softwareScenarios.map((item, index) => normalizeScenario(item, index, softwareAllowed, 'Story'))
    : [];

  if (!jsmScenarios.length && !softwareScenarios.length) {
    throw new Error('OpenAI returned an empty blueprint.');
  }

  return {
    narrative: normalizeText(rawBlueprint?.narrative, ''),
    jsmScenarios,
    softwareScenarios,
    releaseThemes: Array.isArray(rawBlueprint?.releaseThemes) ? rawBlueprint.releaseThemes : [],
    dashboardInsights: Array.isArray(rawBlueprint?.dashboardInsights) ? rawBlueprint.dashboardInsights : [],
  };
}

export async function generateAiBlueprint(payload = {}) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.WORKER_OPENAI_API_KEY;
  if (!apiKey) {
    return {
      enabled: false,
      source: 'local-fallback',
      reason: 'OPENAI_API_KEY is not configured for the worker.',
      blueprint: null,
    };
  }

  const model = process.env.OPENAI_MODEL || process.env.WORKER_OPENAI_MODEL || DEFAULT_MODEL;
  const timeoutMs = parseCount(process.env.OPENAI_TIMEOUT_MS || process.env.WORKER_OPENAI_TIMEOUT_MS, 20000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'system',
            content: 'You design enterprise Jira demo-data blueprints. Return strict JSON only.',
          },
          {
            role: 'user',
            content: buildPrompt(payload),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'jira_demo_blueprint',
            schema: buildSchema(),
            strict: true,
          },
        },
        max_output_tokens: 12000,
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI blueprint generation failed: ${response.status} ${responseText}`);
    }

    const responseJson = JSON.parse(responseText);
    const outputText = extractOpenAiText(responseJson);
    const blueprint = normalizeBlueprint(JSON.parse(outputText));

    return {
      enabled: true,
      source: 'openai',
      model,
      blueprint,
    };
  } catch (err) {
    return {
      enabled: true,
      source: 'local-fallback',
      model,
      reason: err.message,
      blueprint: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}
