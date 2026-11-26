---
title: "Think Before the Tool: Four Questions That Decide Every Design"
description: "In interviews and real projects, how you reach the answer matters more than the answer. Four questions to ask before choosing a business rule, JavaScript, a plugin, a flow or Azure, applied to six real lending scenarios."
series: dynamics-365-real-world
part: 5
label: "Part 4"
pubDate: 2026-11-17
cover: /covers/rw-part4.png
tags: [Architecture, Interview Preparation, Dynamics 365]
linkedin: "https://www.linkedin.com/feed/update/urn:li:ugcPost:7528354440014266369"
---

*Part 4 of my Dynamics 365 Real-World Series. Parts 1 to 3 covered the data model, security, and every place logic can live. Today: how to choose between them, on purpose.*

> **The tool falls out of the answers. Never start with the tool.**

## The scenario: the follow-up question

A senior developer interview. The panel asks:

"Loans can't be approved without a co-applicant. How would you build that?"

The candidate answers in two seconds: "A plugin."

"Why not a flow?"

"Flows are slower."

"Why not a business rule?"

"…Plugins are more powerful."

The answer was right. The reasoning wasn't there, and the panel noticed. In real projects this habit causes real damage. Teams pick the tool they know best. Months later they find the rule doesn't hold on imports, or a "simple" flow is blocking 300 users.

## The thought shift: four questions

Before choosing any tool, answer four questions out loud.

| # | Question | What it decides |
| --- | --- | --- |
| 1 | **Where must this rule hold?** Only on the form, or on every path: import, API, flow, integration, AI agent? | Client-side vs server-side |
| 2 | **When must it happen?** Before the save, inside the transaction, or after the commit? Now, or on a schedule? | Pre-stage, post-stage, async, scheduled |
| 3 | **Who does it run as?** The user (with their security), or a system identity? | User context vs service identity |
| 4 | **What happens if it fails?** Roll back the save, retry later, or alert someone? | Sync vs async, transaction vs queue |

Then match the answers to the tools:

| Tool | Where it holds | When | Runs as | On failure |
| --- | --- | --- | --- | --- |
| Business rule (form scope) | Form only | While editing | User | Message on the form |
| Business rule (Entity scope) | Everywhere, for errors and set values | Before save | User | Save rejected |
| JavaScript | Form only | While editing | User | Message on the form |
| Formula column | Everywhere (it's calculated on read) | On read | — | — |
| Plugin, sync PreValidation / PreOperation | Everywhere | Before save, in transaction | User (or a configured identity) | Save rolled back with a message |
| Plugin, sync PostOperation | Everywhere | After write, in transaction | User | Whole save rolled back |
| Plugin, async | Everywhere | After commit | User or system | Retried by the system job; logged |
| Power Automate | Everywhere | After commit, or scheduled | Connection identity | Retry policy; run history |
| Azure Function (via Service Bus or webhook) | Everywhere | After commit | Application identity | Retries, dead-letter queue |
| Custom API | Wherever it's called | When called | Caller | Error returned to caller |

## Scenario 1: "A loan can't be approved without a co-applicant"

- **Where:** every path. An Excel import must be blocked too. That rules out JavaScript and form-scoped business rules as the only check.
- **When:** before the save. A flow runs after the record is saved, so it can only react.
- **Runs as:** the user. Their action is what's being validated.
- **If it fails:** the save must be rejected with a clear message.

**Decision:** a synchronous plugin on PreOperation (Create and Update, with a pre-image). Optionally, JavaScript or a business rule on the form for instant feedback, purely for user experience.

## Scenario 2: "When a loan is approved, send it to the core banking system"

- **Where:** server side.
- **When:** after the commit. If you call the bank inside the transaction and a later step fails, Dataverse rolls back its data, but the bank's system doesn't. You get a loan in core banking that doesn't exist in CRM.
- **Runs as:** a system identity with exactly the permissions the integration needs.
- **If it fails:** the bank API may be down. You need a retry, not a rollback, and a place for messages that never succeed.

**Decision:** asynchronous. Dataverse → Service Bus → Azure Function, with retries, a dead-letter queue and an idempotency key so a retry never creates a duplicate. A flow with retry policies is acceptable for low volume.

## Scenario 3: "Branch managers see their branch; one regional manager sees five branches"

- **First question:** what is the access really based on? Where the record sits (business unit), who reports to whom (hierarchy), or a one-off exception (sharing)?
- **Where:** everywhere, including views, exports and the API. So it's security, not form logic.
- Sharing every loan across five branches won't scale or stay auditable.

**Decision:** if the five branches roll up into a region BU, give Parent: Child BU read. If they don't, use an owner team per branch group and add the manager to it. (Part 2 covers both.)

## Scenario 4: "Show the EMI on the loan as soon as amount, rate or tenure change"

- **Where:** everywhere the loan is read: forms, views, exports, reports.
- **When:** whenever it's read. It's a pure calculation from the same row.
- **If it fails:** nothing to roll back; it's derived.

**Decision:** a formula column (Part 1). Not JavaScript (which only updates forms), not a plugin (which would store a value that can go stale if a rule changes).

## Scenario 5: "Remind the branch manager about loans stuck in Verification for more than 7 days"

- **Where:** server side, nothing to do with a form.
- **When:** on a schedule, not on a save. Nothing "happens" when a loan becomes stuck; time just passes.
- **Runs as:** a service identity that can read all branches' loans.
- **If it fails:** try again tomorrow; alert support if it fails twice.

**Decision:** a scheduled cloud flow every morning, querying the BPF table's active stage and start time (Part 5), grouped by branch, posting one message per manager.

## Scenario 6: "Every night, refresh credit scores for 250,000 active customers"

- **Where:** server side.
- **When:** nightly batch, long-running.
- **Runs as:** an application identity.
- **If it fails:** partial progress must be kept; restart from where it stopped; respect Dataverse service protection limits.

**Decision:** not a plugin (two-minute limit), not a single flow (throughput and run limits). Azure Durable Functions with batching and checkpointing, as in Part 3 of the Azure Functions series, or a data pipeline for very large volumes.

## How to answer the interview question

Use this structure, out loud:

1. **Restate the rule in one line.**
2. **Answer the four questions** for it.
3. **Name the tool** that matches, and **one alternative you rejected and why**.
4. **Add the safety net:** how you'd test it (form, import, API) and how you'd know if it failed in production.

Example for Scenario 1, in about 40 seconds:

> "The rule is: no approval without a co-applicant. It must hold on every path, including imports and the API, so it has to be server-side. It must happen before the save and reject it, so a flow is out, because flows run after the commit. It runs as the user. So: a synchronous PreOperation plugin on Create and Update, with a pre-image because Update targets are partial. I'd add a form notification for user experience. I'd test it through the form, an Excel import and a Web API call, and the plugin traces its decision for support."

Even if the panel had a different tool in mind, they've seen how you reason, and that's what they're hiring.

## Day 2: what goes wrong when the questions aren't asked

### 1. The "no-code" rule that didn't hold

**What you see:** a compliance rule built as a business rule with form scope; months later an audit finds violations created by an integration.

**Which question was skipped:** "Where must this rule hold?"

**How to handle it:** add a server-side guard (plugin or Entity scope), clean the existing data, and add "import + API test" to the definition of done.

### 2. The integration that made users wait

**What you see:** saving a loan takes 20–40 seconds whenever the credit bureau is slow.

**Which question was skipped:** "When must it happen?" (It didn't need to happen before the save.)

**How to handle it:** move the call to async (Service Bus + Azure Function or a flow) and show the result on the loan when it arrives.

### 3. The flow that could see everything

**What you see:** a flow running as an admin's connection writes data that the triggering user could never have written.

**Which question was skipped:** "Who does it run as?"

**How to handle it:** run flows under purpose-built service identities with only the privileges they need, and document what each one can do.

### 4. The rollback that didn't roll back

**What you see:** a sync plugin calls the core banking API. Then a later plugin fails and the save is rolled back. But core banking already has the loan.

**Which question was skipped:** "What happens if it fails?"

**How to handle it:** external calls go after the commit, through a queue, with an idempotency key.

## Using AI with design decisions

AI is a very good **sparring partner** for these decisions, as long as you give it the four questions.

```text
Act as a Dynamics 365 solution architect. For this requirement:
"<requirement>", answer four questions: where must it hold (form or
every path), when must it happen (before save, in transaction, after
commit, scheduled), who does it run as, and what happens on failure.
Then recommend one tool (business rule, JavaScript, formula column,
plugin and stage, flow, Azure Function, Custom API), name one
alternative you rejected and why, and list how to test it.
```

```text
Here is our design: <list of rules and the tool chosen for each>.
Find any rule that only holds on the form but must hold everywhere,
any external call inside a transaction, and any identity with more
access than it needs.
```

**Where AI goes wrong here:** it often picks the most common tool for the keyword ("approval" → flow, "validation" → JavaScript). Make it answer the four questions first. Make it show its reasoning, then check it.

## Checklist for every new requirement

- [ ] Rule restated in one line
- [ ] Where must it hold? (form only / every path)
- [ ] When must it happen? (before save / in transaction / after commit / schedule)
- [ ] Who does it run as? (user / named service identity)
- [ ] What happens on failure? (reject / roll back / retry / alert)
- [ ] Tool chosen, and one rejected alternative recorded
- [ ] Test plan: form, import, API (and agent, if applicable)
- [ ] How we'll know it failed in production

## Interview questions, with the answers that land

**1. Plugin or flow? How do you decide?**

By when it must happen and what failure means. If the rule must stop the save, it's a plugin, because flows run after the commit. If it's a follow-up that can retry, like notifications, it's a flow.

**2. Why shouldn't a synchronous plugin call an external system?**

Because the external call can't be rolled back with the Dataverse transaction, and the user waits on someone else's server. External calls go after the commit through a queue, with retries and idempotency.

**3. How would you show a calculated value like EMI?**

A formula column, because it's derived from the same row, always current and visible everywhere. JavaScript only updates the form, and a stored value can go stale.

**4. How would you build "remind managers about loans stuck for 7 days"?**

A scheduled flow, because nothing is saved when a loan becomes stuck; time passes. It queries the stage start time and sends one message per manager.

**5. How do you answer a design question you haven't seen before?**

Restate the rule, answer the four questions out loud, name the tool and one rejected alternative, and explain how I'd test it and monitor it.

## Rule of thumb

**Where, when, who, and what if it fails. Answer those four, and the tool chooses itself.**

**Next in the series:** Part 5, model-driven apps and business process flows, the layer users touch every day.
