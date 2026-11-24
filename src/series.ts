export interface Series { slug: string; title: string; tagline: string; description: string; plannedParts: number; introOffset?: number; }

export const SERIES: Series[] = [
  {
    slug: 'dataverse-plugins',
    title: 'Dataverse Plugins, Built for Production',
    tagline: 'A plugin is a contract on the data, not a feature on a screen.',
    description: 'Twelve parts that take one real plugin from the demo to production: stages, Target and images, loops, external calls, performance, testing, observability, security, ALM, Custom APIs and AI agents.',
    plannedParts: 12,
  },
  {
    slug: 'azure-functions-dynamics-365',
    title: 'Azure Functions with Dynamics 365',
    tagline: 'Dataverse publishes, Azure delivers.',
    description: 'Integrating Dataverse with Azure the production way: webhooks and Service Bus, high-volume loads, Durable Functions, retries and dead-letter queues, and security.',
    plannedParts: 6,
  },
  {
    slug: 'dynamics-365-real-world',
    title: 'Dynamics 365 Real-World Series',
    tagline: 'One lending bank, built end to end, the way real projects need it.',
    description: 'A lending bank built in Dynamics 365 step by step: the data model, security, where logic should live, how to think like an architect, and model-driven apps with business process flows.',
    plannedParts: 6,
  },
  {
    slug: 'crm-data-migration',
    title: 'CRM Data Migration: From Legacy to Dataverse',
    tagline: 'Never load straight from source into CRM.',
    description: 'A real migration from first meeting to go-live weekend, using SQL Server, SSIS, KingswaySoft and Azure Data Factory.',
    plannedParts: 9,
    introOffset: 1,
  },
  {
    slug: 'dynamics-365-javascript',
    title: 'Dynamics 365 JavaScript, from Basics to Production',
    tagline: 'Build it, break it, debug it, fix it.',
    description: 'Plain JavaScript for model-driven apps, taught the way it breaks in real projects: web resources, the form API, debugging, Web API calls, async, Ribbon Workbench and commands, testing and ALM.',
    plannedParts: 14,
  },
  {
    slug: 'dynamics-365-interview-prep',
    title: 'Dynamics 365 Interview Prep: From Basics to Architect',
    tagline: 'Answer the question, then answer the next three.',
    description: 'Five levels of real interview questions for Dynamics 365 and Power Platform roles: fundamentals, developer, senior, the project round, and the extremely hard scenarios that decide architect offers.',
    plannedParts: 14,
    introOffset: 1,
  },
];

export const site = {
  name: 'Karthik Ithakota',
  title: 'Karthik Ithakota · Dynamics 365, Power Platform & Azure',
  description: 'Production-grade guides on Dynamics 365, Dataverse, Power Platform and Azure integration, from a Solution Architect (PL-600, PL-400).',
  linkedin: 'https://www.linkedin.com/in/karthik-ithakota-5a1188149/',
  email: 'ithakotakarthik72@gmail.com',
};

export const url = (path: string) => (import.meta.env.BASE_URL.replace(/\/$/, '') + path);
