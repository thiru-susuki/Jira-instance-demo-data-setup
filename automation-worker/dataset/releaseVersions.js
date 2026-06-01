import { getDateRangeDays } from './distributions.js';

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

export function buildReleaseVersions({ projectKey, dateRange, now = new Date() }) {
  const days = getDateRangeDays(dateRange);
  const start = addDays(now, -days);
  const historicalSpacing = Math.max(30, Math.floor(days / 5));
  const historicalVersions = Array.from({ length: 4 }, (_, index) => {
    const releaseDate = addDays(start, historicalSpacing * (index + 1));
    const name = `${projectKey} Release ${index + 1}.0`;

    return {
      name,
      released: true,
      releaseDate: formatDate(releaseDate),
      description: `Released demo version for historical delivery and incident trend analysis.`,
      issueKeys: [],
    };
  });

  const upcomingVersions = [30, 90].map((daysFromNow, index) => ({
    name: `${projectKey} Release ${historicalVersions.length + index + 1}.1`,
    released: false,
    releaseDate: formatDate(addDays(now, daysFromNow)),
    description: `Upcoming demo version for roadmap, change, and release readiness dashboards.`,
    issueKeys: [],
  }));

  return [...historicalVersions, ...upcomingVersions];
}

export function selectVersionForTicket(versions, index, issueType) {
  if (!versions.length) {
    return null;
  }

  if (issueType === 'Change') {
    return versions[(index + 1) % versions.length];
  }

  return versions[index % versions.length];
}

export function buildReleaseCatalogRecords(versions) {
  return versions.map(version => ({
    'Version name': version.name,
    Released: version.released ? 'Yes' : 'No',
    'Release date': version.releaseDate,
    Description: version.description,
    'Issue count': version.issueKeys.length,
    'Linked issue keys': version.issueKeys.join(' '),
  }));
}
