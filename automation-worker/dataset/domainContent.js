const DOMAIN_CONTENT = {
  banking: {
    teams: ['Retail Banking', 'Payments', 'Fraud Operations', 'KYC', 'Treasury'],
    services: ['mobile banking', 'card authorization', 'loan origination', 'wire transfer', 'fraud monitoring'],
    components: ['Core Banking', 'Payments Gateway', 'KYC Platform', 'Customer Mobile App', 'Reporting Portal'],
  },
  healthcare: {
    teams: ['Clinical Operations', 'Patient Access', 'Revenue Cycle', 'Pharmacy', 'Care Coordination'],
    services: ['patient portal', 'EHR integration', 'lab ordering', 'telehealth', 'claims intake'],
    components: ['EHR Platform', 'FHIR Gateway', 'Patient Mobile App', 'Telehealth Service', 'Billing Portal'],
  },
  retail: {
    teams: ['Store Operations', 'Ecommerce', 'Fulfillment', 'Customer Care', 'Merchandising'],
    services: ['checkout', 'inventory sync', 'order fulfillment', 'loyalty rewards', 'returns processing'],
    components: ['Web Store', 'POS Platform', 'Warehouse Integration', 'Pricing Engine', 'Loyalty Platform'],
  },
  insurance: {
    teams: ['Claims', 'Underwriting', 'Policy Servicing', 'Billing', 'Agent Experience'],
    services: ['claims intake', 'policy issuance', 'premium billing', 'agent portal', 'document generation'],
    components: ['Claims Platform', 'Policy Admin', 'Billing Engine', 'Agent Portal', 'Document Service'],
  },
  telecom: {
    teams: ['Network Operations', 'Field Services', 'Subscriber Care', 'Provisioning', 'Billing'],
    services: ['service activation', 'network monitoring', 'outage management', 'subscriber billing', 'field dispatch'],
    components: ['OSS Platform', 'Billing Gateway', 'Provisioning API', 'Network Console', 'Field Service App'],
  },
  ecommerce: {
    teams: ['Marketplace Ops', 'Seller Success', 'Payments', 'Fulfillment', 'Customer Experience'],
    services: ['cart checkout', 'seller onboarding', 'catalog search', 'warehouse fulfillment', 'payment capture'],
    components: ['Checkout Service', 'Catalog Platform', 'Seller Portal', 'Warehouse API', 'Payments Gateway'],
  },
  saas: {
    teams: ['Platform Engineering', 'Customer Success', 'Security', 'Billing', 'Data Services'],
    services: ['tenant provisioning', 'authentication', 'subscription billing', 'API gateway', 'usage analytics'],
    components: ['Identity Service', 'Tenant Platform', 'Billing Service', 'API Gateway', 'Analytics Pipeline'],
  },
  manufacturing: {
    teams: ['Plant Operations', 'Quality', 'Supply Chain', 'Maintenance', 'Planning'],
    services: ['production planning', 'quality inspection', 'supplier integration', 'inventory planning', 'maintenance alerts'],
    components: ['MES Platform', 'ERP Integration', 'Quality Portal', 'Supplier API', 'Telemetry Gateway'],
  },
};

function normaliseIndustry(value) {
  return String(value || 'banking')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\s+/g, '');
}

export function getDomainContent(industry) {
  return DOMAIN_CONTENT[normaliseIndustry(industry)] || {
    teams: ['Operations', 'Customer Care', 'Platform', 'Risk', 'Service Delivery'],
    services: ['customer workflow', 'reporting', 'service portal', 'approval routing', 'integration service'],
    components: ['Core Platform', 'Service Portal', 'Reporting Dashboard', 'Integration API', 'Workflow Engine'],
  };
}

export function buildDomainSummary(issueType, industry, index) {
  const domain = getDomainContent(industry);
  const service = domain.services[index % domain.services.length];
  const team = domain.teams[(index + 1) % domain.teams.length];

  if (issueType === 'Incident') {
    return `${service} outage affecting ${team.toLowerCase()} users`;
  }

  if (issueType === 'Service Request') {
    return `Provision ${service} access for ${team.toLowerCase()} team`;
  }

  if (issueType === 'Problem') {
    return `Recurring ${service} instability root cause analysis`;
  }

  if (issueType === 'Change') {
    return `Release ${service} reliability improvement`;
  }

  return `${service} work item for ${team.toLowerCase()}`;
}

export function buildDomainDescription({ issueType, industry, component, team, versionName }) {
  const domain = getDomainContent(industry);
  const service = domain.services.find(item => component.toLowerCase().includes(item.split(' ')[0])) || domain.services[0];

  return [
    `Generated ${issueType.toLowerCase()} for ${team}.`,
    `Business service: ${service}.`,
    `Impacted component: ${component}.`,
    versionName ? `Release context: ${versionName}.` : '',
    'This record is intended for historical demo data, dashboards, SLA trend analysis, and cross-work relationship demonstrations.',
  ].filter(Boolean).join(' ');
}
