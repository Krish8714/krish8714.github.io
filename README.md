# Karthik Ithakota · Blog

Production-grade guides on Dynamics 365, Dataverse, Power Platform and Azure. Built with [Astro](https://astro.build), deployed to GitHub Pages.

## Write a new article

1. Add a Markdown file under `src/content/posts/<series-slug>/`, e.g. `src/content/posts/dataverse-plugins/13-something.md`.
2. Start it with front matter:

```yaml
---
title: "Article title"
description: "One sentence for Google and link previews."
series: dataverse-plugins      # must match a slug in src/series.ts
part: 13
pubDate: 2026-12-01
cover: /covers/plugins-part13.png   # optional, 1600x900, put the image in public/covers/
tags: [Dataverse, Plugins]
---
```

3. Commit and push to `main`. GitHub Actions builds and publishes the site in about a minute.

To start a new series, add an entry to `SERIES` in `src/series.ts`.

## Run locally

```bash
npm install
npm run dev      # http://localhost:4321
```
