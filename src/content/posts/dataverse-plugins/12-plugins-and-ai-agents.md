---
title: "Plugins in the Age of AI Agents"
description: "Why server-side rules matter more when AI agents call Dataverse: errors as an API, idempotency and least privilege."
series: dataverse-plugins
part: 12
pubDate: 2026-11-20
cover: /covers/plugins-part12.png
tags: [Dataverse, Plugins, Dynamics 365]
---

*Part 12, the final part of my series, Dataverse Plugins: Built for Production. Eleven parts assumed the caller was a person in a form, an integration we designed, or an import we planned. Today the caller is an AI agent, and that changes what plugins are for.*

## A new kind of user just logged in

For twenty years, the biggest question in CRM design was "what will the user do in the form?" We put validation in JavaScript, required fields on the form, business process flows to guide people, and plugins as the last line of defence.

Now Dataverse can be exposed to AI agents through its MCP server, and agents built in Copilot Studio, coding tools and other MCP-compatible clients can create records, update them, query them and run business operations. Administrators decide which clients may connect to an environment, and the agent's actions run under a Dataverse identity with its security roles. But the agent never opens your form. It never sees your JavaScript. It never follows your business process flow. It never reads the tooltip that says "please add the co-applicant first".

So everything you enforced only in the user interface is, for an agent, simply not there.

## Back at the bank

Imagine Priya's company rolls out an agent for loan officers. Priya can type: "Create a home loan for Ravi Kumar, 1.4 crore, 20 years, and attach his salary documents." The agent finds the customer, creates the loan, uploads documents, and reports back.

In the first week of a pilot like this, three things can easily happen:

1.  The agent creates a 1.4 crore loan without a co-applicant. The form would have shown a red banner. The co-applicant plugin from Part 1 blocks it instead, and the agent reads the error message and asks Priya, "This loan needs a co-applicant. Who should I add?"
2.  The agent retries a Create after a network timeout, and Ravi now has two identical draft loans.
3.  Priya asks the agent to "restructure all of Ravi's loans to 25 years", and the agent starts updating tenure fields directly, because there was no clear operation for "restructure" available to it.

The first is the series working as intended. The second and third are what this article is about.

## The thought shift

**The server is now the only place your rules exist for every caller. Design plugins as the contract an agent negotiates with.**

Plugins were always the last line of defence. With agents as callers, for many operations they're the *only* line. And because an agent reads your error messages and acts on them, those messages are no longer just text for a human. They're instructions to a machine about how to fix the request.

## 1. Move every real rule to the server

Audit your rules. For each one, ask: "Is this enforced on the server, or only in the form?"

- Required fields set only on the form: make them required at the column level where the business truly requires them, or validate in a plugin.
- JavaScript that blocks save under conditions: those conditions belong in a PreValidation or PreOperation plugin (Part 2).
- Business process flow stages that "guarantee" order: if the order matters, a plugin must check the status transitions.

Everything in Parts 1 to 4 (stages, reading data correctly, loops) applies unchanged. Agents just make the gaps visible faster.

## 2. Error messages are now an API

Compare two messages for the same rule:

- "Validation failed."
- "Loan LN-20871: loans of ₹1,00,00,000 or more need a co-applicant. Add a co-applicant (new_coapplicantid) and save again."

A human can guess what the first means. An agent can't. The second tells the agent (and Priya) what's wrong, which record, what the threshold is, and which column fixes it. That's why the Part 1 plugin built its message the way it did.

Guidelines for agent-friendly errors:

- **Name the rule, the record and the fix.** One sentence each.
- **Be specific about columns or operations** where it helps the caller correct the request.
- **Still don't leak data** the caller isn't allowed to see (Part 9). "Exceeds the group exposure limit; refer to credit risk" is specific without revealing other branches' loans.
- **Be consistent.** The same rule always produces the same message shape, so agents (and tests) can rely on it.

## 3. Expect retries: make operations idempotent

Agents retry. Networks time out after the server has already committed. That's how Ravi got two loans.

Defences, from simplest:

- **Alternate keys** on natural business identifiers (for example, an application reference), so a second Create with the same reference fails or becomes an Upsert instead of a duplicate.
- **Duplicate checks in PreValidation** for operations without a natural key: same customer, same amount, same product, created in the last few minutes, in draft status. Block with a clear message that names the existing record.
- **Idempotency keys on Custom APIs:** accept a request ID parameter, store it, and if the same ID arrives again return the original result instead of doing the work twice.

## 4. Give agents operations, not fields

When Priya asked to "restructure all of Ravi's loans", the agent did the only thing it could see: update tenure fields. That bypasses the schedule regeneration, the audit, and the privilege check we designed in Part 11.

The fix is to offer the agent the right tool: the `loanhub_RestructureLoan` Custom API, with a clear description and typed parameters, exposed to the agent (for example as a tool or action in Copilot Studio). And then protect the fields themselves: a plugin on Update of tenure that blocks direct changes outside the Custom API (using a shared variable set by the API, as in Part 4), with a message saying "Use the RestructureLoan operation to change tenure."

Now the agent learns the right path from the error, and the business operation is always done properly.

Microsoft is also adding ways to teach agents how your organisation works on top of Dataverse (for example, business skills that agents connected through the MCP server can discover). Those help agents choose well. Plugins and Custom APIs make sure that whatever they choose, the rules hold.

## 5. Identity and least privilege for agents

Everything from Part 9, with higher stakes:

- Know whether the agent acts **as the user** (delegated) or **as its own application identity**. Your plugins see that in UserId and InitiatingUserId.
- An agent identity should have the **smallest role** that does its job. An agent that can read everything as SYSTEM can be talked into revealing everything.
- Record the human behind the agent where possible, for audit. "Created by Loan Agent on behalf of Priya" is accountable. "Created by Loan Agent" alone is not.
- Elevated plugin logic must still output decisions, not data. An agent will happily relay whatever your error message reveals.

## 6. Volume and speed

A person updates a few records an hour. An agent asked to "fix all of them" can update thousands in minutes, possibly through bulk messages. Part 6 suddenly matters a lot more:

- Filtering attributes, minimal images and no queries in loops.
- Plugins on CreateMultiple and UpdateMultiple for tables agents work with.
- Loop prevention (Part 4), because an agent reacting to changes while plugins make changes is a new kind of chain.
- Observability (Part 8): an alert on unusual write volume by an agent identity is worth having on day one.

## What doesn't change

It would be easy to end with "AI changes everything". It doesn't. Look back at the series:

- Choose the stage by what the code needs and changes (Part 2).
- Read the Target as a request, not a record (Part 3).
- Don't create loops; write only real changes (Part 4).
- Keep slow and irreversible work out of the transaction (Part 5).
- Treat every step as a cost on every save (Part 6).
- Test the decisions (Part 7), see what runs (Part 8), decide whose authority each call carries (Part 9), deploy the same way everywhere (Part 10), and model operations, not fields (Part 11).

Agents don't replace any of that. They reward the teams who did it, and expose the ones who didn't.

## Day-2 situations tutorials never show

### "The agent keeps retrying the same failed request"

The plugin returned a vague error, so the agent tried again and again.
**How to fix it:** return clear error messages that say what is wrong and whether a retry will help, as in section 2 of this part.

### "An agent created the same loan twice"

A timeout made the agent retry, but the first request had already worked.
**How to fix it:** make the operation idempotent with a request ID, as in section 3.

### "The agent could see data the user couldn't"

The agent's connection used a powerful service account.
**How to fix it:** give each agent its own identity with the smallest security role it needs, and audit what it changes.

## Using AI with this part

Here the AI is both the tool you build with and the caller you build for.

**Good prompts:**

- *"Here is my Custom API [paste]. Rewrite the error messages so an AI agent knows whether to retry, ask the user, or stop."*
- *"List every operation an agent needs on the loan application table, and the smallest security role for each."*

**Where AI gets it wrong:**

- It gives agents direct update access to raw columns instead of clear operations.
- It assumes the agent will call the API once. Agents retry.
- It forgets that agents never see your form logic, so only server-side rules protect the data.

## Checklist for an agent-ready Dataverse

- Every business rule that matters is enforced on the server, not only in forms.
- Error messages name the rule, the record and the fix, without leaking data.
- Creates are protected against retries with alternate keys, duplicate checks or idempotency keys.
- Business operations are Custom APIs exposed to agents; direct field changes that bypass them are blocked with a helpful message.
- Agent identities have minimal roles, and the human behind the agent is recorded.
- Hot tables are ready for bulk volume, and unusual agent activity triggers an alert.

## If this comes up in an interview

**Q: Why do plugins matter more when AI agents use Dataverse?**  
Agents call the API directly and don't run form logic, so server-side rules are the only rules they meet. Plugins enforce them for every caller.

**Q: How should error messages change for agents?**  
They should state the rule, the record and how to fix the request, consistently, so an agent can correct itself, without revealing data the caller can't see.

**Q: How do you prevent duplicates from agent retries?**  
Alternate keys on business identifiers, duplicate checks in PreValidation, and idempotency keys on Custom APIs.

**Q: An agent changes fields that should only change through a business operation. What do you do?**  
Expose the operation as a Custom API tool, and block direct field changes in a plugin with a message pointing to the operation.

**Q: What security considerations apply to agents?**  
Least-privilege identities, clarity on delegated vs application identity, audit of the human behind the agent, and no data leakage through elevated plugin logic.

## Thank you for reading the series

Twelve parts, one bank, one loan officer called Priya, and one idea underneath all of it: a plugin is a contract on the data, not a feature on a screen. If even one of these parts changes how you register your next step, the series did its job.

If you want to go deeper on the Azure side of these patterns, my Azure Functions with Dynamics 365 series picks up exactly where Part 5 hands off.
