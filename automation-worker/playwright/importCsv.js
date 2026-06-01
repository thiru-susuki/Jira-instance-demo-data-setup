import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { mapCsvFields } from './fieldMapping.js';
import { config, requireConfigValue } from './config.js';
import { error, info } from '../utils/logger.js';

async function clickFirstVisible(page, selectors, label) {
  for (const selector of selectors) {
    const matches = page.locator(selector);
    const count = await matches.count().catch(() => 0);

    for (let index = 0; index < count; index += 1) {
      const candidate = matches.nth(index);
      const isVisible = await candidate.isVisible().catch(() => false);
      const isEnabled = await candidate.isEnabled().catch(() => false);

      if (isVisible && isEnabled) {
        info(`Clicking ${label}`, { selector });
        await candidate.scrollIntoViewIfNeeded().catch(() => {});
        await candidate.click();
        return true;
      }
    }
  }

  return false;
}

async function waitForUploadReady(page, csvPath) {
  const fileName = path.basename(csvPath);

  info('Waiting for Jira to finish processing selected CSV file.', { fileName });
  await page.getByText(fileName, { exact: false }).waitFor({
    state: 'visible',
    timeout: 60000,
  }).catch(() => {});

  await page.waitForTimeout(3000);
}

async function validateCsvHeaders(csvPath) {
  const creationHeaders = ['Project key', 'Project name', 'Project type', 'Summary', 'Issue Type', 'Created', 'Resolved'];
  const datePatchHeaders = ['Issue key', 'Project key', 'Summary', 'Created'];
  const csvText = await readFile(csvPath, 'utf8');
  const headers = csvText.split(/\r?\n/, 1)[0].split(',').map(header => header.trim().replace(/^"|"$/g, ''));
  const missingCreationHeaders = creationHeaders.filter(header => !headers.includes(header));
  const missingDatePatchHeaders = datePatchHeaders.filter(header => !headers.includes(header));
  const mode = missingCreationHeaders.length === 0 ? 'create-issues' : missingDatePatchHeaders.length === 0 ? 'date-patch-existing-issues' : 'invalid';

  info('CSV header precheck', {
    headers,
    mode,
    missingCreationHeaders,
    missingDatePatchHeaders,
  });
  if (mode === 'invalid') {
    throw new Error(`CSV is missing required Jira import headers. For date patch use: ${datePatchHeaders.join(', ')}. For creation use: ${creationHeaders.join(', ')}`);
  }

  return mode;
}

async function clickCsvImportTile(page) {
  const clicked = await clickFirstVisible(page, [
    'a[href*="csvImporter"]',
    'a:has-text("CSV")',
    'button:has-text("CSV")',
    'div:has-text("CSV") >> visible=true',
  ], 'CSV import option');

  if (clicked) {
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  return clicked;
}

async function selectProjectDefinedInCsv(page) {
  const selected = await page.evaluate(() => {
    const visible = element => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const radios = Array.from(document.querySelectorAll('input[type="radio"][name="readFromCsv"]'));
    const csvRadio = radios.find(radio => String(radio.value).toLowerCase() === 'true')
      || radios.find(radio => /csv/i.test(radio.id || ''))
      || radios[radios.length - 1];

    if (!csvRadio) {
      return { ok: false, reason: 'Could not find the "Defined in CSV" project radio option.' };
    }

    csvRadio.checked = true;
    csvRadio.dispatchEvent(new Event('input', { bubbles: true }));
    csvRadio.dispatchEvent(new Event('change', { bubbles: true }));
    csvRadio.click();

    const selects = Array.from(document.querySelectorAll('select'));
    const visibleSelectCount = selects.filter(visible).length;

    return {
      ok: true,
      selectedRadioId: csvRadio.id || '',
      selectedRadioValue: csvRadio.value || '',
      visibleSelectCount,
    };
  });

  if (!selected.ok) {
    throw new Error(selected.reason);
  }

  info('Selected project mapping from CSV.', selected);
  return true;
}

async function setDateFormat(page) {
  const changed = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
    const dateInput = inputs.find(input => /date/i.test(input.name || input.id || input.getAttribute('aria-label') || ''))
      || inputs.find(input => /dd\/MMM\/yy|SimpleDateFormat|h:mm/i.test(input.value || ''));

    if (!dateInput) {
      return false;
    }

    dateInput.focus();
    dateInput.value = 'yyyy-MM-dd HH:mm';
    dateInput.dispatchEvent(new Event('input', { bubbles: true }));
    dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });

  if (changed) {
    info('Set Jira CSV date format.');
  }

  return changed;
}

async function clickVisibleNext(page, label = 'Next') {
  const clicked = await page.evaluate((buttonText) => {
    const candidates = Array.from(document.querySelectorAll('button, input[type="submit"], a'));
    const candidate = candidates.find(element => {
      const text = element.innerText || element.value || element.textContent || '';
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const hidden = style.display === 'none'
        || style.visibility === 'hidden'
        || element.disabled
        || element.classList.contains('hiddenButton')
        || rect.width === 0
        || rect.height === 0;

      return !hidden && text.trim().toLowerCase() === buttonText.toLowerCase();
    });

    if (!candidate) {
      return false;
    }

    candidate.scrollIntoView({ block: 'center', inline: 'center' });
    candidate.click();
    return true;
  }, label);

  if (clicked) {
    info(`Clicked visible ${label} button.`);
    await page.waitForLoadState('networkidle').catch(() => {});
    return true;
  }

  const textLocator = page.getByText(label, { exact: true });
  const textCount = await textLocator.count().catch(() => 0);

  for (let index = 0; index < textCount; index += 1) {
    const candidate = textLocator.nth(index);
    const isVisible = await candidate.isVisible().catch(() => false);
    const box = isVisible ? await candidate.boundingBox().catch(() => null) : null;

    if (box && box.width > 0 && box.height > 0) {
      info(`Clicking visible ${label} text by coordinates.`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForLoadState('networkidle').catch(() => {});
      return true;
    }
  }

  return false;
}

async function submitWizardForm(page, label = 'Next') {
  const submitted = await page.evaluate((buttonText) => {
    const normalize = value => String(value || '').trim().toLowerCase();
    const candidates = Array.from(document.querySelectorAll('button, input[type="submit"], a'));
    const button = candidates.find(element => {
      const text = element.innerText || element.value || element.textContent || '';
      return normalize(text) === normalize(buttonText)
        || normalize(element.name) === 'nextbtn'
        || normalize(element.id).includes('next');
    });

    if (!button) {
      return { ok: false, reason: 'next button not found' };
    }

    if (button.disabled) {
      button.disabled = false;
      button.removeAttribute('disabled');
    }

    const form = button.closest('form') || document.querySelector('form');
    if (form?.requestSubmit) {
      form.requestSubmit(button.tagName === 'BUTTON' || button.type === 'submit' ? button : undefined);
      return { ok: true, method: 'requestSubmit', id: button.id || '', name: button.name || '' };
    }

    if (form?.submit) {
      form.submit();
      return { ok: true, method: 'form.submit', id: button.id || '', name: button.name || '' };
    }

    button.click();
    return { ok: true, method: 'button.click', id: button.id || '', name: button.name || '' };
  }, label);

  info('Submitted Jira wizard form directly', submitted);
  if (submitted.ok) {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
  }

  return submitted.ok;
}

async function submitWizardFormData(page, label = 'Next') {
  const submitted = await page.evaluate(async (buttonText) => {
    const normalize = value => String(value || '').trim().toLowerCase();
    const form = document.querySelector('form');
    if (!form) {
      return { ok: false, reason: 'form not found' };
    }

    const button = Array.from(document.querySelectorAll('button, input[type="submit"], a')).find(element => {
      const text = element.innerText || element.value || element.textContent || '';
      return normalize(text) === normalize(buttonText)
        || normalize(element.name) === 'nextbtn'
        || normalize(element.id).includes('next');
    });

    const formData = new FormData(form);
    if (button?.name) {
      formData.set(button.name, button.value || buttonText);
    }

    const response = await fetch(form.action || window.location.href, {
      method: (form.method || 'POST').toUpperCase(),
      body: formData,
      credentials: 'same-origin',
      redirect: 'follow',
    });

    const html = await response.text();
    document.open();
    document.write(html);
    document.close();

    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      action: form.action || '',
      method: form.method || 'POST',
    };
  }, label);

  info('Submitted Jira wizard form with FormData fetch', submitted);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);

  return submitted.ok;
}

async function clickSubmitInputByName(page, inputName = 'nextBtn') {
  const result = await page.evaluate((targetName) => {
    const button = Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"]'))
      .find(element => element.name === targetName);

    if (!button) {
      return { ok: false, reason: `submit input ${targetName} not found` };
    }

    if (button.disabled) {
      button.disabled = false;
      button.removeAttribute('disabled');
    }

    button.click();
    return { ok: true, id: button.id || '', name: button.name || '', value: button.value || button.textContent || '' };
  }, inputName);

  info('Clicked Jira submit input by name', result);
  if (result.ok) {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
  }
  return result.ok;
}

async function advanceWizardPage(page, label = 'Next') {
  const beforeUrl = page.url();
  const beforeText = await page.locator('body').innerText().catch(() => '');

  await clickVisibleNext(page, label);
  await page.waitForTimeout(3000);

  let afterUrl = page.url();
  let afterText = await page.locator('body').innerText().catch(() => '');
  if (afterUrl !== beforeUrl || afterText.slice(0, 500) !== beforeText.slice(0, 500)) {
    return true;
  }

  await clickSubmitInputByName(page);
  afterUrl = page.url();
  afterText = await page.locator('body').innerText().catch(() => '');

  if (afterUrl !== beforeUrl || afterText.slice(0, 500) !== beforeText.slice(0, 500)) {
    return true;
  }

  await submitWizardForm(page, label);
  afterUrl = page.url();
  afterText = await page.locator('body').innerText().catch(() => '');

  if (afterUrl !== beforeUrl || afterText.slice(0, 500) !== beforeText.slice(0, 500)) {
    return true;
  }

  await submitWizardFormData(page, label);
  afterUrl = page.url();
  afterText = await page.locator('body').innerText().catch(() => '');

  return afterUrl !== beforeUrl || afterText.slice(0, 500) !== beforeText.slice(0, 500);
}

async function getVisibleActionLabels(page) {
  return await page.evaluate(() => Array.from(document.querySelectorAll('button, input[type="submit"], a'))
    .map(element => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        text: (element.innerText || element.value || element.textContent || '').trim(),
        tag: element.tagName,
        id: element.id || '',
        className: element.className || '',
        visible: style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0,
        disabled: Boolean(element.disabled),
      };
    })
    .filter(item => item.visible));
}

async function captureProjectSetupDiagnostics(page) {
  const diagnostics = await page.evaluate(() => {
    const visible = element => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };

    return {
      url: window.location.href,
      bodyText: document.body.innerText.slice(0, 4000),
      radios: Array.from(document.querySelectorAll('input[type="radio"]')).map((radio, index) => ({
        index,
        checked: radio.checked,
        value: radio.value,
        name: radio.name,
        id: radio.id,
        visible: visible(radio),
        label: radio.closest('label')?.innerText || radio.parentElement?.innerText || '',
      })),
      selects: Array.from(document.querySelectorAll('select')).map((select, index) => ({
        index,
        name: select.name,
        id: select.id,
        value: select.value,
        visible: visible(select),
        options: Array.from(select.options).map(option => ({
          value: option.value,
          text: option.textContent.trim(),
          selected: option.selected,
        })),
      })),
      errors: Array.from(document.querySelectorAll('.error, .aui-message-error, [role="alert"]'))
        .map(element => element.innerText.trim())
        .filter(Boolean),
    };
  });

  info('Project setup diagnostics', diagnostics);
  return diagnostics;
}

async function completeProjectSetupIfPresent(page) {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const isSetupPage = /Map projects|Import to Project|Date format/i.test(bodyText);

  if (!isSetupPage) {
    return false;
  }

  info('Completing Jira project mapping setup page.');
  await page.screenshot({ path: 'exports/debug/current-project-setup-page.png', fullPage: true }).catch(() => {});
  await captureProjectSetupDiagnostics(page);
  await selectProjectDefinedInCsv(page);
  await setDateFormat(page);

  const clicked = await clickVisibleNext(page);
  if (!clicked) {
    throw new Error('Could not find a visible enabled Next button on the Jira project mapping setup page.');
  }

  await page.waitForTimeout(2000);
  await captureProjectSetupDiagnostics(page);

  return true;
}

export async function main() {
  requireConfigValue('JIRA_IMPORT_URL', config.jiraImportUrl);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: config.authStatePath,
  });
  const page = await context.newPage();
  const csvPath = path.resolve(config.csvPath);

  page.setDefaultTimeout(20000);

  try {
    const csvMode = await validateCsvHeaders(csvPath);

    info('Opening Jira CSV import wizard', { url: config.jiraImportUrl });
    await page.goto(config.jiraImportUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    await clickCsvImportTile(page);

    info('Looking for CSV file input', { csvPath });
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached' });
    await fileInput.setInputFiles(csvPath);
    await waitForUploadReady(page, csvPath);

    info('CSV file selected. Clicking file import Next.');
    const clickedFileImportNext = await clickVisibleNext(page);
    if (!clickedFileImportNext) {
      const visibleActions = await getVisibleActionLabels(page).catch(() => []);
      info('Visible actions on CSV file import page', visibleActions);
      throw new Error('Could not find a visible enabled Next button on the CSV file import page.');
    }

    if (csvMode === 'create-issues') {
      info('Waiting for Jira project setup page.');
      await page.waitForURL(/CsvProjectMappingsPage/i, { timeout: 30000 }).catch(() => {});
      await completeProjectSetupIfPresent(page);

      const bodyTextAfterSetup = await page.locator('body').innerText().catch(() => '');
      if (/CSV Source File|Import to Project|Date format/i.test(bodyTextAfterSetup)) {
        throw new Error('Jira did not advance past the file/project setup screens.');
      }
    } else {
      info('Date patch CSV detected. Using CSV project keys and mapping existing issue keys only.');
      await page.waitForURL(/CsvProjectMappingsPage|CsvFieldMappingsPage/i, { timeout: 30000 }).catch(() => {});
      await completeProjectSetupIfPresent(page);
    }

    info('Mapping CSV fields where selectors are available.');
    await mapCsvFields(page);

    info('CSV fields mapped. Clicking field mapping Next to reach value mapping.');
    const advancedFromFieldMapping = await advanceWizardPage(page);
    if (!advancedFromFieldMapping) {
      const visibleActions = await getVisibleActionLabels(page).catch(() => []);
      info('Visible actions on field mapping page', visibleActions);
      throw new Error('Jira did not advance from the field mapping page after clicking/submitting Next.');
    }

    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
    const valueMappingText = await page.locator('body').innerText().catch(() => '');
    info('Reached next CSV import page after field mapping', {
      url: page.url(),
      pagePreview: valueMappingText.slice(0, 1200),
    });

    info('Stopping before final import submission for safety.');
    info('Review the value mapping page. If it looks correct, we will enable the final import click next.');
    await page.waitForTimeout(120000);
  } catch (err) {
    await mkdir('exports/debug', { recursive: true });
    const screenshotPath = path.resolve('exports/debug/import-failure.png');
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    error('CSV import automation failed', {
      message: err.message,
      currentUrl: page.url(),
      screenshotPath,
    });
    info('Keeping browser open for 60 seconds for inspection.');
    await page.waitForTimeout(60000).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
