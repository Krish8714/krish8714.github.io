import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Set SITE_URL in the GitHub Actions workflow (e.g. https://karthik-ithakota.github.io).
// If you deploy to a project repo (not <user>.github.io), also set BASE_PATH to '/<repo-name>'.
export default defineConfig({
  site: process.env.SITE_URL || 'https://example.github.io',
  base: process.env.BASE_PATH || '/',
  integrations: [sitemap()],
  markdown: {
    shikiConfig: { theme: 'github-dark-dimmed', wrap: false },
  },
});
