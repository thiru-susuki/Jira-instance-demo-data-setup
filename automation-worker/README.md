# Automation Worker

This worker owns historical ticket dataset generation and CSV import automation.
The Forge app should collect user input and trigger this service; Jira ticket
creation should happen through CSV import, not Forge REST issue creation.

## Setup

```powershell
cd automation-worker
npm install
```

Create `.env` from `.env.example`, then authenticate Playwright once:

```powershell
npm run auth:login
```

## AI Blueprint Generation

The worker can use OpenAI to create a domain-specific demo blueprint before it
writes the CSV. The blueprint gives the deterministic generator realistic
services, components, teams, issue themes, relationship hints, release themes,
and dashboard KPI intent.

Add this to `.env` to enable it:

```dotenv
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini
OPENAI_TIMEOUT_MS=20000
```

If `OPENAI_API_KEY` is blank, the worker still runs and uses the local fallback
templates. Jira creation, CSV formatting, dates, links, versions, and dashboard
execution remain deterministic so the generated data stays valid.

Generate an import-ready CSV:

```powershell
npm run generate:tickets -- --project ITSM --ticketCount 5000 --dateRange 1_year --industry banking
```

Supported date ranges:

- `3_months`
- `6_months`
- `1_year`
- `12_months`

Supported domain values include:

- `banking`
- `healthcare`
- `retail`
- `insurance`
- `telecom`
- `ecommerce`
- `saas`
- `manufacturing`

The generated ticket CSV includes import-ready relationship and release context
columns:

- `Issue key`
- `Issue id`
- `Causes`
- `Relates`
- `Blocks`
- `Fix Version/s`
- `Affects Version/s`
- `Component/s`
- `Team`

The generator also writes `exports/release-versions.csv`, which gives a
release-level view of released and unreleased versions with linked issue keys.
Use this for review and dashboard validation before or after import.

Run the Jira CSV import automation:

```powershell
npm run import:csv
```

Before running the import automation, verify Jira login and import wizard access:

```powershell
npm run verify:import
```

Run both generation and import:

```powershell
npm run run
```

Start the local worker API:

```powershell
npm run start:api
```

Health check:

```powershell
Invoke-RestMethod -Method Get -Uri http://localhost:4000/health
```

Generate a dataset through the API:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:4000/generate-demo -ContentType "application/json" -Body '{"project":"ITSM","ticketCount":500,"dateRange":"6_months","industry":"healthcare","incidentRatio":60,"serviceRequestRatio":25,"problemRatio":10,"changeRatio":5}'
```

The API response includes `metadata.aiBlueprint`. Use it to confirm whether the
worker used OpenAI or the local fallback.

## Relationship Model

The dataset intentionally links work like a real enterprise Jira instance:

- Problems cause incidents.
- Incidents relate to changes.
- Incidents relate to service requests.
- Problems relate to changes.
- Some changes block service requests.

Jira CSV import can map link-description columns such as `Causes`, `Relates`,
and `Blocks` to issue links. The linked values point to the deterministic issue
keys generated in the same file.
