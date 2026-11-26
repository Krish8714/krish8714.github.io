---
title: "The Project Round: 45 Questions in the Chains Interviewers Actually Follow"
description: "Project questions don't come as a list. Each one is built on your last answer. 45 project-round questions for Dynamics 365 and Power Platform roles, grouped into 9 chains, with what each chain is really checking."
series: dynamics-365-interview-prep
part: 12
label: "Level 4 · Project round"
pubDate: 2026-11-24
cover: /covers/ip-level4.png
tags: [Interview Preparation, Project Round, Dynamics 365, Power Platform, Career]
---

*Level 4 of Dynamics 365 Interview Prep: From Basics to Architect. This is the round where most offers are won or lost, and it's the one people prepare for least.*

> "The interview was going really well. Then they asked about my project, and I lost track."

Project questions are never a fixed list. Each question is built on your last answer:

> "Walk me through your project."
> "You mentioned an integration. Sync or async?"
> "What happens when it fails?"
> "How would you know it failed?"

Miss one step and the next three answers fall apart. So here are 45 questions, grouped into the **9 chains** interviewers actually follow. For each chain: what they're really checking, and how to answer.

## Before you start: build your project card

Write these on one page and learn them:

- **The business:** who uses it, what problem it solves, in one sentence.
- **The numbers:** users, records, integrations, environments, team size, timeline.
- **Your role:** what *you* designed, built or decided. Not the team. You.
- **One incident:** something that broke in production, how you found it, how you fixed it, what changed afterwards.

Every chain below draws on this card.

## Chain 1: Project overview

1. Walk me through your current project.
2. Who are the users, and how many?
3. Why Dynamics 365 and not Salesforce or a custom application?
4. What was your role, exactly?
5. What would you do differently if you started again?

**What they're checking:** can you explain a system clearly, with numbers, and separate your work from the team's?

**How to answer:** two minutes, top-down: business problem → users and volumes → the main components → your part. Question 5 is a gift: an honest answer ("I'd design the security model before the forms") shows maturity.

## Chain 2: Architecture

6. Draw the architecture for me.
7. What connects to Dynamics 365, and in which direction?
8. Which integrations are synchronous, and which are asynchronous? Why?
9. What happens when one of those systems is down?
10. Where would this design break first if users doubled?

**What they're checking:** do you understand the system beyond your own module?

**How to answer:** name every system and arrow. For each integration, give the pattern (webhook, Service Bus, flow, ADF), the direction, and what happens on failure. "I don't know what happens if it's down" is the answer that ends the chain badly.

## Chain 3: Data model

11. What are the main tables?
12. Which relationships are parental, and why?
13. Which alternate keys do you have?
14. What did you model as a choice, and what as a lookup?
15. Which modelling decision would you change now?

**What they're checking:** did you design the data model, or just use it?

**How to answer:** draw four or five tables and their relationships. Mention one deliberate decision ("Branch is a table, not a choice, because branches change") and one regret.

## Chain 4: Security

16. How is your business unit structure designed?
17. How do roles differ between a user and a manager?
18. Do you use teams? Owner teams or access teams?
19. Which columns are secured, and why?
20. How do you test security before go-live?

**What they're checking:** can you keep data where it belongs?

**How to answer:** start from the org chart, then BU → roles → teams → column security. For question 20, a real process ("test users per role, a checklist of what each must and must not see") beats any theory.

## Chain 5: Business logic

21. Give me one rule you implemented. Where does it live?
22. Why a plugin and not a flow, or the other way round?
23. Which stage and mode does that plugin run in? Why?
24. What happens when it fails?
25. How do you make sure it can't loop?

**What they're checking:** do you choose tools for reasons, or out of habit?

**How to answer:** use the four questions from my Real-World Series: where must the rule hold, when must it run, who does it run as, what happens if it fails. Then the tool choice follows from the answers.

## Chain 6: Integration

26. Pick one integration and explain it end to end.
27. How does it authenticate?
28. What do you do about throttling and 429 errors?
29. How do you stop duplicates when a message is delivered twice?
30. Tell me about a production issue in this integration.

**What they're checking:** have you run an integration in production, or only built one?

**How to answer:** app registration + application user, retries with back-off, idempotency (alternate keys, upsert, a processed-message check), and a real incident with its root cause.

## Chain 7: Data migration

31. How much data did you migrate, and from where?
32. In what order did you load the tables, and why?
33. How did you keep created dates and owners?
34. How did you handle users who had left?
35. How did you prove every record arrived?

**What they're checking:** do you understand that migration is a project, not a weekend job?

**How to answer:** staging database, load order driven by lookups, `overriddencreatedon`, owner mapping rules, reconciliation counts with sign-off. Numbers matter here more than anywhere.

## Chain 8: ALM

36. How many environments do you have?
37. How does a change get from dev to production?
38. Managed or unmanaged in production? Why?
39. How do you handle environment-specific values?
40. How do you roll back a bad release?

**What they're checking:** can your work be deployed safely by someone other than you?

**How to answer:** solutions in source control, pipelines (Azure DevOps, GitHub Actions or Power Platform Pipelines), managed downstream, environment variables and connection references. For rollback, be honest: you usually roll *forward* with a fix, or restore from backup for data.

## Chain 9: Production support

41. Tell me about the worst production incident you handled.
42. How did you find out about it?
43. How did you find the root cause?
44. What did you change so it couldn't happen again?
45. How do you monitor the system today?

**What they're checking:** do you own what happens after go-live?

**How to answer:** the STAR pattern, with technical detail: the symptom, the tools you used (plugin trace log, flow run history, Application Insights), the root cause, the fix, and the prevention. Question 42 is the sharp one: "a user told us" is fine once, but say what monitoring you added afterwards.

## How to practise

1. Pick one real project and answer every chain **out loud**, recorded on your phone.
2. Play it back. Wherever you said "we", ask: what did *I* do?
3. Add a number to every answer: users, records, minutes, percentages.
4. Never claim something you can't explain two levels deeper. The chain will find it.

## Rule of thumb for Level 4

**Theory gets you to the project round. Being able to explain why you built it that way gets you through it.**
