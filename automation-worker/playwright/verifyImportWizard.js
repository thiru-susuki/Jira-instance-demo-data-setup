import { chromium } from 'playwright';
import { config, requireConfigValue } from './config.js';
import { info, warn } from '../utils/logger.js';

async function main() {
  requireConfigValue('JIRA_IMPORT_URL', config.jiraImportUrl);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: config.authStatePath,
  });
  const page = await context.newPage();

  page.setDefaultTimeout(15000);
  info('Opening Jira CSV import wizard', { url: config.jiraImportUrl });
  await page.goto(config.jiraImportUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  const title = await page.title();
  const currentUrl = page.url();
  const fileInputs = await page.locator('input[type="file"]').count();
  const bodyText = await page.locator('body').innerText().catch(() => '');

  info('Jira import wizard page check complete', {
    title,
    currentUrl,
    fileInputs,
  });

  if (fileInputs > 0) {
    info('CSV import file input found. Playwright can reach the import wizard.');
  } else if (/permission|access|admin|not permitted|log in|login/i.test(bodyText)) {
    warn('CSV import file input not found. This looks like an access/login/admin permission page.');
  } else {
    warn('CSV import file input not found. The import wizard UI may use different selectors or a different URL.');
  }

  info('Browser will stay open for 30 seconds for visual inspection.');
  await page.waitForTimeout(30000);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
