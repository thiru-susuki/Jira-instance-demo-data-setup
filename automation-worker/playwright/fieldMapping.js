import { info } from '../utils/logger.js';

export const csvToJiraFieldMap = {
  'Issue key': ['Issue key', 'Issue Key'],
  'Issue id': ['Issue id', 'Issue Id', 'Work item id', 'Issue Id'],
  'Project key': ['Project key', 'Project Key'],
  'Project name': ['Project name', 'Project Name'],
  'Project type': ['Project type', 'Project Type'],
  Summary: ['Summary'],
  'Issue Type': ['Issue Type', 'Work type', 'Issue type'],
  Priority: ['Priority'],
  Status: ['Status'],
  Created: ['Created', 'Created date', 'Created Date'],
  Resolved: ['Resolved', 'Resolution Date', 'Resolved date'],
  Resolution: ['Resolution'],
  'Fix Version/s': ['Fix Version/s', 'Fix versions', 'Fix Version'],
  'Affects Version/s': ['Affects Version/s', 'Affects versions', 'Affected Version'],
  'Component/s': ['Component/s', 'Components', 'Component'],
  Description: ['Description'],
  Labels: ['Labels'],
};

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
export async function getFieldMappingDiagnostics(page) {
  return await page.evaluate(() => Array.from(document.querySelectorAll('tr')).map((row, index) => {
    const select = row.querySelector('select');
    if (!select) {
      return null;
    }

    return {
      index,
      text: row.innerText.slice(0, 300),
      selectName: select.name,
      selectValue: select.value,
      options: Array.from(select.options).map(option => ({
        value: option.value,
        text: option.textContent.trim(),
      })),
    };
  }).filter(Boolean));
}

export async function mapCsvFields(page) {
  const result = await page.evaluate((fieldMap) => {
    const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const mapped = [];
    const skipped = [];

    for (const [csvColumn, jiraFieldCandidates] of Object.entries(fieldMap)) {
      const normalizedCsvColumn = normalize(csvColumn);
      const rows = Array.from(document.querySelectorAll('tr'));
      const row = rows.find(candidate => {
        const firstCellText = candidate.querySelector('th, td')?.innerText || '';
        return normalize(firstCellText) === normalizedCsvColumn;
      }) || rows.find(candidate => {
        const firstCellText = candidate.querySelector('th, td')?.innerText || candidate.innerText || '';
        return normalize(firstCellText).startsWith(normalizedCsvColumn);
      }) || rows.find(candidate => {
        const firstCellText = candidate.querySelector('th, td')?.innerText || candidate.innerText || '';
        return normalize(firstCellText).includes(normalizedCsvColumn);
      });

      if (!row) {
        skipped.push({ csvColumn, reason: 'row not found' });
        continue;
      }

      const select = row.querySelector('select');
      if (!select) {
        skipped.push({ csvColumn, reason: 'select not found' });
        continue;
      }

      const candidates = Array.isArray(jiraFieldCandidates) ? jiraFieldCandidates : [jiraFieldCandidates];
      const option = Array.from(select.options).find(item => candidates.some(candidate => (
        normalize(item.textContent) === normalize(candidate)
        || normalize(item.value) === normalize(candidate)
      ))) || Array.from(select.options).find(item => candidates.some(candidate => (
        normalize(item.textContent).includes(normalize(candidate))
        || normalize(item.value).includes(normalize(candidate))
      )));

      if (!option) {
        skipped.push({
          csvColumn,
          reason: 'matching option not found',
          availableOptions: Array.from(select.options).map(item => item.textContent.trim()).filter(Boolean).slice(0, 20),
        });
        continue;
      }

      if (select.multiple) {
        Array.from(select.options).forEach(item => {
          item.selected = false;
        });
      }

      select.disabled = false;
      select.removeAttribute('disabled');
      option.selected = true;
      select.value = option.value;
      select.setAttribute('value', option.value);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.dispatchEvent(new Event('blur', { bubbles: true }));

      const auiSelect = document.getElementById(`${select.id}-aui-select`);
      if (auiSelect) {
        auiSelect.setAttribute('data-value', option.value);
        auiSelect.setAttribute('data-selected-value', option.value);
        const textInput = auiSelect.querySelector('input[type="text"]');
        if (textInput) {
          textInput.value = option.textContent.trim();
          textInput.dispatchEvent(new Event('input', { bubbles: true }));
          textInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      mapped.push({ csvColumn, jiraField: option.textContent.trim(), value: option.value });
    }

    const form = document.querySelector('form');
    const formEntries = form
      ? Array.from(new FormData(form).entries())
        .filter(([name]) => /mapping|field/i.test(name))
        .map(([name, value]) => ({ name, value: String(value) }))
      : [];

    return { mapped, skipped, formEntries };
  }, csvToJiraFieldMap);

  info('Mapped CSV fields', result);
  return result;
}
