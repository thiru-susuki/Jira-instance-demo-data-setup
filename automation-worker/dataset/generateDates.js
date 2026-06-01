import { getDateRangeDays } from './distributions.js';

const releaseWindows = [
  '2025-03-15',
  '2025-06-20',
  '2025-09-10',
];

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomDate(start, end) {
  return new Date(
    start.getTime() + Math.random() * (end.getTime() - start.getTime())
  );
}

export function formatJiraDateTime(date) {
  const pad = value => String(value).padStart(2, '0');

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

export function generateIncidentDate(start, end) {
  const weekdayBias = [1, 2, 3, 4, 5];
  let candidate = randomDate(start, end);
  const targetWeekday = weekdayBias[Math.floor(Math.random() * weekdayBias.length)];

  while (candidate.getDay() !== targetWeekday) {
    candidate = addDays(candidate, 1);
    if (candidate > end) {
      candidate = randomDate(start, end);
    }
  }

  candidate.setHours(randomInt(8, 17), randomInt(0, 59), 0, 0);
  return candidate;
}

export function generateReleaseSpikeDate(start, end) {
  const windowsInRange = releaseWindows
    .map(value => new Date(`${value}T10:00:00`))
    .filter(date => date >= start && date <= end);

  if (windowsInRange.length === 0) {
    const candidate = randomDate(start, end);
    candidate.setHours(randomInt(9, 18), randomInt(0, 59), 0, 0);
    return candidate;
  }

  const releaseDate = windowsInRange[randomInt(0, windowsInRange.length - 1)];
  const candidate = addDays(releaseDate, randomInt(-5, 7));
  candidate.setHours(randomInt(9, 18), randomInt(0, 59), 0, 0);

  if (candidate < start || candidate > end) {
    return randomDate(start, end);
  }

  return candidate;
}

export function generateCreatedDate(issueType, dateRange, now = new Date()) {
  const days = getDateRangeDays(dateRange);
  const start = addDays(now, -days);
  const shouldUseReleaseSpike = ['Incident', 'Change', 'Problem'].includes(issueType) && Math.random() < 0.28;

  if (shouldUseReleaseSpike) {
    return generateReleaseSpikeDate(start, now);
  }

  if (issueType === 'Incident') {
    return generateIncidentDate(start, now);
  }

  const candidate = randomDate(start, now);
  candidate.setHours(randomInt(8, 18), randomInt(0, 59), 0, 0);
  return candidate;
}
