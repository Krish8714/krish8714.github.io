---
title: "CRM Data Migration, Part 1: \"Just Migrate Everything\""
description: "\"Just move all the data\" is not a plan. Learn how to check old CRM data in a SQL Server copy, and turn it into simple move, archive and leave-behind rules that the business signs."
series: crm-data-migration
part: 2
label: "Part 1"
pubDate: 2026-11-26
cover: /covers/dm-part1.png
tags: [Data Migration, Dataverse, SQL Server, Scoping, Dynamics 365]
---

*Part 1 of my series CRM Data Migration: From Legacy to Dataverse. One lending bank, one real migration, from the first meeting to the go-live weekend. We use SQL Server, SSIS, KingswaySoft and Azure Data Factory.*

> **"Just move all the data" is not a plan. It means nobody has made a plan yet.**

## The story: 12 years of data and one sentence

The lending bank from my other series is replacing its 12-year-old CRM with Dynamics 365. In the first migration meeting, the business owner says one sentence:

**"Just migrate everything. We don't want to lose anything."**

It sounds safe. But when we look at what "everything" really means, we find this:

| Old table | Rows | What is really inside |
| --- | --- | --- |
| Customers | 610,000 | About one third had no loan, call or email in the last 7+ years |
| Loan applications | 1,150,000 | 88% are closed. Many are "Draft" loans nobody finished |
| Call notes | 1,900,000 | Free text. Some notes have PAN and bank details typed inside |
| Documents | 420,000 files, 2.3 TB | Scanned KYC documents. Many are copies of the same file |
| Users | 1,240 | Only 300 still work at the bank |
| Audit log | 38,000,000 | Every field change since 2014 |

If we move "everything":

- The data load takes **days**, not hours. A go-live weekend cannot fit that.
- The bank pays for Dataverse **storage** for records nobody will open.
- We bring in **940 users who left** the bank.
- We copy **sensitive data** (PAN, bank details in notes) into a new system. That creates a new compliance problem.
- And the audit log **still cannot** come in as real audit history, because Dataverse does not allow you to create audit records.

So the real risk in that meeting was not losing data. **The real risk was that nobody had decided what the data is needed for.**

In this part, you will learn how to turn "everything" into a clear plan that the business signs. We do it by checking the data in a SQL Server copy.

## The change in thinking

Don't ask: "What data do we have?"

Ask: **"What will people need to do with this data on the first Monday after go-live? And in five years?"**

Then put every record into one of three groups:

| Group | What it means | Examples | Where it lives after go-live |
| --- | --- | --- | --- |
| **Move** | People will work on it in Dynamics 365 | Active customers, open loans, recently closed loans, current lookup data | Dataverse |
| **Archive** | We must keep it and find it, but nobody will change it | Old closed loans, old call notes, old documents, audit history | A read-only store: Azure SQL, a data lake, or a report that users can search |
| **Leave behind** | There is no business or legal reason to keep it | Unfinished drafts, test records, duplicates, data older than the retention period | Nowhere. It is deleted after sign-off, as per the retention policy |

**The migration team does not choose the group. The business chooses, using facts from the migration team.** Your job in Part 1 is to give them those facts.

**One more thing.** Microsoft splits data into two kinds:

- **Setup data** (configuration data): things like currencies, branches, products and lookup values. This sets up the system.
- **Migration data**: things like customers, loans and notes, which come from the old system.

This series is about migration data. Setup data is loaded separately, before migration starts, usually with solutions or the Configuration Migration tool.

## The basics in simple words

### Why more data is not free

| More rows means | Why |
| --- | --- |
| Longer loads | Dataverse only accepts a limited number of requests at a time. Your server's speed does not change that. Millions of rows with their links take many hours |
| Higher cost | Dataverse charges for database and file storage. Records you never open still take space |
| Slower system | Bigger tables can make views, searches and reports slower |
| More risk | Every extra row is one more chance of a broken link, a wrong value, or sensitive data moved by mistake |
| Longer go-live weekend | The final load and the final checks must finish while the old system is frozen (no new changes allowed) |

### What "profiling" means

Profiling means **measuring the data before you decide anything**:

- How many rows?
- How old?
- How complete? (Are important fields empty?)
- How many duplicates?
- How much is still in use?

You always do this on a **copy** of the data in a separate database (we call it "staging"). Never on the live old system.

### What cannot move as it is

- **Audit history** cannot be written into Dataverse's audit tables. If the bank must keep it, it goes to the archive. If users must see it on the record, we can use a custom history table.
- **Users who have left** cannot simply own records like active users. We handle owners in Part 2.
- **"Created on" and "Created by"** dates need special steps to keep their original values. We cover that in Part 4.

When the business knows these limits early, they don't expect something the platform cannot do.

## Step 1: make a copy and count everything

Never profile the live old system. Two reasons:

1. Your queries will slow it down for users who still work in it.
2. The data keeps changing while you measure it.

**Steps:**

1. Create a SQL Server database called **LendingStaging**, with a schema `src` for the raw copy.
2. Copy the old tables into `src` exactly as they are (using SSIS, an ADF Copy activity, or a backup restore). Don't change anything yet.
3. Count the rows and size of every table:

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

This one query usually ends the "how big can it be?" discussion.

## Step 2: find out what is really in use

For each main table, ask one question: **how much of it was used recently?**

**Customers, grouped by their last activity:**

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

**Loans, grouped by status and age:**

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

**Empty fields and duplicates in the columns the business cares about:**

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

**Owners who have left the bank:**

```sql
SELECT u.is_active, COUNT(DISTINCT u.user_id) AS users, COUNT(l.loan_id) AS loans_owned
FROM src.app_user u
LEFT JOIN src.loan_application l ON l.owner_id = u.user_id
GROUP BY u.is_active;
```

Put all the results in one **profiling workbook** (an Excel file): one tab per table, the numbers, and one simple line saying "what this means" for business readers.

## Step 3: write simple rules the business can sign

Now turn the numbers into rules. Write them in business words, and put a row count next to each rule:

| Data | Rule | Rows | Group |
| --- | --- | --- | --- |
| Customers | Any activity in the last 5 years, or any open loan | e.g. 395,000 of 610,000 | Move |
| Customers | No activity for 5+ years and no open loan | e.g. 215,000 | Archive |
| Loans | Open, or closed in the last 3 years | e.g. 290,000 | Move |
| Loans | Closed more than 3 years ago | e.g. 760,000 | Archive |
| Loans | Status "Draft", not touched for 1+ year | e.g. 100,000 | Leave behind (after sign-off) |
| Call notes | Linked to loans we move, from the last 3 years | e.g. 400,000 | Move |
| Documents | Latest version of each document type, for loans we move | e.g. 180,000 files | Move |
| Audit log | All of it | 38,000,000 | Archive |

*(These numbers are examples to show what your workbook will look like. Use your own results.)*

**Three tips for writing rules:**

- Use **business events** (last activity, open, closed). Don't use technical dates like "row created in the old system".
- Put a **row count** next to every rule. Without numbers, nobody can see what each choice costs.
- Every "leave behind" rule needs a **named person** who signs it, and a check against the bank's **retention policy** (how long data must be kept by law).

## Step 4: decide where the archive lives

Archived does not mean lost. When a customer calls about an old loan, users must be able to find it.

| Option | Good when | Be careful about |
| --- | --- | --- |
| Keep the cleaned staging tables in **Azure SQL**, read-only, with a simple report | Small team, people look things up only sometimes | Someone must own it and pay for it |
| Load the archive into a **data lake** and show it through Power BI | The bank already has a data platform | Who can see sensitive data |
| A **custom history table** in Dataverse with only summary fields | Users need to see "previous loans" on the customer form | It still uses Dataverse storage, so keep it small |
| A **virtual table** in Dataverse that reads the archive from Azure SQL | Users want to see old loans inside Dynamics, without moving them | The data is read-only and can be slower to open. Test it with real users first |

## Step 5: get the plan signed

Before any mapping work starts, make a one-page **Migration Scope Agreement**. It contains:

1. The three groups for each table, with the rules and row counts.
2. Where archived data will live, and how users will find it.
3. What cannot move as it is (audit history, users who left), and the agreed alternative.
4. Signatures from the business owner, compliance, and the migration lead.

Four months later, when someone asks "Why didn't my 2014 notes come across?", this page is your answer.

## Day 2: what goes wrong when you skip this step

### 1. The storage bill arrives

**What you see:** a month after go-live, the admin center shows that you are over your database or file storage limit. Someone asks for more budget.

**Why it happens:** everything was moved, including documents, notes and closed loans that nobody opens. Files and attachments fill up file storage very fast.

**How to fix it:**

1. In the admin center, check storage by table to see what is using the space.
2. Move old documents to SharePoint or Azure storage, and keep a link on the record.
3. For the next migration wave, apply the archive rules from Step 3 before loading.

### 2. The test load takes 60 hours

**What you see:** the first full test load runs for more than two days. But the go-live window is one weekend.

**Why it happens:** nobody reduced the number of rows. And every record has links (lookups and relationships), which add even more work.

**How to fix it:** first reduce the volume (using the rules from Step 3). Then make the load faster (batches, running loads in parallel, bypassing custom plug-ins only for the load requests, which is a supported option and doesn't affect other users). Speed tuning alone rarely fixes a gap this big. Part 6 covers performance.

### 3. "Where are my old notes?"

**What you see:** after go-live, a relationship manager cannot find a customer's call notes from 2016.

**Why it happens:** the notes were correctly archived. But nobody told users where the archive is, or gave them access.

**How to fix it:** add a "Legacy history" link or report on the customer form, train the key users, and mention the archive location in the go-live announcement.

### 4. Sensitive data moved inside notes

**What you see:** a compliance review finds PAN numbers and bank account details inside the migrated notes.

**Why it happens:** for years, users typed these details into notes in the old system. "Migrate everything" copied them as they were.

**How to fix it:**

1. In staging, before loading, scan free-text columns for patterns like PAN, account numbers and card numbers.
2. Agree with compliance on what to do: hide part of the value, remove it, or keep that note only in the archive.
3. Add this check to every future load.

### 5. 940 owners who don't exist

**What you see:** the load fails on owner lookups. Or thousands of records end up owned by one integration user.

**Why it happens:** records owned by people who left the bank cannot simply be given to them in Dataverse.

**How to fix it:** decide the owner rules during this planning step. For example: the current branch manager, a team per branch, or a "Legacy" team. Then map them in Part 2. Don't let the load tool decide for you.

### 6. "We need the audit history in Dynamics"

**What you see:** compliance asks to see the full change history of every loan inside the new system.

**Why it happens:** nobody checked this request against what the platform allows.

**How to fix it:** explain early that audit records cannot be created through the API. Offer the archive with a search report, or a custom "Legacy change history" table for only the few fields that really matter.

## Using AI in migration planning

AI is good at turning numbers into clear findings, and at writing repetitive SQL. It is weak at knowing your business and your legal rules.

### Where AI helps

- **Writing profiling SQL** for each table, from its list of columns.
- **Summarising** a profiling workbook into a one-page note for business readers.
- **Spotting risky columns**: columns that hold more than one thing, or sensitive data, using column names and a few made-up sample values.
- **Drafting rules** in business language from your numbers.

### Prompts that work (copy and change them)

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

### Where AI goes wrong

- It thinks **"keep everything"** is the safe answer, because it cannot see the cost, the load time or the compliance risk.
- It writes SQL that **looks right but reads the whole table**, even a 38-million-row one. Always check the query, and run it only on staging.
- It **does not know your retention policy**. Every "leave behind" rule needs a real person and a policy check.

**Never paste real customer data** (names, PAN, phone numbers, notes) into an outside AI tool. Column names, counts and made-up samples are enough.

## Checklist

- [ ] Raw copy of every old table in a SQL Server staging database
- [ ] Rows and size counted for every table
- [ ] Customers, loans and notes grouped by last activity (2, 5, 7+ years)
- [ ] Empty fields and duplicates checked for important columns
- [ ] Users who left counted, with the records they own
- [ ] Free text checked for sensitive data
- [ ] Rules for every table, in business words, each with a row count
- [ ] Archive location chosen, with access and an owner
- [ ] Platform limits explained (audit history, owners, created dates)
- [ ] Migration Scope Agreement signed by the business, compliance and the migration lead

## Interview questions, with simple strong answers

**1. The client says "migrate everything". What do you do?**

I don't argue. I measure. I copy the data to a staging database and check it by activity, status and completeness. Then I show the business what each part costs in rows, load time and storage. They choose move, archive or leave behind for each rule, and they sign it.

**2. Why check the data in a staging database and not in the old system?**

Three reasons. It doesn't slow down users who still work in the old system. The data doesn't change while I measure it. And later, the same staging database holds my transformations and my final checks.

**3. Can you migrate audit history into Dataverse?**

Not as real audit records, because they cannot be created through the API. I would archive it with a search report, or put the few important fields into a custom history table.

**4. What is the difference between archiving and deleting old data?**

Archived data is kept read-only and can still be found, for business or legal reasons. Data we leave behind is deleted after sign-off, as per the retention policy. Both are business decisions, written down with row counts.

**5. How does scope affect the go-live weekend?**

Load time depends on the number of rows and their links. Reducing the scope is usually the biggest single way to make the final load and checks fit inside the weekend.

## Simple rule to remember

**Check the data first. Then let the business decide: move what people will work on, archive what must be kept, and leave behind only what someone signs off.**

## Next in the series

**Part 2: Mapping old data to Dataverse.** Fields, choice values, lookups and users who have left, with a mapping document built in SQL.
