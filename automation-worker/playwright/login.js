import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { config, requireConfigValue } from './config.js';
import { info } from '../utils/logger.js';

async function main() {
  requireConfigValue('JIRA_BASE_URL', config.jiraBaseUrl);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(config.jiraBaseUrl);
  info('Complete Jira login in the browser window, including MFA if prompted.');
  info('After Jira is fully loaded, return here and press Enter.');

  await new Promise(resolve => process.stdin.once('data', resolve));
  await mkdir(path.dirname(config.authStatePath), { recursive: true });
  await context.storageState({ path: config.authStatePath });
  await browser.close();
  info(`Saved Playwright auth state to ${config.authStatePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
