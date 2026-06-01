export const slaMatrix = {
  P1: { minHours: 1, maxHours: 4 },
  P2: { minHours: 4, maxHours: 12 },
  P3: { minHours: 24, maxHours: 72 },
  P4: { minHours: 72, maxHours: 168 },
  SERVICE_REQUEST: { minHours: 48, maxHours: 168 },
  PROBLEM: { minHours: 168, maxHours: 720 },
  CHANGE: { minHours: 24, maxHours: 240 },
};

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getSlaForTicket(issueType, priority) {
  if (issueType === 'Service Request') {
    return slaMatrix.SERVICE_REQUEST;
  }

  if (issueType === 'Problem') {
    return slaMatrix.PROBLEM;
  }

  if (issueType === 'Change') {
    return slaMatrix.CHANGE;
  }

  return slaMatrix[priority] || slaMatrix.P3;
}

export function generateResolutionDate(createdDate, sla, options = {}) {
  const breachRate = Number.isFinite(options.breachRate) ? options.breachRate : 0.12;
  const shouldBreach = Math.random() < breachRate;
  const minHours = shouldBreach ? sla.maxHours + 1 : sla.minHours;
  const maxHours = shouldBreach ? Math.round(sla.maxHours * 1.8) : sla.maxHours;
  const hours = randomInt(minHours, Math.max(minHours, maxHours));
  const resolved = new Date(createdDate);

  resolved.setHours(resolved.getHours() + hours);
  return resolved;
}
