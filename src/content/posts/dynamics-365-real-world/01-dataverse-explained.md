---
title: "Dataverse Explained: From One Excel File to a Real Data Model"
description: "12 people, one Excel file, 3,000 loan applications. How to turn that spreadsheet into a Dataverse data model that survives production: tables, columns, relationships, keys, formula and rollup columns, and the mistakes that are hard to undo."
series: dynamics-365-real-world
part: 1
pubDate: 2026-11-12
cover: /covers/rw-part1.png
tags: [Dataverse, Dynamics 365, Data Model]
linkedin: "https://www.linkedin.com/feed/update/urn:li:share:7526714683727376384"
---

*Part 1 of my Dynamics 365 Real-World Series. One lending bank, built end to end, the way real projects need it. Today: the data model, the layer every other part stands on.*

> **Model the business, not the spreadsheet.**

## The scenario: 12 people, one Excel file, 3,000 loans

A mid-sized lending bank runs its loan pipeline from one shared Excel file. Twelve people edit it. It has 3,000 rows and 46 columns.

Here's what that looks like on a normal Tuesday:

1. The same customer appears on five rows, spelled "Ravi Kumar", "Ravi Kumar K" and "R. Kumar".
2. The Branch column holds "Hyderabad", "Hyd", "HYD " and "Hyderabad - Madhapur".
3. The Amount column holds `1500000`, `15,00,000`, `15 lakh` and, once, `TBD`.
4. Co-applicant details are squeezed into one cell: name, phone and PAN, separated by commas.
5. Nobody knows who changed the interest rate on row 1,842, or when.
6. Two people edited the file at the same time and one of them lost an hour of work.

The bank decides to move to Dynamics 365. The first instinct of most teams is to create a table called "Loan" with 46 columns, one per Excel heading, and import the file.

That's the mistake this article is about. **A spreadsheet stores rows of text. A data model stores things the business cares about, and the relationships between them.** Get this layer wrong, and every later layer inherits the problem: security, logic, apps, reporting, integration and migration.

## The thought shift

Before you open the maker portal, read the spreadsheet and ask three questions about every column:

- **Is this a thing, or a fact about a thing?** "Customer" is a thing. "Customer phone" is a fact about that thing. Things become tables; facts become columns.
- **Can there be more than one?** One loan can have several documents and several guarantors. Anything that repeats becomes its own table, never "Document 1, Document 2, Document 3" columns.
- **Who else uses this value?** "Branch" is used by loans, users, teams and reports. A value shared by many records becomes a table you look up, not text you type.

Apply those three questions to our 46 columns and the single Excel sheet turns into six tables:

| Table | Type | Why it's a table |
| --- | --- | --- |
| Contact (customer) | Standard | People already exist in Dataverse. Reuse them, don't rebuild them |
| Loan Application | Custom | The core business record |
| Loan Document | Custom | One loan has many documents, each with its own status |
| Branch | Custom | Shared by loans, users and reports; stops "Hyd" vs "Hyderabad" |
| Loan Product | Custom | Rate, tenure limits and rules change by product, not by loan |
| Loan Guarantor | Custom (link table) | A guarantor can back many loans, and each link has its own share |

## The concepts in simple words

Think of Dataverse as **Excel done properly**.

| Excel | Dataverse | What Dataverse adds |
| --- | --- | --- |
| A sheet | A **table** | Security, auditing, business logic, an API, and relationships to other tables |
| A column heading | A **column** | A fixed data type, so nobody types "ten lakh" into an amount |
| A row | A **row** (record) | A unique ID (GUID) that never changes, plus created/modified by and on |
| VLOOKUP to another sheet | A **lookup** (relationship) | Real referential integrity and cascading behaviour |
| "Don't duplicate this ID" (hope) | An **alternate key** | Guaranteed uniqueness, and upserts by business ID |

### Table types

- **Standard tables** come with Dataverse or Dynamics 365: Contact, Account, User, Team. Reuse them where the meaning matches.
- **Custom tables** are yours: Loan Application, Branch.
- **Activity tables** behave like tasks, emails and phone calls: they appear in the timeline. Use one for things like "Customer call note".
- **Virtual tables** show data that lives in another system without copying it.

### Ownership: a choice you can't undo

When you create a table you choose **User or team** ownership, or **Organization** ownership.

- **User or team owned:** each row has an owner, and security roles can say "own records", "my business unit" and so on. Loans need this, because a loan officer should see her loans and a branch manager his branch.
- **Organization owned:** every row belongs to the whole organization. Fine for reference data like Loan Product or Branch.

You can't switch ownership type after the table is created. Decide it on day one, with Part 2 (security) in mind.

### Relationships and cascade behaviour

- **1:N (one-to-many):** one customer, many loans. The "many" side gets a lookup column.
- **N:N (many-to-many):** many guarantors, many loans. Dataverse can create a hidden link table for you (native N:N). Or you can build your own link table (manual N:N) when the link needs its own columns, such as "guarantee share %".
- **Cascade behaviour** decides what happens to child rows when the parent is deleted, assigned, shared or reparented. Getting it wrong is the fastest way to lose data. We'll set it deliberately in Implementation 3.

## Implementation 1: a solution and the Loan Application table, the right way

**Steps:**

1. In Power Apps, open **Solutions** and create a **publisher** with your organization's prefix. In this series the examples use `new_` so they're easy to read. In a real project, use your own prefix (for example `lh_`). Then every column name tells you who owns it.
2. Create a solution called **Lending Core** using that publisher. Every table, column and relationship goes in this solution from the start. Never build in the Default solution.
3. In the solution, select **New > Table**, name it **Loan Application** (plural: Loan Applications).
4. Under **Advanced options**:
    - Ownership: **User or team**.
    - Enable **notes and attachments**, so officers can attach small files to the record.
    - Enable **activities**, so calls and emails appear on the loan's timeline.
    - Enable **auditing** at table level (organization auditing must also be on).
5. Primary column: **Loan Number**. This is what users see in lookups and views, so make it meaningful (we'll make it an autonumber in Implementation 4).
6. Save.

**Why a solution from minute one:** everything you build here has to travel to test and production later. Components created outside a solution are hard to find and easy to forget. They are a common reason why "it works in dev" fails in test.

## Implementation 2: the right column types

This is where most data quality is won or lost. Every column type is a promise about what the data can contain.

| Excel heading | Dataverse column | Type | Why this type |
| --- | --- | --- | --- |
| Amount | Loan Amount | **Currency** | Stores the value plus a base-currency copy; reports can total it safely |
| Tenure | Tenure (months) | **Whole number**, min 6, max 360 | The type rejects "2 years"; min/max reject nonsense |
| Interest rate | Interest Rate | **Decimal**, 2 places | Precision matters for EMI |
| Purpose | Purpose | **Choice** (Home, Vehicle, Personal, Business) | Four values only, so filters and reports work |
| Status | Loan Status | **Choice** (Draft, Verified, Pending Approval, Approved, Rejected, Disbursed) | Drives views, BPF and commands later |
| Application date | Application Date | **Date only** | A date, not a moment in time (see Day 2) |
| PAN verified | PAN Verified | **Yes/No** | Two states, nothing else |
| Branch | Branch | **Lookup** to Branch | Shared value: a table, not text |
| Customer | Applicant | **Lookup** to Contact | The person, not their name typed again |

**Steps:**

1. Open the Loan Application table, select **New > Column** for each row above.
2. For choices that several tables share (for example "Yes/No/Not applicable" or "Region"), create a **global choice** in the solution and reuse it. A local choice belongs to one column only.
3. Set **Required** only where the business truly can't proceed without the value. Required on the column applies to every form, so be careful: imports that don't supply it will fail.
4. Fill in the **Description** of every column. It shows as a tooltip, it documents the model, and (as we'll see in the AI section) Copilot reads it.

## Implementation 3: relationships with deliberate cascade behaviour

| Relationship | Type | Delete behaviour | Assign behaviour | Why |
| --- | --- | --- | --- | --- |
| Contact → Loan Application | 1:N | **Restrict delete** (Referential, Restrict Delete) | None | Deleting a customer must never delete their loans |
| Loan Application → Loan Document | 1:N | **Parental** (cascade all) | Cascade all | Documents only make sense with their loan, and follow its owner |
| Branch → Loan Application | 1:N | **Restrict delete** | None | You can't close a branch that still has loans |
| Loan Product → Loan Application | 1:N | **Restrict delete** | None | Same reason |
| Loan Application ↔ Contact (as guarantor) | Manual N:N via **Loan Guarantor** | Parental from loan | None | The link has its own columns: guarantee share %, signed on |

**Steps:**

1. On the Loan Application table, open **Relationships > New relationship > Many-to-one**, pick Contact, name the lookup **Applicant**.
2. Open **Advanced options** and set **Delete** to **Restrict**. This stops the delete with an error while any loan still points at the contact.
3. Create the Loan Document table with a many-to-one relationship to Loan Application, and set the relationship to **Parental**.
4. For guarantors, create a **Loan Guarantor** table with two lookups (Loan Application and Contact) and the extra columns. A native N:N is simpler, but it can't hold "guarantee share %".

**Why this matters:** cascade settings are invisible until the day someone deletes or reassigns a record. Part 2 shows exactly what goes wrong when they're left on defaults.

## Implementation 4: readable loan numbers and an alternate key

Two different needs, often confused:

- **A number humans read:** `LN-004821`. Use an **autonumber** column.
- **A key systems match on:** the legacy system's loan ID, so a migration or integration can say "update the loan whose legacy ID is 88213" without knowing the Dataverse GUID. Use an **alternate key**.

**Steps:**

1. Change the primary column **Loan Number** to the **Autonumber** data type with a format such as `LN-{SEQNUM:6}`. Dataverse assigns the next number on create; nobody types it.
2. Add a text column **Legacy Loan ID**.
3. Open **Keys > New key**, name it **Legacy Loan ID key**, and select the Legacy Loan ID column.
4. Wait for the key's status to become **Active**. Dataverse builds a unique index in the background. On a table with data, this can take time. It **fails if duplicates already exist** (see Day 2).

With the key in place, the data migration series uses **upsert**. You send the row with its legacy ID. Dataverse creates it if it's new, or updates it if it exists. Re-running a load never creates duplicates.

## Implementation 5: let the system do the maths

Three ways to have Dataverse calculate a value instead of a person:

| Option | Runs when | Good for | Watch out for |
| --- | --- | --- | --- |
| **Formula column** (Power Fx) | When the row is read | Values from the same row and related rows, like EMI | Read-only; can't be used as a filter in every situation, check the limits for your case |
| **Calculated column** (classic) | When the row is read | Older designs; the same idea with a designer instead of Power Fx | For new work, prefer formula columns |
| **Rollup column** | On a schedule (a system job), or on demand | Totals across child rows: "total disbursed to this customer" | **Not real-time**: it can be hours old, so never base a validation on it |

**Example: EMI as a formula column**

```text
With(
    { r: 'Interest Rate' / 1200, n: 'Tenure (months)' },
    If(r = 0,
       'Loan Amount' / n,
       'Loan Amount' * r * Power(1 + r, n) / (Power(1 + r, n) - 1))
)
```

**Example: rollup on Contact**

- Column **Total Active Loan Amount** on Contact = SUM of Loan Amount on related Loan Applications where Status = Disbursed.

**Rule:** if a value can be calculated, calculate it. A typed value is wrong the moment one of its inputs changes.

## Day 2: what actually goes wrong in production

These are the data-model problems that come up again and again on real projects. For each one: what you see, why it happens, and how to handle it.

### 1. "Hyd", "HYD " and "Hyderabad" in the same column

**What you see:** the branch report shows 40 branches. The bank has 25.

**Why it happens:** Branch was created as a text column "just for now", or imported as text from Excel.

**How to handle it:**

1. Create the **Branch** table and a **Branch** lookup on Loan Application.
2. Build a mapping list (old text → correct branch) and fix it in staging, not in Dataverse.
3. Load the lookup values, check counts per branch, then remove the text column from forms and views.
4. Make the lookup required on the form so it can't happen again.

### 2. "Can we just change this column from text to choice?"

**What you see:** the maker portal doesn't offer the type you want.

**Why it happens:** most column type changes aren't allowed once a column exists, because the stored data and the database type would no longer match.

**How to handle it:**

1. Create a **new column** with the right type.
2. Copy and convert the data (a flow, a script or your migration tool).
3. Update forms, views, business rules, flows and code to use the new column.
4. Remove the old column only after nothing depends on it (check **Show dependencies**).

Prevention: decide types in a data-model review before anyone builds.

### 3. Dates that move by a day

**What you see:** an officer in Dubai opens a loan with Application Date 15 March, and sees 14 March.

**Why it happens:** a Date and Time column with **User local** behaviour stores a moment in UTC and shows it in each user's time zone. A pure date stored as midnight in India is the previous evening in Dubai.

**How to handle it:**

1. Use **Date only** behaviour for dates that aren't moments: date of birth, application date, EMI due date.
2. You can change behaviour from User local to Date only on an existing column, but it's a **one-way change**. Plan it, and check how existing values will be read.
3. Keep **User local** for real moments: "call scheduled at 3:30 PM".

### 4. The alternate key never becomes Active

**What you see:** the key's status is **Failed**, and the integration's upserts fail.

**Why it happens:** the data already contains duplicate values in the key column, so the unique index can't be created.

**How to handle it:**

1. Export the rows and find the duplicates (an Advanced Find view grouped by the column, or a SQL query over the staging data).
2. Fix them at the source, or decide which row wins and clean up.
3. **Reactivate** the key and watch its status.

### 5. "The total on the customer is wrong"

**What you see:** a loan was disbursed this morning, but the customer's Total Active Loan Amount hasn't changed.

**Why it happens:** rollup columns are recalculated by a background job on a schedule, not on every save.

**How to handle it:**

1. For display, accept the delay and show "Last updated" next to the value.
2. If someone needs it now, they can recalculate the rollup from the form.
3. Sometimes a business rule depends on the total, like "no customer may exceed ₹2 crore". Then calculate it in a **plugin** at the moment of save (Part 3B), not from a rollup.

### 6. Choice values that don't match between environments

**What you see:** an integration maps "Approved" to `100000004` in test, but in production that number means "Rejected".

**Why it happens:** someone created the choice by hand in each environment, so the values were numbered in a different order.

**How to handle it:**

1. Create choices **once**, in the development environment, inside the solution.
2. Move them to test and production only by importing the solution.
3. In code, keep the numeric values in one constant file, and check them after every deployment.

### 7. A deleted customer took 12 loans with them

**What you see:** a duplicate contact was deleted to clean up, and 12 loan applications disappeared.

**Why it happens:** the Contact → Loan relationship was left as **Parental**, which cascades delete to every child.

**How to handle it:**

1. Restore from backup if needed (environment backups restore the whole environment, so plan carefully).
2. Change the relationship to **Restrict delete**, as in Implementation 3.
3. For duplicates, **merge** contacts instead of deleting them, so child records move to the surviving contact.

## Using AI with the data model

### AI inside the maker experience

- **Create tables with Copilot:** in Power Apps you can describe what you need ("a table to track loan applications with amount, tenure, status and customer") and Copilot proposes tables and columns. It's a fast first draft. Then apply the three questions from the thought shift: it will happily give you a text column where you need a lookup.
- **Formula columns with Copilot:** describe the calculation in plain words and let Copilot suggest the Power Fx. Always test it with edge cases: zero interest, one-month tenure, empty values.
- **Descriptions feed Copilot:** the column descriptions you wrote in Implementation 2 help Copilot answer users' questions about the data later. Good descriptions are no longer just documentation.

### AI beside you, for design

Prompts that work (copy and adapt):

```text
Here are the 46 column headings from our loan tracking spreadsheet,
with 5 sample rows. Propose a Dataverse data model: tables, column
types, which values should be lookups or choices, relationships with
cascade behaviour, and alternate keys. Flag every column you think
holds more than one fact.
```

```text
Review this Dataverse data model for a lending bank. List: columns
whose type will be hard to change later, relationships whose delete
behaviour could lose data, values that should be calculated instead
of typed, and anything that will make migration or reporting harder.
```

### Where AI goes wrong here

- It mirrors the spreadsheet: one wide table with 40 columns.
- It suggests **Parental** relationships everywhere, because "child records should follow the parent" sounds sensible until a customer is deleted.
- It doesn't know your publisher prefix, your existing standard tables or your security needs. Use its output as a draft for a design review, not as the design.

**Never paste real customer data** into an AI tool to "get better suggestions". Column headings and fake sample rows are enough.

## Debugging and review checklist

Before anyone builds forms or logic on top of the model:

- [ ] Every table is in a solution with your publisher prefix
- [ ] Ownership type chosen deliberately for each table (user/team vs organization)
- [ ] No column holds more than one fact
- [ ] Shared values are lookups to their own table, not text
- [ ] Choice values created once, in dev, in the solution
- [ ] Date columns: Date only for dates, User local for moments
- [ ] Every relationship's delete and assign behaviour chosen on purpose
- [ ] Alternate keys created and **Active** for every external ID
- [ ] Calculated values are formula, calculated or rollup columns, not typed
- [ ] No validation relies on a rollup column
- [ ] Every column has a description

## Interview questions, with the answers that land

**1. When would you use 1:N versus N:N? Give a lending example.**

1:N when one record owns many: one customer, many loan applications. N:N when both sides can have many: a guarantor can back many loans, and a loan can have several guarantors. If the link itself needs data, such as the guarantee share, I build a manual link table instead of a native N:N.

**2. What's the difference between an alternate key and an autonumber column?**

An autonumber is a readable value Dataverse generates for people, like LN-004821. An alternate key makes one or more columns unique. Other systems use it to find a row without its GUID. That makes upserts and integrations safe to repeat.

**3. A customer was deleted and their loans disappeared. What happened, and how do you prevent it?**

The relationship was Parental, so delete cascaded to the loans. I'd set Contact → Loan to Restrict delete, and use merge instead of delete to clean up duplicates.

**4. Why can't a validation rule rely on a rollup column?**

Rollups are recalculated by a background job, so the value can be hours old. A validation at save time needs the current value, so I'd calculate it in a plugin inside the transaction.

**5. A date shows a day earlier for users in another country. Why?**

The column uses User local behaviour, which stores a moment in UTC and converts it to each user's time zone. For pure dates I use Date only behaviour.

## Rule of thumb

**Things become tables, facts become columns, shared values become lookups, and anything that can be calculated is never typed.**

**Next in the series:** why a branch manager sees only her branch. Dynamics 365 security, explained with real scenarios.
