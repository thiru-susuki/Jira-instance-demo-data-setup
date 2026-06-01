import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createObjectCsvWriter } from 'csv-writer';

const CSV_HEADERS = [
  { id: 'Issue key', title: 'Issue key' },
  { id: 'Issue id', title: 'Issue id' },
  { id: 'Project key', title: 'Project key' },
  { id: 'Project name', title: 'Project name' },
  { id: 'Project type', title: 'Project type' },
  { id: 'Summary', title: 'Summary' },
  { id: 'Issue Type', title: 'Issue Type' },
  { id: 'Priority', title: 'Priority' },
  { id: 'Status', title: 'Status' },
  { id: 'Created', title: 'Created' },
  { id: 'Resolved', title: 'Resolved' },
  { id: 'Fix Version/s', title: 'Fix Version/s' },
  { id: 'Affects Version/s', title: 'Affects Version/s' },
  { id: 'Component/s', title: 'Component/s' },
  { id: 'Team', title: 'Team' },
  { id: 'Causes', title: 'Causes' },
  { id: 'Relates', title: 'Relates' },
  { id: 'Blocks', title: 'Blocks' },
  { id: 'Description', title: 'Description' },
  { id: 'Labels', title: 'Labels' },
];

export async function writeTicketsCsv(records, outputPath) {
  const absoluteOutputPath = path.resolve(outputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });

  const writer = createObjectCsvWriter({
    path: absoluteOutputPath,
    header: CSV_HEADERS,
  });

  await writer.writeRecords(records);
  return absoluteOutputPath;
}

export async function writeRecordsCsv(records, outputPath, headers) {
  const absoluteOutputPath = path.resolve(outputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });

  const writer = createObjectCsvWriter({
    path: absoluteOutputPath,
    header: headers,
  });

  await writer.writeRecords(records);
  return absoluteOutputPath;
}
