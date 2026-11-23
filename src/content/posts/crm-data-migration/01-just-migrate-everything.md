---
title: "CRM Data Migration, Part 1: \"Just Migrate Everything\""
description: "\"Just migrate everything\" is not a scope. It's the absence of one. How to profile legacy data in a SQL Server staging copy and turn it into migrate, archive and leave-behind rules the business signs."
series: crm-data-migration
part: 2
label: "Part 1"
pubDate: 2026-11-26
cover: /covers/dm-part1.png
tags: [Data Migration, Dataverse, SQL Server, Scoping, Dynamics 365]
---

*Part 1 of my series CRM Data Migration: From Legacy to Dataverse. One lending bank, one real migration, from the first meeting to go-live weekend, using SQL Server, SSIS, KingswaySoft and Azure Data Factory.*

> **"Just migrate everything" is not a scope. It's the absence of one.**

## The scenario: 12 years, 4.2 million rows, one sentence

The lending bank from my other series is replacing a 12-year-old in-house CRM with Dynamics 365. In the first migration meeting, the business sponsor says one sentence:

**"Just migrate everything. We don't want to lose anything."**

It sounds safe. Here is what "everything" turns out to be once someone looks:

| Legacy table | Rows | What's actually in it |
| --- | --- | --- |
| Customers | 610,000 | About a third have had no loan, call or email in 7+ years |
| Loan applications | 1,150,000 | 88% closed; many "Draft" rows nobody finished |
| Call notes | 1,900,000 | Free text, some with PAN and bank details typed in |
| Documents | 420,000 files, 2.3 TB | Scans of KYC documents, many duplicated per loan |
| Users | 1,240 | Only 300 still work at the bank |
| Audit log | 38,000,000 | Field changes since 2014 |

Moving "everything" would mean:

- A load measured in **days**, not hours, which no cutover weekend can fit.
- Paying for Dataverse **database and file capacity** to store records nobody will open.
- Importing 940 owners who no longer exist.
- Copying sensitive data typed into notes into a new system, where it becomes a new compliance problem.
- And still not getting the audit log in as real audit history, because Dataverse audit records can't be created through the API.

The real risk in that meeting wasn't losing data. **It was nobody deciding what the data was for.** This part shows how to turn "everything" into a scope the business signs, using profiling queries in a SQL Server staging database.

## The thought shift

Stop asking "what data do we have?" and ask **"what will people need to do with this data on the Monday after go-live, and in five years?"**

Every record then falls into one of three buckets:

| Bucket | Means | Typical examples | Where it lives after go-live |
| --- | --- | --- | --- |
| **Migrate** | People will work on it in Dynamics 365 | Active customers, open loans, loans closed recently, current reference data | Dataverse |
| **Archive** | Must be kept and findable, but nobody edits it | Old closed loans, old call notes, historical documents, audit history | A read-only store: Azure SQL, a data lake, or a reporting model, searchable on request |
| **Leave behind** | No business or legal reason to keep it | Abandoned drafts, test records, duplicates, data past its retention period | Nowhere (deleted after sign-off, per the retention policy) |

The migration team doesn't decide which bucket. **The business does, with evidence from the team.** Your job in Part 1 is to produce that evidence.

## The concepts in simple words

### Why volume isn't free

| More rows means | Because |
| --- | --- |
| Longer loads | Dataverse loads are limited by API throughput and service protection limits, not by your server. Millions of rows plus their relationships take many hours |
| Higher cost | Dataverse charges for database and file capacity. Records you never open still use it |
| Slower system | Bigger tables mean slower views, searches and reports if they aren't designed for it |
| More risk | Every extra row is another chance of a failed lookup, a bad value or a sensitive field moved by accident |
| Longer cutover | The final delta load and reconciliation must fit inside the freeze window |

### What "profiling" means

Profiling is measuring the data before you decide anything: how many rows, how old, how complete, how duplicated, how much is still in use. You do it on a **copy** in a staging database, never on the live legacy system.

### What can't move as-is

- **Audit history** can't be written into Dataverse's audit tables. If it must be kept, it goes to the archive, or into a custom history table if users need to see it on the record.
- **Inactive users** can't own records as easily as active ones; owner mapping is Part 2's topic.
- **Created on / created by** need special handling to keep the original values (Part 4).

Knowing these early stops the business from expecting something the platform can't do.

## Implementation 1: a staging copy and an inventory

Never profile the live legacy system: you'll slow down the users still working in it, and the data moves under you.

**Steps:**

1. Create a SQL Server database **LendingStaging** with a schema `src` for the raw copy.
2. Copy the legacy tables into `src` as-is (SSIS, ADF Copy activity, or a backup restore). No transformations yet.
3. Run an inventory of every table: rows and size.

```sql
-- Rows and size of every table in the raw copy
SELECT  s.name  AS schema_name,
        t.name  AS table_name,
        SUM(p.rows) AS row_count,
        CAST(SUM(a.total_pages) * 8 / 1024.0 AS DECIMAL(12,1)) AS size_mb
FROM    sys.tables t
JOIN    sys.schemas s          ON s.schema_id = t.schema_id
JOIN    sys.partitions p       ON p.object_id = t.object_id AND p.index_id IN (0,1)
JOIN    sys.allocation_units a ON a.container_id = p.partition_id
WHERE   s.name = 'src'
GROUP BY s.name, t.name
ORDER BY row_count DESC;
```

This one query usually ends the "how big can it be?" conversation.

## Implementation 2: profile what's actually in use

The key question for each main table: **how much of it has been touched recently?**

**Customers by last activity:**

```sql
-- When did we last do anything with each customer?
WITH last_touch AS (
    SELECT c.customer_id,
           (SELECT MAX(d) FROM (VALUES
                (c.modified_on),
                ((SELECT MAX(l.modified_on) FROM src.loan_application l WHERE l.customer_id = c.customer_id)),
                ((SELECT MAX(n.created_on)  FROM src.call_note n        WHERE n.customer_id = c.customer_id))
           ) AS v(d)) AS last_activity
    FROM src.customer c
)
SELECT CASE
         WHEN last_activity >= DATEADD(YEAR, -2, GETDATE()) THEN '1. Last 2 years'
         WHEN last_activity >= DATEADD(YEAR, -5, GETDATE()) THEN '2. 2-5 years'
         WHEN last_activity >= DATEADD(YEAR, -7, GETDATE()) THEN '3. 5-7 years'
         ELSE '4. Over 7 years'
       END AS activity_band,
       COUNT(*) AS customers
FROM last_touch
GROUP BY CASE
         WHEN last_activity >= DATEADD(YEAR, -2, GETDATE()) THEN '1. Last 2 years'
         WHEN last_activity >= DATEADD(YEAR, -5, GETDATE()) THEN '2. 2-5 years'
         WHEN last_activity >= DATEADD(YEAR, -7, GETDATE()) THEN '3. 5-7 years'
         ELSE '4. Over 7 years'
       END
ORDER BY activity_band;
```

**Loans by status and age:**

```sql
SELECT status,
       SUM(CASE WHEN closed_on IS NULL                              THEN 1 ELSE 0 END) AS still_open,
       SUM(CASE WHEN closed_on >= DATEADD(YEAR, -3, GETDATE())      THEN 1 ELSE 0 END) AS closed_last_3y,
       SUM(CASE WHEN closed_on <  DATEADD(YEAR, -3, GETDATE())      THEN 1 ELSE 0 END) AS closed_older,
       COUNT(*) AS total
FROM src.loan_application
GROUP BY status
ORDER BY total DESC;
```

**Completeness and duplicates for the columns the business cares about:**

```sql
SELECT COUNT(*)                                                   AS customers,
       SUM(CASE WHEN pan IS NULL OR pan = '' THEN 1 ELSE 0 END)  AS missing_pan,
       SUM(CASE WHEN pan IS NOT NULL
                 AND pan NOT LIKE '[A-Z][A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z]'
                THEN 1 ELSE 0 END)                        AS invalid_pan,
       SUM(CASE WHEN mobile IS NULL OR mobile = '' THEN 1 ELSE 0 END) AS missing_mobile,
       COUNT(*) - COUNT(DISTINCT NULLIF(pan, ''))          AS rows_sharing_a_pan
FROM src.customer;
```

**Owners who have left:**

```sql
SELECT u.is_active, COUNT(DISTINCT u.user_id) AS users, COUNT(l.loan_id) AS loans_owned
FROM src.app_user u
LEFT JOIN src.loan_application l ON l.owner_id = u.user_id
GROUP BY u.is_active;
```

Put every result in one **profiling workbook**: one tab per table, the numbers, and a one-line "what this means" for business readers.

## Implementation 3: scope rules the business can sign

Turn the numbers into rules, written in business words, each with its row count:

| Data | Rule | Rows in scope | Bucket |
| --- | --- | --- | --- |
| Customers | Any activity in the last 5 years, or any open loan | e.g. 395,000 of 610,000 | Migrate |
| Customers | No activity for 5+ years and no open loan | e.g. 215,000 | Archive |
| Loans | Open, or closed in the last 3 years | e.g. 290,000 | Migrate |
| Loans | Closed more than 3 years ago | e.g. 760,000 | Archive |
| Loans | Status Draft, untouched for 1+ year | e.g. 100,000 | Leave behind (after sign-off) |
| Call notes | Linked to migrated loans, last 3 years | e.g. 400,000 | Migrate |
| Documents | Latest version per document type per migrated loan | e.g. 180,000 files | Migrate |
| Audit log | All | 38,000,000 | Archive |

*(The numbers here are examples of the shape your workbook will have; use your own profiling results.)*

**Rules for writing scope rules:**

- Use **business events** (last activity, open, closed), not technical ones (row created date in the old system).
- Every rule has a **row count** next to it. Without counts, nobody can judge the trade-off.
- Every "leave behind" needs an **owner** who signs it and a check against the bank's **retention policy**.

## Implementation 4: decide where the archive lives

Archived doesn't mean lost. Users must be able to find an old loan when a customer calls.

| Option | Good when | Watch out for |
| --- | --- | --- |
| Keep the cleaned staging tables in **Azure SQL**, read-only, with a simple report | Small team, occasional lookups | Someone must own and pay for it |
| Load the archive into a **data lake** and expose it through Power BI | You already have a data platform | Access control on sensitive data |
| A **custom history table** in Dataverse with summary fields only | Users need to see "previous loans" on the customer form | Still uses Dataverse capacity: keep it summary-level |

## Implementation 5: the scope sign-off

Before any mapping work starts, produce a one-page **Migration Scope Agreement**:

1. The three buckets per table, with rules and row counts.
2. Where archived data will live, and how users will find it.
3. What can't be migrated as-is (audit history, inactive owners) and the agreed alternative.
4. Named sign-offs from the business owner, compliance and the migration lead.

This page is what you point to in month four, when someone asks "why didn't my 2014 notes come across?".

## Day 2: what goes wrong when scope is skipped

### 1. The storage bill arrives

**What you see:** a month after go-live, the admin center shows the environment over its database or file capacity, and someone asks for budget.

**Why it happens:** everything was migrated, including documents, notes and closed loans nobody opens. Attachments and files use file capacity quickly.

**How to handle it:**

1. Check capacity by table in the admin center to see what's using it.
2. Move old documents to SharePoint or Azure storage and keep a link on the record.
3. For the next migration wave, apply the archive rules from Implementation 3 before loading.

### 2. The trial load takes 60 hours

**What you see:** the first full trial load runs over two days. The cutover window is one weekend.

**Why it happens:** row counts were never cut down, and every record's lookups and relationships add more calls.

**How to handle it:** reduce volume first (scope), then tune throughput (batching, parallel loads, bypassing plugins during the load window). Tuning alone rarely closes a gap that big. Part 6 covers performance.

### 3. "Where are my old notes?"

**What you see:** after go-live, a relationship manager can't find a customer's 2016 call notes.

**Why it happens:** the notes were correctly archived, but nobody told users where the archive is, or gave them access.

**How to handle it:** add a "Legacy history" link or report on the customer form, train key users, and include the archive's location in the go-live communication.

### 4. Sensitive data moved into notes

**What you see:** a compliance review finds PAN numbers and bank account details inside migrated free-text notes.

**Why it happens:** users of the old system typed them into notes for years. A "migrate everything" approach copied them as-is.

**How to handle it:**

1. In staging, scan free-text columns for patterns (PAN, account numbers, card numbers) before loading.
2. Agree with compliance: mask, remove, or leave the note in the archive only.
3. Add the check to every future load.

### 5. 940 owners who don't exist

**What you see:** the load fails on owner lookups, or thousands of records land under one integration user.

**Why it happens:** records owned by people who left can't be assigned to them in Dataverse in the usual way.

**How to handle it:** decide the owner rules during scoping (current branch manager, a team per branch, or a "legacy" team), and map them in Part 2. Don't let the load tool decide by default.

### 6. "We need the audit history in Dynamics"

**What you see:** compliance asks for the full field change history of each loan to be visible in the new system.

**Why it happens:** the expectation was never checked against what the platform allows.

**How to handle it:** explain early that audit records can't be created through the API. Offer the archive with a search report, or a custom "Legacy change history" table for the few fields that truly matter.

## Using AI in migration scoping

AI is strong at turning numbers into readable findings, and at writing the repetitive SQL. It's weak at knowing your business and your legal duties.

### Where it helps

- **Writing profiling SQL** for each table from its column list.
- **Summarising** a profiling workbook into a one-page brief for business readers.
- **Spotting columns** that look like they hold more than one fact, or sensitive data, from column names and a few anonymised sample values.
- **Drafting scope rules** in business language from your numbers.

### Prompts that work (copy and adapt)

```text
Here is the column list of a legacy SQL Server table src.customer
(name, type, nullable). Write T-SQL profiling queries for: row count,
null and empty rate per column, distinct count per column, min/max of
date columns, and duplicates on pan and mobile. Return one result set
per query, ready to paste into a workbook.
```

```text
Here are profiling results for a CRM migration (tables, row counts,
activity bands, status counts). Propose migrate / archive / leave
behind rules in business language, each with its row count, and list
the questions the business owner must answer before signing.
```

```text
Here are column names and 5 anonymised sample values per column for a
legacy notes table. Flag columns likely to contain personal or
financial data, and suggest SQL patterns to find PAN numbers and bank
account numbers in free text.
```

### Where AI goes wrong here

- It treats **"keep everything"** as the safe answer, because it can't see the cost, the load window or the compliance risk.
- It writes SQL that **looks right but scans** a 38-million-row table without filters. Check plans and run on staging only.
- It **doesn't know your retention policy**. A "leave behind" rule always needs a human owner and a policy check.

**Never paste real customer data** (names, PAN, phone numbers, notes) into an external AI tool. Column names, counts and anonymised samples are enough.

## Scoping checklist

- [ ] Raw copy of every legacy table in a SQL Server staging database
- [ ] Inventory: rows and size per table
- [ ] Activity profile for customers, loans and notes (last 2, 5, 7+ years)
- [ ] Completeness and duplicate checks for business-critical columns
- [ ] Inactive owners counted, with the records they own
- [ ] Free text scanned for sensitive data
- [ ] Scope rules per table in business language, each with a row count
- [ ] Archive location chosen, with access and an owner
- [ ] Platform limits explained (audit history, owners, created dates)
- [ ] Migration Scope Agreement signed by business, compliance and migration lead

## Interview questions, with the answers that land

**1. The client says "migrate everything". What do you do?**

I don't argue; I measure. I copy the data to a staging database, profile it by activity, status and completeness, and show the business the cost of each slice in rows, load time and storage. Then they choose migrate, archive or leave behind per rule, and sign it.

**2. Why profile in a staging database instead of the source system?**

It doesn't slow down users still on the legacy system, the data doesn't change under my queries, and the same staging layer later holds my transformations and reconciliation.

**3. Can you migrate audit history into Dataverse?**

Not as real audit records; they can't be created through the API. I'd archive it with a searchable report, or put the few fields that matter into a custom history table.

**4. What's the difference between archiving and deleting legacy data?**

Archived data is kept read-only and findable, for business or legal reasons. Data left behind is removed after sign-off, in line with the retention policy. Both are business decisions, recorded with row counts.

**5. How does scope affect the cutover weekend?**

Load time is driven by row counts and relationships. Cutting scope is usually the biggest single lever for fitting the final load and reconciliation inside the freeze window.

## Rule of thumb

**Measure first, then let the business choose: migrate what people will work on, archive what must be kept, and leave behind only what someone signs off.**

## Next in the series

**Part 2: Mapping legacy data to Dataverse.** Fields, option sets, lookups and the users who've left, with a mapping document built in SQL.
