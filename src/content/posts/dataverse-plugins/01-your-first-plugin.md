---
title: "Your First Plugin, Not Just the Demo"
description: "Build one real Dataverse plugin the production way: partial Targets, images, configuration, bypass for migrations, error messages and a debugging playbook."
series: dataverse-plugins
part: 1
pubDate: 2026-11-20
cover: /covers/plugins-part1.png
tags: [Dataverse, Plugins, Dynamics 365]
---

*Part 1 of my series, Dataverse Plugins: Built for Production. In Part 3B of my Real-World Series I promised: "Next up: building your first plugin." Here it is, and it grew into a series.*

> **A plugin is a contract on the data, not a feature on a screen.**

Most developers build a plugin for the screen they demo on. The data does not care about that screen. It arrives through the form, an Excel import, the Web API, a flow, a nightly integration, a data migration and now AI agents. A plugin that only survives the demo is a feature. A plugin that holds on every path, and stays understandable when it fails, is a contract.

This guide follows one loan officer, one rule and one plugin from the first line of code to the 11 PM support ticket. Every problem in it has been reported by real developers on the Microsoft community forums.

## Before any code: should this even be a plugin?

The rule: **any loan of ₹1 crore or more must have a co-applicant.**

The best plugin is sometimes the one you don't write. Climb this ladder and stop at the first step that holds:

| Step | Runs where | Holds on imports and APIs? | Good for |
| --- | --- | --- | --- |
| Business rule, form scope | The form only | No | Showing, hiding, guiding the user |
| Business rule, **Entity** scope | Form + server, in the PreOperation stage ([Microsoft Learn](https://learn.microsoft.com/en-us/training/modules/define-create-business-rules/1-rules)) | Yes | Simple field checks, no code |
| Low-code plugin (Power Fx, preview) | Server | Yes | Server logic owned by makers |
| C# plugin | Server, any stage | Yes | Logic that must be precise, testable and controlled |

Be honest: for our rule as written, an **Entity-scoped business rule** would block the save on every path, with no code. If that is all the bank ever needs, ship the business rule and stop reading.

We still choose C# here, because the real requirement is bigger than the one-line rule:

- The error must **name the loan**, because the same message lands in import logs and API errors.
- The credit team changes the **threshold** every few quarters, without a release.
- The **data migration** must load historical loans that break the rule, under control, while business users stay blocked.
- The rule must have **automated tests** that run on every build.
- Next quarter it will grow: a second rule for joint accounts, and a check against the bureau score.

That is the first thought shift: **choose the tool from the requirement around the rule, not from the rule.**

## Meet Priya

Priya is a loan officer at the bank's Hyderabad branch. On Monday she saves loan **LN-20481** for **₹1.2 crore**. We will follow her loan, her branch and her support tickets through the whole guide.

**What you need:** Visual Studio 2022, the Power Platform CLI (`pac`), a dev environment, and System Customizer rights. The table is the Loan Application from the Real-World series: `new_loanapplication`, with Amount (`new_amount`, Currency), Co-applicant (`new_coapplicantid`, lookup to Contact) and Loan Number (`new_name`).

## Follow Priya's save

![One save through the Dataverse pipeline: form, import and API become the same message, then PreValidation, PreOperation (our plugin), the database write and PostOperation inside one transaction](/diagrams/plugin-pipeline.svg)

Priya's click, the import and the API call become the same message, so one plugin protects all three. Our plugin sits in PreOperation, inside the transaction: its error stops the whole save.

## The concepts, through Priya's save

- **Message.** Every path becomes `Create` or `Update`. You register on a message and a table, never on a form. That is why the plugin is the contract.
- **Stage.** *PreValidation* runs before the main checks, outside the transaction: the cheapest place to say no. *PreOperation* runs inside the transaction, just before the write: say no, or change a value in `Target` and it is saved with no extra update. *PostOperation* runs after the write, still inside the transaction for a sync step: an error there still rolls everything back.
- **Sync vs async.** Sync: Priya's spinner waits and she sees the error. Async: runs later as a system job after the commit; it can never block her save, and its failures go to System Jobs, not to her screen.
- **Transaction.** The write and every sync step share one transaction. If our plugin throws, LN-20481 is not half-saved; it is not saved. A slow external call inside a sync step holds Priya, and the transaction, for up to two minutes.
- **Context.** `IPluginExecutionContext` is the plugin's briefing: message, table, record ID, who is saving (`UserId`, and `InitiatingUserId` when a system account acts for someone), stage and depth.
- **Target.** What is *being sent*, not the record. On Create it holds what Priya filled. When she later edits only the amount, it holds only the amount.
- **Images.** A snapshot of chosen columns before (pre-image) or after (post-image, PostOperation only) the save. One detail most guides miss: a column whose value is **empty is simply absent** from the image, so `Contains` is false, not "contains null".
- **Depth.** 1 when Priya saves; +1 each time a plugin or workflow triggers another operation in the same chain. A loop guard, not a way to detect "the user did this".
- **Sandbox.** No file system, limited network, a two-minute limit per execution.
- **Statelessness.** Dataverse creates the plugin class once and reuses that instance for many saves at the same time. Microsoft's guidance: never store execution state in fields, only configuration from the constructor ([Microsoft Learn](https://learn.microsoft.com/power-apps/developer/data-platform/best-practices/business-logic/develop-iplugin-implementations-stateless)). A field like `_currentLoan` would let one officer's loan leak into another's save.
- **Services.** To read or write other records, create an `IOrganizationService` from `IOrganizationServiceFactory`, usually as the calling user. Our rule needs none: `Target` and the pre-image are enough, which is why it is fast.

## Version 1: the plugin every tutorial writes

`pac plugin init` creates a signed .NET Framework 4.6.2 project, which is what Dataverse requires. Then the classic first plugin:

```csharp
public class ValidateCoApplicant : IPlugin
{
    public void Execute(IServiceProvider serviceProvider)
    {
        var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
        var target = (Entity)context.InputParameters["Target"];

        var amount = ((Money)target["new_amount"]).Value;
        var coApplicant = target["new_coapplicantid"];

        if (amount >= 10000000m && coApplicant == null)
            throw new InvalidPluginExecutionException("Co-applicant is required.");
    }
}
```

Registered on Create, sync, PreOperation. Priya saves LN-20481 with no co-applicant: blocked. She adds one: saved. Demo passed. Most tutorials end here.

It breaks in five ways, and none of them shows up in a demo.

## Day 2: what happened in Priya's branch

Each situation below is one that developers keep reporting on the Microsoft community forums and Microsoft Q&A. Only the loan details are ours.

### 1. "I only changed the phone number and got an error"

Priya updates a customer's phone number on an existing loan. The save fails: *"The given key was not present in the dictionary."*

**Why:** on Update, `Target` carries only the columns being changed. Microsoft's own tutorial checks that a column "is passed" before reading it ([Microsoft Learn](https://learn.microsoft.com/power-apps/developer/data-platform/tutorial-update-plug-in)). `target["new_amount"]` throws because the amount was not passed.

**The quieter twin:** her colleague raises a ₹50 lakh loan to ₹1.5 crore. The co-applicant is not in `Target`, so depending on how you read it, the rule either crashes or waves the loan through.

**Fix:** read with `GetAttributeValue`, add a **pre-image** with the columns the rule needs, and add **filtering attributes** so the step only runs when those columns are sent.

### 2. "Policy changed. Make it ₹75 lakh by Monday."

The threshold is hard-coded, so a one-number policy change needs a build, a release and a deployment window.

**Fix:** read the threshold from the step's **unsecure configuration** in the plugin's constructor. Configuration passed to the constructor is the one kind of class-level data Microsoft's guidance allows in a stateless plugin. The policy change becomes a configuration change.

### 3. "The migration stopped at row 312"

The migration team loads 40,000 historical loans. Old loans above ₹1 crore have no co-applicant, because the rule did not exist then. The plugin blocks them.

This is a classic: teams on community forums ask how to avoid turning off their custom plugins during a data migration phase ([TIBCO Community](https://community.tibco.com/forums/topic/12279-support-bypass-plugin-execution-for-d365/)).

**Fix:** never disable or weaken the plugin. Send the migration requests with the `BypassBusinessLogicExecution` option (`CustomSync`, `CustomAsync`), which skips custom plugins and workflows for that request only ([Microsoft Learn](https://learn.microsoft.com/power-apps/developer/data-platform/bypass-custom-business-logic)). Give the bypass privilege to the migration account only, for the load window. Priya and every other user still hit the rule.

### 4. "Which loan failed?"

An Excel import of 800 loans fails on 6 rows. The log says *"Co-applicant is required."* six times.

**Fix:** write the message for whoever has to act on it, in every place it can appear: the form, the import log, an API error. *"Loan LN-20481: loans of ₹1,00,00,000 or more need a co-applicant. Add one and save again."*

### 5. The 11 PM ticket: "Blocked, but it HAS a co-applicant"

Priya's manager raises LN-20481 from ₹1.2 to ₹1.4 crore. It already has a co-applicant. The save is blocked. Nobody can reproduce it in dev.

**Why:** in production the image was registered as `preimage`; the code asks for `PreImage`. The image never arrives, the co-applicant is not in `Target`, so the plugin concludes there is none. Missing images are a recurring question on Microsoft Q&A, where developers find `PreEntityImages` empty while debugging an update step ([Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/265977/d365-v9-plug-in-pre-and-post-images)).

**Fix:** one trace line per run that shows what the plugin saw, including whether the image arrived. With it, this ticket takes five minutes instead of a night. The test suite below includes this exact case: with the image missing, a loan that has a co-applicant is rejected.

## Version 2: the contract

Every line maps to a situation above. This version compiles, and all nine scenario tests below pass against it (situation numbers in the comments).

```csharp
using System;
using System.Globalization;
using Microsoft.Xrm.Sdk;

namespace LoanHub.Plugins
{
    public class ValidateCoApplicant : IPlugin
    {
        private const string ImageName = "PreImage";                         // (5) must match the registration exactly
        private static readonly CultureInfo India = new CultureInfo("en-IN"); // ₹1,00,00,000 format
        private readonly decimal _threshold;                                  // read-only configuration: safe in a shared instance

        // (2) Dataverse passes the step's unsecure and secure configuration here
        public ValidateCoApplicant(string unsecureConfig, string secureConfig)
        {
            decimal value;
            _threshold = decimal.TryParse(unsecureConfig, NumberStyles.Number, CultureInfo.InvariantCulture, out value) && value > 0
                ? value
                : 10000000m; // default: ₹1 crore
        }

        public void Execute(IServiceProvider serviceProvider)
        {
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var tracing = (ITracingService)serviceProvider.GetService(typeof(ITracingService));

            Entity target = context.InputParameters.Contains("Target") ? context.InputParameters["Target"] as Entity : null;
            if (target == null) return;

            // (1) On Update, Target has only the columns being sent. Fall back to the pre-image.
            Entity before = context.PreEntityImages.Contains(ImageName) ? context.PreEntityImages[ImageName] : null;

            Money amount = Read<Money>(target, before, "new_amount");
            EntityReference coApplicant = Read<EntityReference>(target, before, "new_coapplicantid");
            string loanNumber = Read<string>(target, before, "new_name") ?? "(new loan)";

            // (5) One line that answers: what did the plugin see?
            tracing.Trace("{0} {1}: depth={2}, amount={3}, threshold={4}, coApplicant={5}, image={6}",
                context.MessageName, loanNumber, context.Depth,
                amount == null ? "null" : amount.Value.ToString(CultureInfo.InvariantCulture),
                _threshold, coApplicant != null, before != null);

            if (amount != null && amount.Value >= _threshold && coApplicant == null)
            {
                // (4) A message that makes sense on the form, in an import log and in an API error
                throw new InvalidPluginExecutionException(string.Format(
                    "Loan {0}: loans of ₹{1} or more need a co-applicant. Add one and save again.",
                    loanNumber, _threshold.ToString("N0", India)));
            }
        }

        // The value being sent wins, even when it is being cleared. Otherwise use the value already saved.
        // An empty column is absent from the image, so a missing key correctly means "no value".
        private static T Read<T>(Entity target, Entity before, string column)
        {
            if (target.Contains(column)) return target.GetAttributeValue<T>(column);
            if (before != null && before.Contains(column)) return before.GetAttributeValue<T>(column);
            return default(T);
        }
    }
}
```

*Situation 3 needs no code: the bypass is set on the migration requests, never in the plugin.*

### Registration (`pac tool prt`)

Register the assembly (Sandbox, Database), then:

| Setting | Step A | Step B |
| --- | --- | --- |
| Message | Create | Update |
| Table | new_loanapplication | new_loanapplication |
| Stage, mode | PreOperation, synchronous | PreOperation, synchronous |
| Filtering attributes | (not used on Create) | new_amount, new_coapplicantid |
| Unsecure configuration | 10000000 | 10000000 |
| Image | none | Pre Image named `PreImage`: new_amount, new_coapplicantid, new_name |

Add the assembly and both steps to your **solution**, so test and production get exactly this registration. Hand-registering in production is how situation 5 happens.

### The test matrix

Rows 1 to 9 were run against the code above with a simulated Dataverse context, and all pass. Run all ten in your dev environment before you ship.

| # | Scenario | Expected |
| --- | --- | --- |
| 1 | Create ₹1.2 crore, no co-applicant | Blocked, message names the loan |
| 2 | Create ₹1.2 crore, with co-applicant | Saved |
| 3 | Update only the phone on a ₹2 crore loan with co-applicant | Saved (Step B does not run) |
| 4 | Raise ₹50 lakh to ₹1.5 crore, no co-applicant | Blocked (empty co-applicant is absent from the image) |
| 5 | Clear the co-applicant on a ₹2 crore loan | Blocked |
| 6 | Configuration 7500000, create ₹80 lakh with no co-applicant | Blocked, message shows ₹75,00,000 |
| 7 | Default configuration, create ₹80 lakh with no co-applicant | Saved |
| 8 | Configuration typo (`abc`) | Falls back to ₹1 crore |
| 9 | Image missing, amount raised | Blocked, trace shows `image=False` (situation 5) |
| 10 | Migration account with `BypassBusinessLogicExecution`, historical loan breaking the rule | Loads (dev environment only) |

## Debugging playbook

Start from the symptom, not the code.

| Symptom | Most likely cause | Look first |
| --- | --- | --- |
| *"The given key was not present in the dictionary"* | Indexer read of a column not sent on Update | Trace line; switch to `GetAttributeValue` + image |
| Rule rejects records that look valid | Image missing or misnamed | Trace shows `image=False`; compare registration with code |
| Rule silently skipped | Step disabled, wrong message/table, or filtering attributes exclude the column | The step in the Plugin Registration Tool |
| Generic error with "Download log file" | Exception other than `InvalidPluginExecutionException` | The log's stack trace |
| Saves slow | Step without filtering attributes, or an external call in a sync step | Trace timestamps; the step settings |
| "Infinite loop" / depth limit error | Plugin updates the record that triggered it; the platform treats the chain as a loop and stops it ([community.dynamics.com](https://community.dynamics.com/article/KA-25677)) | Trace `depth=`; update only when a value really changed |
| Works in dev, fails in production | Different registration, image, configuration or role | Compare the solution's steps; replay with the Profiler |

**Tool 1, the plug-in trace log (always first).** In dev: Advanced Settings → Settings → Administration → System Settings → Customization → *Enable logging to plug-in trace log* = **All**. In production keep it on **Exception**. Reproduce, then open Settings → Plug-in Trace Log, filter by `LoanHub.Plugins.ValidateCoApplicant`, and read the Message Block. Our line looks like this:

```text
Update LN-20481: depth=1, amount=14000000, threshold=10000000, coApplicant=False, image=False
```

`image=False` on an Update solves Priya's 11 PM ticket in one glance.

**Tool 2, the Plugin Profiler (replay the real failure).** When the trace is not enough:

1. Plugin Registration Tool → **Install Profiler** (dev or test only).
2. Select Step B → **Start Profiling**, then reproduce Priya's save.
3. **Replay Plug-in Execution** → pick the captured profile, point to your DLL and PDB.
4. In Visual Studio, set a breakpoint in `Execute` and **Attach to Process** → the Plugin Registration Tool.
5. **Start Execution**: Visual Studio stops with Priya's exact context, `Target` and image.
6. **Stop Profiling** and uninstall it from shared environments.

**Tool 3, unit tests (catch it before anyone files a ticket).** Each Day-2 situation is a test case. A framework such as FakeXrmEasy builds the context, `Target` and images in memory so they run on every build (check its licence for commercial use). That is how rows 1 to 9 of the test matrix were run for this guide.

## The production-readiness checklist

Ten questions to answer before **any** plugin ships, not just this one. Copy it into your pull-request template.

- [ ] **Right tool?** Could an Entity-scoped business rule, a low-code plugin or an async process do this instead?
- [ ] **Every path?** Tested through the form, an import, the Web API and a flow, not just the form.
- [ ] **Partial Target?** Every column read with `GetAttributeValue`, with an image for columns that may not be sent.
- [ ] **Images?** Name in code = name in registration; only the columns needed; empty columns treated as absent.
- [ ] **Filtering attributes?** The Update step runs only when its columns are sent.
- [ ] **Configuration?** Values the business will change live in step configuration, a config table or an environment variable, not in code.
- [ ] **Bypass plan?** Known how migrations and bulk loads will run, and who holds the bypass privilege.
- [ ] **Messages?** Every error names the record and the fix, and reads well in an import log.
- [ ] **Observability?** One trace line per run that answers "what did the plugin see?"
- [ ] **Stateless and safe?** No per-save data in fields; no external calls in sync steps; no updates that re-trigger the same step.

## In the interview

"Tell me about a plugin you wrote" comes up in almost every Dynamics 365 interview. Most candidates describe version 1. Tell the journey instead:

> "First I checked whether a business rule with Entity scope was enough. It wasn't, because the business needed loan-specific messages, a configurable threshold and a controlled migration. So I built a synchronous PreOperation plugin on Create and Update. Updates only send changed columns, so I used a pre-image and filtering attributes. The threshold lives in step configuration. Migrations use the bypass option on a dedicated account. Every run writes one trace line, so a mismatched image name shows up in minutes, not hours."

About 45 seconds, and every sentence invites a follow-up you can answer.

**Questions to practise**

1. Why might a column be missing from `Target` on Update, and how do you handle it?
2. When would you choose an Entity-scoped business rule over a plugin, and when not?
3. The business changes a plugin's threshold every quarter. How do you avoid a release each time?
4. A migration is blocked by your validation plugin. Do you disable it?
5. Why must plugin classes be stateless?
6. A plugin rejects valid records only in production. How do you investigate?

---

> **A plugin is a contract on the data, not a feature on a screen.** Write it for every path the data can take, and for the person reading the trace log at 11 PM.

**Next in the series:** Part 2, choosing the stage: PreValidation, PreOperation or PostOperation, decided through three real requirements.

## Sources

- [Define business rules: scope and server-side execution](https://learn.microsoft.com/en-us/training/modules/define-create-business-rules/1-rules) (Microsoft Learn)
- [Tutorial: Update a plug-in](https://learn.microsoft.com/power-apps/developer/data-platform/tutorial-update-plug-in) (Microsoft Learn)
- [Develop IPlugin implementations as stateless](https://learn.microsoft.com/power-apps/developer/data-platform/best-practices/business-logic/develop-iplugin-implementations-stateless) (Microsoft Learn)
- [Bypass custom Dataverse logic](https://learn.microsoft.com/power-apps/developer/data-platform/bypass-custom-business-logic) (Microsoft Learn)
- [Troubleshoot Dataverse plug-ins](https://learn.microsoft.com/en-us/powerapps/developer/data-platform/troubleshoot-plug-in) (Microsoft Learn)
- [Plug-in reaching the depth limit (KA-25677)](https://community.dynamics.com/article/KA-25677) (Dynamics 365 Community)
- [Pre and post images empty while debugging an update step](https://learn.microsoft.com/en-us/answers/questions/265977/d365-v9-plug-in-pre-and-post-images) (Microsoft Q&A)
- [Bypassing plugin execution during data migration](https://community.tibco.com/forums/topic/12279-support-bypass-plugin-execution-for-d365/) (TIBCO Community)
