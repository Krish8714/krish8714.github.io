export interface Series { slug: string; title: string; tagline: string; description: string; plannedParts: number; }

export const SERIES: Series[] = [
  {
    slug: 'dataverse-plugins',
    title: 'Dataverse Plugins, Built for Production',
    tagline: 'A plugin is a contract on the data, not a feature on a screen.',
    description: 'Twelve parts that take one real plugin from the demo to production: stages, Target and images, loops, external calls, performance, testing, observability, security, ALM, Custom APIs and AI agents.',
    plannedParts: 12,
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
