---
title: "Where Should Logic Live? Plugins and Power Automate"
description: "Can a flow stop loans without a co-applicant? No. The server side of the logic question: plugin stages explained with a working plugin, what Power Automate is great at and what it can't do, eight production problems, and how to debug both."
series: dynamics-365-real-world
part: 4
label: "Part 3B"
pubDate: 2026-11-13
cover: /covers/rw-part3b.png
tags: [Plugins, Power Automate, Dynamics 365]
linkedin: "https://www.linkedin.com/feed/update/urn:li:share:7526867897298698240"
---

*Part 3B of my Dynamics 365 Real-World Series. Part 3A put rules on the form with business rules and JavaScript, and showed why imports and integrations walk straight past them. Today: the server side.*

> **A flow reacts. A plugin decides.**

## The scenario: "Can we use a flow for this?"

After the bad-data report from Part 3A, the bank asks the team to make two things happen **every time**, however a loan arrives:

1. **Block** any loan of ₹1 crore or more that has no co-applicant.
2. When a loan is **approved**, email the customer, post a message in the branch's Teams channel, and create a folder for its documents.

A team member suggests: "Let's do both in Power Automate. No code." They build the flow. Requirement 2 works beautifully. Requirement 1 doesn't: the flow sees the bad loan, but **by the time it runs, the loan is already saved**. All it can do is send an alert or try to clean up afterwards.

That one difference, **before the save versus after the save**, is the whole of this article.

## The thought shift

Every save in Dataverse goes through a pipeline:

1. The request arrives (from a form, an import, the API, a flow).
2. Validation and preparation.
3. The database write, inside a transaction.
4. The commit.
5. Whatever happens afterwards.

**Plugins** run inside steps 2 and 3. They can stop the save, change the data before it's written, or roll everything back.

**Power Automate** runs after step 4. It can't stop or undo the save. It reacts to a save that has already happened.

So the question isn't "code or no code?". It's **"must this happen before the data is committed, or after?"**

## The concepts in simple words

### Plugins

C# code that runs on the Dataverse server, registered on:

- a **message** (Create, Update, Delete, and others),
- a **table** (Loan Application),
- a **stage** (when in the pipeline),
- a **mode**: synchronous (the user waits) or asynchronous (it runs in the background, after the save).

| Stage | In plain words | Inside the transaction? | Typical use |
| --- | --- | --- | --- |
| **PreValidation** | "Should I allow this at all?" | Not necessarily | Cheap rejections before anything else runs |
| **PreOperation** | "Let me fix this before it's saved." | Yes | Validate and set values on the record being saved, without an extra update |
| **PostOperation** (sync) | "It's saved; now follow up." | Yes | Create related records; an error here still rolls back the whole save |
| **PostOperation** (async) | "Later, in the background." | No | Work the user shouldn't wait for |

### Power Automate (cloud flows)

A low-code flow with a Dataverse trigger: **when a row is added, modified or deleted**. It runs a few seconds after the commit, under the identity of its connection.

| Power Automate is great at | Power Automate can't |
| --- | --- |
| Emails, Teams messages, approvals | Block a save |
| Creating SharePoint folders, calling connectors | Undo a save (only compensate afterwards) |
| Scheduled jobs ("every morning at 8") | Show an error on the user's form |
| Orchestrating several systems | Guarantee it ran before the user refreshes |

## Implementation 1: the co-applicant rule as a plugin

**Rule:** a loan of ₹1 crore or more must have a co-applicant, on create and on update, from any channel.

**Registration:** Create and Update of `new_loanapplication`, **PreOperation**, **synchronous**. On Update, filtering attributes `new_loanamount` and `new_coapplicant`, plus a **PreImage** named `pre` with those two columns.

```csharp
using System;
using Microsoft.Xrm.Sdk;

namespace LoanHub.Plugins
{
    public class RequireCoApplicant : IPlugin
    {
        private const decimal Threshold = 10000000m;   // ₹1 crore

        public void Execute(IServiceProvider serviceProvider)
        {
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));

            if (!(context.InputParameters["Target"] is Entity target)) return;

            // On Update, Target holds only the columns being changed.
            // Fill the gaps from the pre-image.
            Entity pre = context.PreEntityImages.Contains("pre") ? context.PreEntityImages["pre"] : null;

            decimal amount = GetMoney(target, pre, "new_loanamount");
            EntityReference coApplicant = GetValue<EntityReference>(target, pre, "new_coapplicant");

            trace.Trace($"RequireCoApplicant: message={context.MessageName}, amount={amount}, coApplicant={(coApplicant != null)}");

            if (amount >= Threshold && coApplicant == null)
            {
                throw new InvalidPluginExecutionException(
                    "Loans of ₹1 crore or more need a co-applicant. Add one and save again.");
            }
        }

        private static decimal GetMoney(Entity target, Entity pre, string name)
        {
            var money = GetValue<Money>(target, pre, name);
            return money?.Value ?? 0m;
        }

        // Target wins if it contains the column (even with null); otherwise use the pre-image.
        private static T GetValue<T>(Entity target, Entity pre, string name)
        {
            if (target.Contains(name)) return target.GetAttributeValue<T>(name);
            return pre != null ? pre.GetAttributeValue<T>(name) : default;
        }
    }
}
```

**Why each detail matters:**

- **Target is the request, not the record.** On Update, if the user only changed the phone number, Target doesn't contain the amount. Without the pre-image, the plugin would read 0 and miss the rule.
- **`target.Contains` vs value.** A column present with `null` means "the user is clearing it". A column absent means "not changing". The helper respects that difference.
- **Filtering attributes** stop the plugin running on every unrelated update.
- **`InvalidPluginExecutionException`** shows this exact message to the user on the form, in the import error log and in the API response. One rule, one message, every channel.
- **Tracing** costs nothing when trace logging is off, and saves hours when it's on.

**Steps to deploy:**

1. Build the class library (.NET Framework 4.6.2 for classic plugin assemblies), sign it.
2. Register the assembly with the Plugin Registration Tool (or as a plugin package).
3. Register the two steps as above, with the pre-image on Update.
4. Add the assembly and steps to your solution.
5. Test through **the form, an Excel import and a Web API call**.

The full production treatment of plugins (stages, images, loops, performance, testing, observability, security, ALM) is its own series: [Dataverse Plugins, Built for Production](/series/dataverse-plugins/).

## Implementation 2: the approval follow-ups as a flow

**Requirement:** when a loan becomes Approved, email the customer, post in the branch Teams channel, create a SharePoint folder.

**Steps:**

1. In your solution, **New > Automation > Cloud flow > Automated**.
2. Trigger: **When a row is added, modified or deleted** (Dataverse).
    - Change type: **Modified**.
    - Table: **Loan Applications**.
    - Scope: **Organization**.
    - **Select columns:** `new_loanstatus` (so the flow ignores every other change).
    - **Filter rows:** `new_loanstatus eq 100000003` (your value for Approved).
3. **Get a row by ID** for the applicant contact (email address).
4. **Send an email** to the customer.
5. **Post message in a chat or channel** for the branch's Teams channel.
6. **Create new folder** in the bank's SharePoint document library, named with the loan number.
7. Configure **run after** and a **scope with error handling**: if any step fails, write a note on the loan and alert the support mailbox.
8. Run the flow's connections as a **service account** or **service principal**, not a person.

**Why Select columns and Filter rows:** without them the flow runs on every change to every loan, which wastes runs and can trigger loops with other flows.

## Implementation 3: choosing between them

| Requirement | Plugin | Flow | Why |
| --- | --- | --- | --- |
| Block a bad save, on every channel | ✅ PreValidation / PreOperation | ❌ | Only code in the pipeline can stop the save |
| Set a value before saving (e.g. normalise PAN) | ✅ PreOperation | ❌ | Changing Target in PreOperation saves it with no extra update |
| Create a related record that must exist with the loan | ✅ PostOperation sync | ⚠️ | Same transaction means all-or-nothing |
| Email the customer, post in Teams | ⚠️ async | ✅ | Connectors, no code, easy to change |
| Call a slow external API | ❌ sync / ⚠️ async | ✅ or Azure | Never make users wait on someone else's server |
| Daily reminder for loans stuck 7 days | ❌ | ✅ scheduled | Time-based work is what flows do best |

## Day 2: what actually goes wrong in production

### 1. "The given key was not present in the dictionary"

**What you see:** the plugin works on create and fails on some updates.

**Why it happens:** on Update, Target only has the changed columns. Code like `target["new_loanamount"]` throws when the amount wasn't changed.

**How to handle it:** use `GetAttributeValue` and a pre-image for columns that might not be in Target, as in Implementation 1.

### 2. One save, and the plugin runs many times

**What you see:** trace logs show the plugin running for changes nobody cares about.

**Why it happens:** the Update step has **no filtering attributes**, so it fires for every column on every update, including updates from other plugins and flows.

**How to handle it:** set filtering attributes to only the columns the rule reads.

### 3. The plugin updates its own record and loops

**What you see:** an error about infinite loops, or saves that take forever.

**Why it happens:** a PostOperation plugin calls `service.Update` on the same record, which fires the same plugin again.

**How to handle it:** in PreOperation, change Target directly instead of calling Update. Checking `context.Depth` is a last resort, not a design.

### 4. Saving a loan takes 40 seconds

**What you see:** users wait, and sometimes get a timeout.

**Why it happens:** a synchronous plugin calls a slow external API. Synchronous plugins share the save's time limit (two minutes in the sandbox).

**How to handle it:** move the call out of the synchronous pipeline: an asynchronous step, a flow, or Dataverse → Service Bus → Azure Function, as in the Azure Functions series.

### 5. A flow is used to "block" bad data

**What you see:** bad loans still get saved; a flow later sets them to "Invalid" or deletes them.

**Why it happens:** flows run after the commit. They can only clean up.

**How to handle it:** move the rule into a plugin. Keep the flow for notifications only.

### 6. "I saved, refreshed, and the flow didn't work"

**What you see:** a user saves, refreshes immediately, and the value the flow sets isn't there yet.

**Why it happens:** flows run asynchronously, usually a few seconds later, sometimes longer under load.

**How to handle it:** if the user needs the value immediately, calculate it in a synchronous plugin or a formula column. Otherwise, set expectations ("the folder appears within a minute").

### 7. Every flow fails on Monday morning

**What you see:** all flows fail with authentication errors.

**Why it happens:** the flows' connections belonged to a person who left; their account was disabled.

**How to handle it:** use connection references in solutions, owned by a **service account** or **service principal**, and keep a list of every connection's owner.

### 8. Two flows trigger each other

**What you see:** run history shows thousands of runs; API limits are hit.

**Why it happens:** flow A updates a column that triggers flow B, which updates a column that triggers flow A.

**How to handle it:** use **Select columns** and **trigger conditions** on every Dataverse trigger, and never update the columns that trigger the same flow.

## How to debug plugins and flows

**Plugins**

1. Turn on **Plug-in trace log** (Settings > Administration > System settings > Customization tab: All or Exception) and read the trace for the failing call.
2. Use the **Plugin Profiler** in the Plugin Registration Tool to capture a real execution and replay it in Visual Studio with breakpoints.
3. Check the **step registration**: message, table, stage, filtering attributes, images. Many bugs are registration, not code.
4. Turn trace logging back to **Exception** or **Off** after debugging.

**Flows**

1. Open the flow's **run history**; each step shows its inputs and outputs.
2. Check **trigger conditions** and **Filter rows**: a flow that never runs is usually filtered out.
3. Check the **connection** identity for permission errors (the Part 2 "Principal user is missing… privilege" message).

## Using AI with plugins and flows

### AI to draft

- **Copilot in Power Automate:** describe the flow ("when a loan is approved, email the customer and post in Teams") and it builds a first version. Then add Select columns, Filter rows, error handling and a service connection yourself; Copilot rarely adds them.
- **Copilot in your IDE for plugins:** good at boilerplate (service provider, tracing, registration attributes). Weak at Dataverse specifics like partial Targets and images.

```text
Write a Dataverse plugin in C# for Create and Update of
new_loanapplication, PreOperation, synchronous. Rule: if
new_loanamount >= 10,000,000 then new_coapplicant must not be null.
On Update, Target is partial: use a pre-image named "pre" for missing
columns, and treat a column present with null as being cleared. Use
ITracingService and InvalidPluginExecutionException with a clear
message.
```

### AI as a reviewer

```text
Here is a plugin and its step registration (message, stage, mode,
filtering attributes, images). List: columns read from Target that may
be missing on Update, possible loops, external calls in a sync step,
and anything that should be a flow instead.
```

### Where AI goes wrong here

- It reads `target["column"]` directly and ignores partial Targets.
- It suggests a flow to "validate" data, which can't block the save.
- It forgets filtering attributes and Select columns, the two settings that prevent most production noise.

## Checklist

- [ ] Every "must always hold" rule has a plugin or Entity-scoped business rule
- [ ] Plugins: right stage, filtering attributes, images for partial Targets
- [ ] No synchronous plugin calls slow external systems
- [ ] Tested through the form, an Excel import and a Web API call
- [ ] Flows: Select columns, Filter rows, trigger conditions
- [ ] Flows run under service connections, inside solutions
- [ ] Error handling and alerts on every production flow
- [ ] Trace logging policy agreed for production

## Interview questions, with the answers that land

**1. When would you choose PreValidation over PreOperation?**

PreValidation for cheap checks that should reject a request as early as possible, before other logic runs. PreOperation when I need to read or change the record being saved inside the transaction, because changes to Target there are saved without an extra update.

**2. Can Power Automate stop a save?**

No. It runs after the commit, so it can only react or compensate. Blocking needs a plugin or an Entity-scoped business rule with an error message.

**3. Why does a plugin fail with "The given key was not present"?**

On Update, Target only contains the changed columns, and the code indexed a column that wasn't sent. Use GetAttributeValue and a pre-image.

**4. How do you stop two flows from triggering each other?**

Select columns and trigger conditions on every Dataverse trigger, and never update the columns that trigger the same flow.

**5. A synchronous plugin calls an external API and saves are slow. What do you change?**

Move the call out of the synchronous pipeline: an async step, a flow, or Service Bus to an Azure Function, with retries and an idempotency key.

## Rule of thumb

**Plugins for rules that must decide before the save; flows for work that should happen after it. Test every rule through the form, an import and the API.**

**Next:** Part 4. Before picking any tool, the four questions that decide every design.
