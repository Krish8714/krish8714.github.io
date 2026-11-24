---
title: "Level 1: Dataverse and the Data Model, 25 Interview Questions"
description: "Tables, columns, relationships, keys, solutions and the questions that follow them. 25 fundamentals questions with short answers, the follow-up to expect, and the trap to avoid."
series: dynamics-365-interview-prep
part: 2
label: "Level 1 · Part 1"
pubDate: 2026-11-24
cover: /covers/ip-level1.png
tags: [Interview Preparation, Dataverse, Data Model, Dynamics 365, Power Platform]
---

*Level 1, Part 1 of Dynamics 365 Interview Prep: From Basics to Architect. Every answer is short enough to say out loud. Read the follow-up before you move on: that's the question that actually decides the round.*

## Dataverse basics

### 1. What is Dataverse, and how is it related to Dynamics 365?

**Answer:** Dataverse is the data platform underneath Dynamics 365 and Power Apps. It stores the data in tables, and adds security, business logic, auditing and an API on top. Dynamics 365 Sales, Customer Service and the other apps are solutions installed on top of a Dataverse environment.

**Follow-up:** "So if I build a model-driven app for loans, is that Dynamics 365?" It's a Power Apps model-driven app on Dataverse. It becomes "Dynamics 365" when it uses first-party Dynamics apps and their licences.

### 2. What's an environment?

**Answer:** A container with one Dataverse database plus its apps, flows and settings. Projects usually have separate environments for development, test, UAT and production.

**Follow-up:** "Why not build directly in production?" No safe place to test, no rollback, and every half-finished change is visible to real users.

### 3. Standard, custom, activity and virtual tables: what's the difference?

**Answer:**
- **Standard:** comes with the platform (Account, Contact).
- **Custom:** you create it (Loan Application).
- **Activity:** has a start/end, appears on the timeline, and shares fields with other activities (Email, Phone call, Task).
- **Virtual:** shows data that lives in another system, without copying it into Dataverse.

**Trap:** creating a custom "Customer" table when Contact already exists. Reuse standard tables unless there's a strong reason not to.

### 4. User-owned or organisation-owned table?

**Answer:** User/team-owned tables have an Owner, so security can limit access to "my records", "my business unit's records" and so on. Organisation-owned tables have no owner: you either see all rows or none. Use organisation-owned for reference data like loan products.

**Follow-up:** "Can you change it later?" No. Ownership is chosen when the table is created, so decide before you build.

## Columns

### 5. Name five column types you'd use in a loan table, and why.

**Answer:** Currency for the amount, Whole number for tenure in months, Choice for status, Lookup for the customer, Yes/No for "KYC verified". Picking the right type lets you validate, filter, report and secure the data.

### 6. Choice vs lookup: when do you use each?

**Answer:** A **choice** for a short, stable list that admins rarely change (Status: Draft, Submitted, Approved). A **lookup** to a table when the list grows, needs its own fields, or business users must maintain it (Branch, Loan Product).

**Trap:** a "Branch" choice with 25 values. When branch 26 opens, you need a deployment instead of a new row.

### 7. What are calculated, rollup and formula columns?

**Answer:** Values Dataverse works out for you.
- **Calculated / formula:** computed from other columns on the same row (or a parent), when the row is read.
- **Rollup:** aggregates child rows (sum of payments on a loan). Rollups are recalculated by a system job on a schedule, not instantly.

**Follow-up:** "A user saves a payment and the total doesn't change. Why?" Rollup timing. See Level 5, scenario 2.

### 8. What's the difference between the display name, the schema name and the logical name?

**Answer:** Display name is what users see ("PAN Verified"). Schema name includes the publisher prefix and casing (`new_PANVerified`). Logical name is the lowercase version code uses (`new_panverified`).

**Follow-up:** "Which one does JavaScript use?" The logical name.

### 9. What is an autonumber column?

**Answer:** A text column Dataverse fills automatically with a pattern, such as `LN-{SEQNUM:6}` → LN-000101. Users never type it, and it's unique per environment.

**Follow-up:** "After migration, new loans start at LN-000001 again. Why?" The seed wasn't set above the migrated numbers.

## Relationships and keys

### 10. Explain 1:N, N:1 and N:N relationships.

**Answer:** 1:N: one customer has many loans (a lookup on Loan). N:1 is the same relationship seen from the Loan side. N:N: many loans to many collateral items, using a hidden intersect table.

**Follow-up:** "We need a 'role' on the link between Loan and Contact." Then it isn't a native N:N; create a custom link table. See Level 5, scenario 4.

### 11. What do relationship behaviours control?

**Answer:** What happens to child records when something happens to the parent: assign, share, unshare, reparent, delete, merge. **Parental** cascades everything; **Referential** cascades nothing (and can restrict delete); **Custom** lets you choose per action.

**Trap:** leaving a relationship Parental by default, then discovering that reassigning a customer moved 40 open loans. See Level 5, scenario 3.

### 12. What is an alternate key, and why do integrations need one?

**Answer:** A unique key made of one or more columns other than the GUID, such as the legacy loan ID. Integrations and migrations use it to **upsert**: create the row if it's new, update it if it exists, without knowing the GUID.

**Follow-up:** "The key never activates. Why?" Existing duplicates. See Level 5, scenario 1.

### 13. What's the difference between the primary column and the primary key?

**Answer:** The primary key is the GUID (`new_loanapplicationid`) that identifies the row. The primary column is the text that names the row in lookups and views (Loan Number).

## Solutions

### 14. What's a solution?

**Answer:** A package of customisations (tables, forms, flows, plugins, web resources) that moves between environments together.

### 15. Managed vs unmanaged solutions?

**Answer:** **Unmanaged** in development: you can edit everything. **Managed** everywhere else: locked, versioned, and removable as a unit. You export managed from dev and import it into test and production.

**Trap:** "We import unmanaged into production so we can hot-fix there." Production changes then get overwritten or lost, and you can't cleanly remove anything.

### 16. What is a publisher, and why does the prefix matter?

**Answer:** The publisher owns the solution's components, and its prefix (`new_`, `lh_`) is added to every schema name. A meaningful prefix tells you who built a column and avoids clashes between vendors.

### 17. What is solution layering?

**Answer:** Each managed solution adds a layer on top of the system layer, and unmanaged changes sit on top of all of them. The top layer wins. That's why an unmanaged change in production can hide a managed update you just imported.

**Follow-up:** "How do you find out which layer is winning?" Use **See solution layers** on the component.

## Data and platform behaviour

### 18. How do you import data into Dataverse?

**Answer:** For small one-off loads, Excel/CSV import. For anything repeatable or large: dataflows, Azure Data Factory, SSIS with KingswaySoft, or the Web API. Use alternate keys for upserts.

### 19. What is auditing in Dataverse?

**Answer:** It records who changed what and when, per column. It must be turned on for the environment, the table and the columns you care about.

**Follow-up:** "Can you migrate old audit history into Dataverse audit?" No, audit records can't be created through the API. Keep legacy history in an archive or a custom history table.

### 20. What is duplicate detection?

**Answer:** Rules that warn users when a new or updated record matches an existing one (same PAN, same mobile). Rules must be published, and they check matches; they don't merge anything.

**Trap:** relying on duplicate detection to keep integrations clean. API calls can bypass the warning; use alternate keys for system-to-system loads.

### 21. What are business rules, and where do they run?

**Answer:** No-code logic: show/hide, make required, set values, validate. With scope set to a form, they run only in that form; with **Entity** (table) scope, they also run on the server.

### 22. What's the difference between delete and deactivate?

**Answer:** Deactivate sets the status to Inactive; the record stays for history and reporting. Delete removes it, along with any children the relationship behaviour cascades to.

### 23. What limits do people forget about?

**Answer:** API request limits and service protection limits for integrations, storage capacity (database, file, log), and the two-minute timeout for synchronous plugins.

### 24. What is the Dataverse Web API?

**Answer:** An OData REST API for Dataverse: create, read, update, delete, query, and call actions and functions. JavaScript, Power Automate, Azure Functions and external systems all use it.

### 25. Model a loan system for me in 60 seconds.

**Answer:** Contact for applicants, a custom Loan Application table (user-owned) with lookups to Contact and Loan Product, Branch as a table not a choice, a Loan Document table for KYC files, an alternate key on the legacy loan ID, and status columns that separate "what stage are we in" from "did the automated scoring succeed".

**Follow-up:** "Who can see a loan?" That's Level 1, Part 2: security.

## Rule of thumb for Level 1

**Every answer should end with why. "A lookup" is a fact; "a lookup, because branches change and need their own fields" is an answer.**
