export const DEFAULT_INPUT = {
  project: 'ITSM',
  ticketCount: 5000,
  dateRange: '1_year',
  industry: 'banking',
  incidentRatio: 60,
  serviceRequestRatio: 25,
  problemRatio: 10,
  changeRatio: 5,
};

export const DATE_RANGES = {
  '3_months': 90,
  '6_months': 180,
  '1_year': 365,
  '12_months': 365,
};

export const ISSUE_TYPES = {
  incident: 'Incident',
  serviceRequest: 'Service Request',
  problem: 'Problem',
  change: 'Change',
};

export function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getDateRangeDays(value) {
  return DATE_RANGES[value] || DATE_RANGES[DEFAULT_INPUT.dateRange];
}

export function normaliseInput(input = {}) {
  return {
    project: String(input.project || DEFAULT_INPUT.project).trim() || DEFAULT_INPUT.project,
    ticketCount: parsePositiveInt(input.ticketCount, DEFAULT_INPUT.ticketCount),
    dateRange: String(input.dateRange || DEFAULT_INPUT.dateRange),
    industry: String(input.industry || DEFAULT_INPUT.industry).trim() || DEFAULT_INPUT.industry,
    incidentRatio: parseNonNegativeInt(input.incidentRatio, DEFAULT_INPUT.incidentRatio),
    serviceRequestRatio: parseNonNegativeInt(input.serviceRequestRatio, DEFAULT_INPUT.serviceRequestRatio),
    problemRatio: parseNonNegativeInt(input.problemRatio, DEFAULT_INPUT.problemRatio),
    changeRatio: parseNonNegativeInt(input.changeRatio, DEFAULT_INPUT.changeRatio),
  };
}

export function chooseWeightedIssueType(input, index) {
  const entries = [
    { key: 'incident', label: ISSUE_TYPES.incident, weight: input.incidentRatio },
    { key: 'serviceRequest', label: ISSUE_TYPES.serviceRequest, weight: input.serviceRequestRatio },
    { key: 'problem', label: ISSUE_TYPES.problem, weight: input.problemRatio },
    { key: 'change', label: ISSUE_TYPES.change, weight: input.changeRatio },
  ].filter(item => item.weight > 0);

  const totalWeight = entries.reduce((total, item) => total + item.weight, 0);
  if (!totalWeight) {
    return { key: 'incident', label: ISSUE_TYPES.incident, weight: 1 };
  }
  const bucket = (index * 37) % totalWeight;
  let cursor = 0;

  for (const entry of entries) {
    cursor += entry.weight;
    if (bucket < cursor) {
      return entry;
    }
  }

  return entries[0];
}

export function choosePriority(issueType, index) {
  if (issueType === ISSUE_TYPES.incident) {
    return ['P1', 'P2', 'P2', 'P3', 'P3', 'P3'][index % 6];
  }

  if (issueType === ISSUE_TYPES.problem) {
    return ['P2', 'P3', 'P3', 'P4'][index % 4];
  }

  if (issueType === ISSUE_TYPES.change) {
    return ['P2', 'P3', 'P3', 'P4'][index % 4];
  }

  return ['P3', 'P3', 'P4', 'P4'][index % 4];
}

export function chooseStatus(index, resolvedBias = 0.72) {
  const doneThreshold = Math.floor(resolvedBias * 100);
  const bucket = (index * 37) % 100;

  if (bucket < doneThreshold) {
    return 'Done';
  }

  return bucket % 2 === 0 ? 'In Progress' : 'To Do';
}
