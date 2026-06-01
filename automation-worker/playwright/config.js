import dotenv from 'dotenv';

dotenv.config();

export const config = {
  jiraBaseUrl: process.env.JIRA_BASE_URL || '',
  jiraImportUrl: process.env.JIRA_IMPORT_URL || '',
  email: process.env.JIRA_EMAIL || '',
  projectKey: process.env.PROJECT_KEY || '',
  csvPath: process.env.CSV_OUTPUT || 'exports/tickets.csv',
  authStatePath: 'playwright/auth.json',
  headless: process.env.HEADLESS !== 'false',
};

export function requireConfigValue(name, value) {
  if (!value) {
    throw new Error(`Missing required configuration: ${name}`);
  }
}
