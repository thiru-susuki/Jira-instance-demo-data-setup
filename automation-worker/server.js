import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { buildReleaseCatalogRecords } from './dataset/releaseVersions.js';
import { generateFromForgePayload } from './dataset/generateFromForgePayload.js';
import { generateTickets } from './dataset/generateTickets.js';
import { writeRecordsCsv, writeTicketsCsv } from './utils/csvWriter.js';
import { info } from './utils/logger.js';

dotenv.config();

const app = express();
const port = Number.parseInt(process.env.PORT || '4000', 10);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function createReleaseHeaders() {
  return [
    { id: 'Version name', title: 'Version name' },
    { id: 'Released', title: 'Released' },
    { id: 'Release date', title: 'Release date' },
    { id: 'Description', title: 'Description' },
    { id: 'Issue count', title: 'Issue count' },
    { id: 'Linked issue keys', title: 'Linked issue keys' },
  ];
}

app.get('/', (req, res) => {
  res.type('text/plain').send([
    'Jira demo data automation worker is running.',
    '',
    'Available endpoints:',
    'GET  /health',
    'POST /generate-demo',
    '',
    'Use POST /generate-demo to generate tickets.csv and release-versions.csv.',
  ].join('\n'));
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'jira-demo-data-automation-worker',
  });
});

app.post('/generate-demo', async (req, res) => {
  try {
    const payload = req.body || {};
    const outputPath = payload.output || process.env.CSV_OUTPUT || 'exports/tickets.csv';
    const releaseOutputPath = payload.releaseOutput || process.env.RELEASE_CSV_OUTPUT || 'exports/release-versions.csv';
    const generated = payload.environmentName || payload.softwareProjects || payload.jsmProjectCount
      ? await generateFromForgePayload(payload)
      : generateTickets(payload);
    const { tickets, releaseVersions } = generated;
    const ticketCsvPath = await writeTicketsCsv(tickets, outputPath);
    const releaseCsvPath = await writeRecordsCsv(
      buildReleaseCatalogRecords(releaseVersions),
      releaseOutputPath,
      createReleaseHeaders()
    );

    info('Generated demo dataset from API request', {
      ticketCount: tickets.length,
      project: payload.project,
      industry: payload.industry,
      dateRange: payload.dateRange,
      aiBlueprint: generated.metadata?.aiBlueprint || null,
    });

    res.json({
      success: true,
      ticketCount: tickets.length,
      ticketCsvPath,
      releaseCsvPath,
      releaseVersions: releaseVersions.map(version => ({
        name: version.name,
        released: version.released,
        releaseDate: version.releaseDate,
        issueCount: version.issueKeys.length,
      })),
      metadata: generated.metadata || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.post('/generate-date-patch', async (req, res) => {
  try {
    const payload = req.body || {};
    const outputPath = payload.output || process.env.DATE_PATCH_CSV_OUTPUT || 'exports/date-patch-tickets.csv';
    const issues = Array.isArray(payload.issues) ? payload.issues : [];
    const records = issues
      .filter(issue => issue?.['Issue key'] || issue?.issueKey || issue?.key)
      .map(issue => ({
        'Issue key': issue['Issue key'] || issue.issueKey || issue.key,
        'Project key': issue['Project key'] || issue.projectKey || String(issue['Issue key'] || issue.issueKey || issue.key).split('-')[0],
        Summary: issue.Summary || issue.summary || issue.title || issue.key,
        Created: issue.Created || issue.created || '',
        Resolved: issue.Resolved || issue.resolved || '',
        Resolution: issue.Resolution || issue.resolution || '',
      }));
    const ticketCsvPath = await writeRecordsCsv(records, outputPath, [
      { id: 'Issue key', title: 'Issue key' },
      { id: 'Project key', title: 'Project key' },
      { id: 'Summary', title: 'Summary' },
      { id: 'Created', title: 'Created' },
      { id: 'Resolved', title: 'Resolved' },
      { id: 'Resolution', title: 'Resolution' },
    ]);

    info('Generated date patch CSV from API request', {
      ticketCount: records.length,
      environmentName: payload.environmentName,
    });

    res.json({
      success: true,
      ticketCount: records.length,
      ticketCsvPath,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.listen(port, () => {
  info(`Automation worker API listening on http://localhost:${port}`);
});
