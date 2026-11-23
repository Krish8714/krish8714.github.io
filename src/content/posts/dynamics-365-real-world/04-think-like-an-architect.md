---
title: "Think Before the Tool: Four Questions That Decide Every Design"
description: "In interviews, how you reach the answer matters more than the answer. Four questions to ask before picking a plugin, a flow or Azure, applied to three real scenarios."
series: dynamics-365-real-world
part: 5
label: "Part 4"
pubDate: 2026-11-17
cover: /covers/rw-part4.png
tags: [Architecture, Interview Preparation, Dynamics 365]
linkedin: "https://www.linkedin.com/feed/update/urn:li:ugcPost:7528354440014266369"
---

In developer interviews, the right answer matters less than how you reached it.

Most candidates jump straight to a tool: "I'll use a plugin." Then comes the follow-up: "Why not a flow?" And the answer falls apart.

Part 4 of my Dynamics 365 Real-World Series is about the thinking, not the answers. Before I pick any tool, I ask four questions:

1. **Where must this rule hold?** Only on the form, or on every path: import, API, flow?
2. **When must it happen?** Before save, inside the transaction, or after?
3. **Who does it run as?** The user, or a system identity?
4. **What happens if it fails?** Roll back, retry, or alert someone?

Here's how that plays out on three scenarios.

## Scenario 1: "A loan can't be approved without a co-applicant."

- **Where:** every path. An Excel import must be blocked too. That rules out form JavaScript and business rules as the only check.
- **When:** before the save. Power Automate runs after the record is saved, so it can only react, not prevent.
- **If it fails:** the save must roll back.

**Decision:** a synchronous plugin on PreOperation. A form notification on top is optional, purely for a better user experience.

## Scenario 2: "When a loan is approved, send it to the core banking system."

- **Where:** server side.
- **When:** after the commit. If you call an external system inside the transaction and a later step fails, Dataverse rolls back its data. The bank's system doesn't.
- **If it fails:** the bank API may be down. We need a retry, not a rollback.

**Decision:** asynchronous. Azure Function with Service Bus, or a flow with retry policies. Add an idempotency key so a retry never creates a duplicate.

## Scenario 3: "Branch managers see their branch. One regional manager sees five branches."

- **First question:** what is access based on? Where the record sits (business unit), who reports to whom (hierarchy security), or a one-off exception (sharing)?
- Sharing every loan across five branches won't scale or stay auditable.

**Decision:** if the branches roll up into a region business unit, give Parent: Child BU read. If they don't, use a team per branch and add the manager to five teams.

## The point

Notice that I never started with the tool. The tool falls out of the four answers.

In an interview, say these questions out loud. Even if your final pick differs from what the panel had in mind, they'll see how you reason as a developer.
