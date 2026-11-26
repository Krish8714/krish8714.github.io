---
title: "Every Project Has a Migration: The Series Plan"
description: "Most teams treat data migration as a weekend job at the end. This series follows a real migration into Dataverse, from first meeting to go-live weekend, with SQL Server, SSIS, KingswaySoft and Azure Data Factory."
series: crm-data-migration
part: 1
label: "Introduction"
pubDate: 2026-11-13
cover: /covers/dm-intro.png
tags: [Data Migration, Dataverse, KingswaySoft, Azure Data Factory, SSIS]
---

Every Dynamics 365 project has a migration. Most teams treat it as a weekend job at the end. That's why so many go-lives slip.

I'm starting a new series: **CRM Data Migration — From Legacy to Dataverse.**

Over the years I've moved data into Dynamics 365 from legacy CRMs, SQL databases and the inevitable Excel files. The tools change from project to project, but the problems don't. So this series follows a real migration from first meeting to go-live weekend.

## The approach I use

1. **Source systems** (legacy CRM, SQL Server, Excel)
2. **Staging database** (SQL Server): raw copy first, never touched
3. **Cleanse & transform:** SQL + SSIS (dedupe, map option sets, resolve owners)
4. **Load into Dataverse:** KingswaySoft or Azure Data Factory, using alternate keys and upsert, in batches
5. **Reconcile:** source vs target counts, failed-row reports, sign-off

Why a staging layer? Because you never load straight from source into CRM. You need somewhere to clean, re-run and prove what happened.

## Technologies covered

- SQL Server for staging and transformation
- SSIS + KingswaySoft Dynamics 365 connector
- Azure Data Factory with the Dataverse connector
- Configuration Migration Tool for reference and config data
- Dataverse Web API: alternate keys, upsert, ExecuteMultiple
- Bypassing plugins and flows during the load window

## The series

1. What to migrate, and what to leave behind
2. Mapping legacy data to Dataverse: fields, option sets, lookups, users who've left
3. Load order: why Accounts go before Contacts, and the circular lookup trap
4. Keeping history: created dates, owners, closed records, notes and emails
5. Tools: KingswaySoft vs ADF vs SSIS vs Configuration Migration Tool
6. Performance: throttling (429), batching, parallel loads
7. Reconciliation: proving every record landed
8. Cutover weekend: full load, delta loads, freeze window, rollback plan

## New to SQL, SSIS or ADF? Start with the beginner toolkit

The main parts assume you can read a SQL query and run a load. If you can't yet, three beginner parts take you from zero to ready, using the same lending bank's data:

- **SQL for CRM people:** SELECT, WHERE, GROUP BY, JOIN, finding duplicates and counting rows, using customers, loans and owners. Read it before Part 2.
- **Your first SSIS package with KingswaySoft:** connect to Dataverse, load 100 contacts with an upsert on an alternate key, and read the error output. Read it before Part 3.
- **Your first ADF pipeline into Dataverse:** linked service, copy activity, the Dataverse sink with an alternate key, and the monitoring screen. Read it before Part 5.

Each one has real screenshots from my lab, explains every line, and breaks things on purpose so you learn to fix them.

Each part has real scenarios, the mistakes I see most, and an interview question at the end.

Part 1 is coming next: **"Just migrate everything"** — the sentence that costs projects the most.
