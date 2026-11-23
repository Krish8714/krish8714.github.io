---
title: "Dynamics 365 Security, Explained with Real Scenarios"
description: "25 branches, 300 users, and one question from compliance. Business units, security roles, teams, column security and hierarchy, built step by step, plus the production problems that trip teams up and how to debug access."
series: dynamics-365-real-world
part: 2
pubDate: 2026-11-13
cover: /covers/rw-part2.png
tags: [Security, Dataverse, Dynamics 365]
linkedin: "https://www.linkedin.com/feed/update/urn:li:share:7526721812592824320"
---

*Part 2 of my Dynamics 365 Real-World Series. Part 1 built the data model for a lending bank. Today: who can see and do what with it.*

> **Security is designed from the organization chart, not from complaints.**

## The scenario: one question from compliance

The bank from Part 1 goes live with 300 users in 25 branches across 3 regions. During the first audit, the compliance officer asks one question:

**"Why can a loan officer in Hyderabad see a customer's credit score in Chennai?"**

The project team looks into it and finds:

1. Every loan officer has a copy of a role with **Organization**-level read on Loan Application, "because some users couldn't see their loans in testing".
2. The credit score is hidden on the form, so everyone assumed it was protected. It still appears in views, Excel exports and the API.
3. A regional manager was given access to five branches by **sharing** 4,000 loans one by one with a bulk tool. Nobody can say who shared what.
4. Three people have the System Administrator role "temporarily", since go-live.

None of these is a platform bug. Each is the result of fixing access complaints one at a time, instead of designing security once, from how the bank is organized.

## The thought shift

Most teams design security backwards: build the app, let users test, and widen access whenever someone says "I can't see it". After six months, everyone can see everything.

Flip it. Before you create a single role, write down:

- **The structure:** Head Office → Regions → Branches. Who belongs where?
- **The jobs:** loan officer, credit analyst, branch manager, regional head, auditor, integration user.
- **For each job and each table:** create, read, update, delete, and **how far**: own records, my branch, my region, everyone.
- **The secrets:** which fields only a few people may ever see (credit score, income, PAN).
- **The exceptions:** who needs access across the normal boundaries, and why.

That page is your security design. Everything below just builds it.

## The concepts in simple words

Picture the bank's head office building.

| Dataverse concept | In the building | What it decides |
| --- | --- | --- |
| **Business unit (BU)** | Floors and rooms: Region → Branch | Where a user and their records "live" |
| **Security role** | A key card | Which doors (tables and actions) and how far the card works |
| **Access level** | How far the key card reaches | User (own), Business Unit, Parent: Child Business Units, Organization |
| **Team** | A department badge | A group that can own records and hold roles |
| **Sharing** | Lending your key for one door | One record, one person or team, by exception |
| **Column security** | A locked drawer | Who can read or update one sensitive field |
| **Hierarchy security** | A manager's master key | Managers see their reports' records, by reporting line |

### Privileges and access levels

A role is a grid. Each table has privileges (Create, Read, Write, Delete, Append, Append To, Assign, Share), and each privilege has an access level:

| Access level | A loan officer with this level on Read sees |
| --- | --- |
| **User** | Loans she owns, or that are shared with her or her teams |
| **Business Unit** | All loans owned in her branch BU |
| **Parent: Child Business Units** | All loans in her BU and every BU below it |
| **Organization** | Every loan in the bank |

### Append and Append To: the pair everyone mixes up

To attach a document to a loan, Dataverse checks two privileges:

- **Append** on **Loan Document**: "I may attach this document to something".
- **Append To** on **Loan Application**: "Something may be attached to this loan".

Missing either one gives an error. It's the most common "I can't add X to Y" complaint.

### Roles only add

A user with several roles gets the **highest** level from any of them. There's no "deny" in Dataverse roles. If one of a user's roles gives Organization read, nothing else can take it away.

## Implementation 1: the business unit tree

**Steps:**

1. In the Power Platform admin center, open the environment and go to **Settings > Users + permissions > Business units**.
2. The root BU is the organization (Head Office). Under it, create **South Region**, **West Region**, **North Region**.
3. Under each region, create its branches: **Hyderabad – Madhapur**, **Chennai – T Nagar**, and so on.
4. Create a separate BU for **Central Underwriting**, the team that assesses big loans from every branch.
5. Move each user into their branch BU.

**Why it matters:** BUs decide what "my branch" and "my region" mean in every role. A flat BU structure (everyone in the root) makes Business Unit access the same as Organization access.

## Implementation 2: roles with the right reach

Start from a copy of a minimal role, never from System Administrator. Add only what the job needs.

| Role | Loan Application | Contact | Loan Document | Notes |
| --- | --- | --- | --- | --- |
| **Loan Officer** | Create, Read, Write: **User**; Append To: User | Read: **Business Unit**; Create, Write: User | Create, Read, Write, Append: User | Can't delete loans |
| **Branch Manager** | Read, Write, Assign: **Business Unit** | Read: Business Unit | Read: Business Unit | Reassigns loans when officers leave |
| **Regional Head** | Read: **Parent: Child BU** | Read: Parent: Child BU | Read: Parent: Child BU | Read-only across the region |
| **Credit Analyst** | Read, Write: Organization (assessment fields only, via forms and column security) | Read: Organization | Read: Organization | Works for all branches |
| **Auditor** | Read: Organization | Read: Organization | Read: Organization | Read-only everywhere, no export rights |

**Steps:**

1. In the environment, open **Security roles**, select a minimal role and **Copy** it as **Loan Officer**.
2. On the **Custom entities** tab, set each privilege for Loan Application, Loan Document and Branch.
3. On the **Core records** tab, set Contact.
4. Don't forget the hidden needs: read on the **Branch** and **Loan Product** reference tables (Organization), and the privileges that process features need (we'll meet these in Part 5).
5. Save, and test with a real user in that role before giving it to anyone else.

## Implementation 3: column security on the credit score

Hiding a field on a form is not security. The value still shows in views, Advanced Find, Excel exports, Power BI and the API.

**Steps:**

1. Open the Credit Score column on Loan Application and turn on **Enable column security**.
2. In the admin center, open **Column security profiles** and create **Credit Team**.
3. In the profile, set Credit Score to **Read: Yes, Update: Yes** for Credit Analysts, and create a second profile **Credit Read** with **Read: Yes, Update: No** for branch managers.
4. Add users or teams to the profiles.
5. Everyone else now sees the field as locked and masked, on every channel, including the API.

## Implementation 4: owner teams for cross-branch work

The regional head from the scenario needed five branches. Sharing 4,000 records doesn't scale and can't be audited.

**Better options, in order:**

1. **If the branches are under one region BU:** give the regional head **Parent: Child BU** read. Done.
2. **If they aren't** (for example a special programme across regions): create an **owner team** per programme, assign the loans to the team, and add the people to the team.
3. **For a temporary exception on a few records:** share those records, and record why.

**Steps for an owner team:**

1. In the admin center, create a team **Affordable Housing Programme**, type **Owner**, in the appropriate BU.
2. Give the team a security role. Team members get the team's privileges on records the team owns.
3. Assign the programme's loans to the team.

## Implementation 5: roles on teams, not on individuals

With 300 users, assigning roles one by one is how role sprawl starts. Assign roles to **teams**, and manage membership instead.

**Steps:**

1. Create a **Microsoft Entra ID group team** for each job in each BU, for example "Loan Officers – Hyderabad Madhapur", linked to an Entra security group.
2. Give the team its security role.
3. When HR adds someone to the Entra group, they get the role in Dataverse the next time they sign in. When they leave the group, they lose it.

**Why:** access reviews become "who is in this group?" instead of reading 300 user records.

## Day 2: what actually goes wrong in production

### 1. "I can't attach a document to my loan"

**What the user sees:** an error when adding a document from the loan's subgrid, often mentioning a missing privilege.

**Why it happens:** the role has Append on Loan Document but not Append To on Loan Application, or the other way round.

**How to handle it:**

1. Read the error: it names the missing privilege and the table, for example `prvAppendTonew_loanapplication`.
2. Add the missing privilege at the right level.
3. Retest with the user's role, not as an admin.

### 2. "The customer isn't in the lookup"

**What the user sees:** the officer searches for a customer who definitely exists, finds nothing, and creates a new contact. The bank now has duplicates.

**Why it happens:** Read on Contact is at **User** level, so the officer only sees contacts she owns.

**How to handle it:**

1. Give Contact read at **Business Unit** level (or wider, if customers move between branches).
2. Turn on duplicate detection rules for contacts.
3. Merge the duplicates that were created.

**Lesson:** too little access doesn't make data safer. It makes users create bad data.

### 3. A loan is reassigned, and its documents stay behind

**What the user sees:** the new owner opens the loan, but the documents subgrid is empty for her.

**Why it happens:** the Loan → Document relationship is Referential for Assign, so documents keep the old owner.

**How to handle it:**

1. Set the relationship's **Assign** behaviour to **Cascade All** (or make it Parental, as in Part 1).
2. Reassign the affected loans again, or reassign the documents in bulk.

### 4. One duplicate customer deleted, 12 loans gone

**What the user sees:** a data clean-up removes a duplicate contact, and the loans linked to it disappear.

**Why it happens:** Contact → Loan was Parental, which cascades delete.

**How to handle it:** set it to Restrict delete, and merge duplicates instead of deleting them (see Part 1).

### 5. An officer moves branch, and her loans vanish from the old manager's view

**What the user sees:** the Madhapur manager suddenly can't see 140 active loans.

**Why it happens:** when a user moves to a new BU, the records she owns go with her to the new BU. The old manager's Business Unit read no longer covers them.

**How to handle it:**

1. Before moving the user, **reassign** her open loans to a colleague in the old branch.
2. Then move the user.
3. Add this to the HR "branch transfer" checklist so it happens every time.

### 6. A "dashboard" role that exposes everything

**What the user sees:** nothing wrong. That's the problem. A role created "just for the dashboard" has Organization read, so the person can open every loan in the bank.

**Why it happens:** roles only add. One wide role on top of a narrow one gives the wide access.

**How to handle it:**

1. Build dashboards on data the user should see anyway, or use Power BI with its own row-level security for bank-wide figures.
2. Review roles that grant Organization read, and keep the list short and named.

### 7. "Principal user is missing a privilege"

**What the user sees:** an error that starts with "Principal user (Id=…) is missing prv… privilege", often from a flow or an integration, not a person.

**Why it happens:** the flow's connection or the application user runs with a role that lacks that privilege.

**How to handle it:**

1. The privilege name in the message tells you exactly what to add: for example `prvReadnew_loanapplication` means Read on Loan Application.
2. Check **who** the call ran as: the flow's connection owner, or the integration's application user.
3. Give that identity a purpose-built role. Don't give it System Administrator "to make it work".

## How to debug access, step by step

When a user says "I can't see it" or "I shouldn't be able to see this":

1. **Reproduce as the user.** Use a test user with exactly the same roles, teams and BU. Testing as an admin proves nothing.
2. **Check access on the record.** Model-driven apps can show a user's access to a specific record and why (ownership, role, team, sharing). Use it before reading roles by hand.
3. **List every role the user gets**, directly and through each team. Remember: the highest level wins.
4. **Check the owner and BU of the record.** Many "missing" records are owned by someone in another BU.
5. **Check column security** if the record is visible but a field is masked.
6. **Check sharing** if a user sees a record they shouldn't.
7. **Check the identity of non-human callers:** flows, plugins and integrations run as someone.

## Using AI with security design

### AI as a design partner

```text
Here is our organization structure (regions, branches) and these job
roles with what each must do on Loan Application, Contact and Loan
Document. Propose a Dataverse security design: business units, roles
with privileges and access levels per table, teams, column security
profiles. Flag every place where a role would see more than its job
needs.
```

```text
Here is an export of our security roles (role, table, privilege,
access level). Find: roles with Organization access they may not
need, missing Append/Append To pairs, roles that differ only slightly
(candidates to merge), and any role that grants Delete broadly.
```

### AI for error messages

Paste the full privilege error (with IDs removed) and ask what it means and which role to check. AI is good at decoding names like `prvAppendTonew_loanapplication`.

### Where AI goes wrong here

- It suggests **Organization** access to "avoid permission issues". That's exactly the scenario's problem.
- It treats hiding fields on forms as security.
- It doesn't know your audit and regulatory rules. The design must still be reviewed by someone accountable for them.

**Never paste real user names, emails or role assignments** into an external AI tool. Use job titles and anonymised exports.

## Go-live checklist

- [ ] BU tree matches the real organization: regions, branches, central teams
- [ ] Every role copied from a minimal role, never from System Administrator
- [ ] Each role reviewed against the job's needs, table by table
- [ ] Append and Append To checked for every "attach" scenario
- [ ] Sensitive fields protected with column security, not form hiding
- [ ] Cross-branch access through BU levels or owner teams, not mass sharing
- [ ] Roles assigned to teams; Entra group teams where possible
- [ ] Integration and flow identities have purpose-built roles
- [ ] A named, short list of Organization-level roles
- [ ] One test user per role, used for every release
- [ ] A branch-transfer checklist: reassign records before moving users

## Interview questions, with the answers that land

**1. A regional head with Parent: Child BU read can't see loans owned by Central Underwriting. Why?**

Central Underwriting is its own BU, not under her region, so her Parent: Child BU access doesn't reach it. Options: put her in an owner team that Central Underwriting assigns regional loans to, or adjust the BU design if underwriting belongs under regions.

**2. Is hiding a field on a form security?**

No. The value still appears in views, exports, reports and the API. Field-level protection needs column security profiles.

**3. A user has two roles. One gives User read, the other Organization read. What does she get?**

Organization read. Roles only add; the highest access level wins, and there's no deny.

**4. When would you use an owner team instead of sharing?**

When a group of people needs ongoing access to a set of records across normal boundaries. Owner teams are auditable and manageable; mass sharing isn't. I use sharing only for a few records, by exception.

**5. A flow fails with "Principal user is missing prvRead… privilege". How do you fix it?**

Find the identity the flow runs as (connection owner or application user), and give that identity a role with the named privilege. I wouldn't give it System Administrator.

## Rule of thumb

**Design from the organization chart, give each job the least it needs, protect secrets with column security, and test every role as the user.**

**Next in the series:** business rule, JavaScript, plugin or Power Automate? Where should your logic live?
