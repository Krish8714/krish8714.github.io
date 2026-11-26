---
title: "PreValidation, PreOperation or PostOperation? Choosing the Stage"
description: "Choose PreValidation, PreOperation or PostOperation by what your code needs and changes, through three real requirements."
series: dataverse-plugins
part: 2
pubDate: 2026-11-20
cover: /covers/plugins-part2.png
tags: [Dataverse, Plugins, Dynamics 365]
---

*Part 2 of my series, Dataverse Plugins: Built for Production. In Part 1 we built a plugin that blocks a big loan without a co-applicant. Today: why it was registered on PreOperation, and how to choose the stage for every plugin you write from now on.*

## The question nobody asks out loud

Open any plugin registration tool and you get a dropdown with three choices: PreValidation, PreOperation, PostOperation. Most developers pick one the same way they pick a seat in a cinema. Whatever was used last time. Whatever the senior picked. Whatever the tutorial showed.

That dropdown is not a cosmetic setting. It decides whether your code runs inside the database transaction or outside it, whether your change to a field is saved for free or costs another update, whether a failure undoes the save or not, and whether the user's security has even been checked yet. Picking the wrong stage does not usually fail on day one. It fails in month three, when someone imports 40,000 records or a second plugin joins the chain.

So let's make the choice deliberate.

## Back at the bank

Priya is the loan officer from Part 1. She works in a Dataverse app at a lending company. Three new requirements just landed on the team's board:

- **Requirement A:** When a loan is created, stamp a risk band (Low, Medium, High) on the record based on the amount and tenure.
- **Requirement B:** When a loan is approved, create a disbursement task for the operations team.
- **Requirement C:** Nobody should be able to delete a loan that already has payments recorded against it.

Three requirements. Three different correct stages. By the end of this article you will know which goes where, and more importantly why, so you can do it for requirements you have never seen.

## First, picture the pipeline

When Priya clicks Save, the platform does not just write a row. It runs a pipeline. Think of it as a conveyor belt with four stations:

1.  **PreValidation (stage 10).** Your code runs before the main operation, and for most requests before the database transaction has started.
2.  **PreOperation (stage 20).** The transaction is open. The record has not been written yet. Whatever you put on the Target is what gets written.
3.  **MainOperation (stage 30).** The platform writes to the database. This stage belongs to Microsoft; you do not register normal plugins here.
4.  **PostOperation (stage 40).** The record is written, still inside the same transaction for synchronous steps. On Create you now have the new ID.

Everything from PreOperation to PostOperation (synchronous) is one transaction. If any code inside it throws, the whole thing is rolled back: the write, your changes, and the changes of every other plugin in that transaction. That single fact explains most of the choices below.

## The thought shift

Here is the mental model I want you to leave with:

**Ask "what does my code need, and what may it change?" Not "when do I want it to run?"**

Every stage gives you a different set of things you can see and a different set of things you can affect cheaply:

- **PreValidation** sees the request before anything is locked. It is the place to say "no" early, and the only place that still sees certain data before the platform acts on it (more on that with Requirement C).
- **PreOperation** can change the record for free. Set a value on the Target and it is saved in the same write. No extra update, no extra plugin trigger.
- **PostOperation** knows the outcome. The record exists, it has an ID, and you can safely create other records that point to it.

Once you think in "needs and effects", the dropdown stops being a guess.

## Requirement A: stamp the risk band (PreOperation)

We need to set a field on the same record that is being saved. The cheapest place to do that is PreOperation, because the Target is the row about to be written. Change it, and your value goes into the database in the same insert.

```csharp
public void Execute(IServiceProvider sp)
{
    var context = (IPluginExecutionContext)sp.GetService(typeof(IPluginExecutionContext));
    var target = context.InputParameters["Target"] as Entity;
    if (target == null) return;

    var amount = target.GetAttributeValue<Money>("new_amount");
    var tenure = target.GetAttributeValue<int?>("new_tenuremonths");
    if (amount == null || tenure == null) return;

    int band = amount.Value >= 5000000m || tenure.Value > 240 ? 3   // High
             : amount.Value >= 1000000m ? 2                          // Medium
             : 1;                                                    // Low

    target["new_riskband"] = new OptionSetValue(band);   // no Update call needed
}
```

Notice what is **not** in that code: no `service.Update()`. That is the whole point of PreOperation.

### The mistake I see most often

The same logic registered on PostOperation, followed by `service.Update(new Entity(...){ ["new_riskband"] = ... })`. It works in the demo. In production it means:

- A second database write for every loan.
- A second Update message, which fires every plugin and flow registered on Update of that table.
- Depth goes from 1 to 2, which matters the day someone adds a plugin that also updates the loan (that story is Part 4).
- An audit entry that shows the record was "modified" a millisecond after it was created.

Rule of thumb: **if you are changing the record being saved, you belong in PreOperation.**

### One subtle thing about Update

On Update, the Target only contains the columns that changed. If the user changed only the tenure, `new_amount` is not in the Target. Your band calculation needs the current amount too, so register a PreImage with `new_amount` and `new_tenuremonths`, and read "target first, then image", exactly like the `Read<T>` helper from Part 1. Also add both columns to the step's filtering attributes, so the plugin does not run when someone edits the description.

## Requirement B: create a disbursement task (PostOperation)

Now we need to create a different record (a task) that points at the loan. The task needs the loan's ID, and it should exist only if the approval actually succeeded.

That is the textbook case for PostOperation:

- The loan write has happened, so the outcome is known.
- On Create, the new ID is available in `context.OutputParameters["id"]`. On Update you already have `target.Id`.
- If creating the task fails in a synchronous step, the approval is rolled back too, so you never have an approved loan without its task.

```csharp
// Registered: Update of new_loan, PostOperation, filtering attribute new_status
var status = target.GetAttributeValue<OptionSetValue>("new_status");
if (status == null || status.Value != StatusApproved) return;

var task = new Entity("task");
task["subject"]          = "Disburse loan";
task["regardingobjectid"] = new EntityReference("new_loan", target.Id);
task["scheduledend"]     = DateTime.UtcNow.AddDays(2);
service.Create(task);
```

### Sync or async here?

This is the second decision hidden in the same dropdown. Ask one question: **must the task exist the moment Priya's save completes?**

- If yes (for example, the next screen opens that task), use synchronous PostOperation. The task and the approval succeed or fail together.
- If no, use asynchronous PostOperation. Priya's save returns faster, the work is queued to the async service, and it is retried if the service is briefly unavailable. The trade-off: if the async job fails, the approval stays approved. Someone must watch the System Jobs view, or you need a flow or alert on failed jobs.

Asynchronous steps can only be registered on PostOperation. That makes sense once you see the pipeline: there is nothing to run "before" when the save has already returned to the user.

## Requirement C: block delete when payments exist (PreValidation)

This is where most teams pick PreOperation and get surprised.

Suppose payments have a parental (cascade delete) relationship to loans. When Priya deletes a loan, the platform also deletes its payments as part of the operation. If your check runs in PreOperation and queries "are there payments for this loan?", depending on the relationship and the order of the cascade you can find that the related records are already being processed, and the answer is no longer reliable.

PreValidation runs before the platform starts that work. It is the documented place to inspect related records before a cascading delete removes them. It is also the cheapest place to reject: no transaction has been opened, so nothing needs to be rolled back.

```csharp
// Registered: Delete of new_loan, PreValidation
var loanRef = (EntityReference)context.InputParameters["Target"];

var query = new QueryExpression("new_payment") { TopCount = 1, ColumnSet = new ColumnSet(false) };
query.Criteria.AddCondition("new_loanid", ConditionOperator.Equal, loanRef.Id);

if (service.RetrieveMultiple(query).Entities.Count > 0)
    throw new InvalidPluginExecutionException(
        "This loan has payments recorded. Close it instead of deleting it.");
```

Notice `TopCount = 1` and `ColumnSet(false)`. We only need to know whether one exists. Don't pull every payment just to count them.

### What "outside the transaction" really means

Microsoft's wording is careful: PreValidation plugins *may* execute outside the transaction. If the Delete itself was triggered by another plugin that is already inside a transaction, your PreValidation step runs inside that one. So never write PreValidation code that assumes "nothing I do here can be rolled back" or, the other way round, "everything I do here will be rolled back". Keep PreValidation for checks and rejections, not for creating records.

## The decision table I actually use

When a new requirement lands, walk down this list and stop at the first match:

1.  **Do I need to stop the operation using data that will be gone or changed once the platform starts?** (cascade delete, related records) → PreValidation.
2.  **Do I only need to reject bad input, cheaply, before anything is locked?** → PreValidation is ideal; PreOperation also works if you need the transaction's view.
3.  **Do I need to change a value on the record being saved?** → PreOperation. Set it on the Target. No Update call.
4.  **Do I need the record's ID, or to create or update other records that must succeed or fail with this save?** → Synchronous PostOperation.
5.  **Is it a side effect the user does not need to wait for, and can it tolerate a delay or a separate failure?** → Asynchronous PostOperation.
6.  **Does it call an external system that might be slow?** → Not a synchronous plugin at all. Asynchronous step, or hand off to Azure (that is Part 5).

## Day-2 situations tutorials never show

### "My value is set but it's not saving"

Changing the Target in PostOperation does nothing to the database. The write has already happened. The change only affects the in-memory object your plugin sees. Move the logic to PreOperation.

### "My validation fires twice"

You registered the same check on Create and Update, and your PostOperation plugin updates the record. The update triggers the validation again. Fix the design: set values in PreOperation, and add filtering attributes so the step only runs for columns that matter.

### "The business rule overwrote my plugin value"

A business rule with Entity scope also runs on the server, in the PreOperation stage. If both your plugin and the rule set the same column in PreOperation, the order decides who wins, and the order is not something your team will remember next year. Pick one owner per column.

### "Execution order 1 and 2, but they run the other way"

Execution order only sorts steps within the same stage and the same mode. A PreOperation step with order 5 always runs before a PostOperation step with order 1. And two steps with the same order have no guaranteed sequence, so never leave two dependent steps at the default of 1.

### "Retrieve plugins are slowing every form"

You can register on Retrieve and RetrieveMultiple, usually in PostOperation, to adjust what comes back. Remember that every view, lookup and subgrid calls RetrieveMultiple. A plugin there runs constantly. Treat it as the most expensive place in the system to put code.

## A quick way to prove it to yourself

In a dev environment, register the same tiny plugin three times: on Create of a test table, at PreValidation, PreOperation and PostOperation. In each, write one trace line with the stage number, the depth, whether the Target has an ID, and whether `context.IsInTransaction` is true. Create one record and open the plugin trace log. Seeing the three lines side by side teaches the pipeline better than any diagram.

```csharp
tracing.Trace("stage={0} depth={1} inTxn={2} targetId={3}",
    context.Stage, context.Depth, context.IsInTransaction,
    target.Id == Guid.Empty ? "(none yet)" : target.Id.ToString());
```

## Using AI with this part

**Good prompts:**

- *"Here is my requirement: [describe]. Should this plugin run in PreValidation, PreOperation or PostOperation, synchronous or asynchronous? Explain the choice in three lines, and say what would break with each wrong stage."*
- *"I have two steps on Update of loan application, order 1 and 2, both PreOperation. Here is what each does [paste]. Can they conflict?"*

**Where AI gets it wrong:**

- It picks PostOperation for validation. Validation belongs before the save, in PreValidation or PreOperation.
- It forgets that PreValidation can run outside the database transaction, so a rollback later doesn't undo what it did.
- It ignores business rules and real-time workflows that also change the same column.
- Always prove the AI's answer with a quick trace in your developer environment, as shown in this part.

## Checklist before you register a step

- I can say in one sentence why this stage, not "because the last one used it".
- If I change the record being saved, I am in PreOperation with no Update call.
- If I create related records that must exist with the save, I am in synchronous PostOperation.
- If the user doesn't need to wait, I chose async and someone monitors failed system jobs.
- Delete checks against related data run in PreValidation.
- On Update, I set filtering attributes and a PreImage with only the columns I read.
- No two dependent steps share the same execution order.
- No column is set by both a plugin and an Entity-scope business rule.

## If this comes up in an interview

**Q: Where would you set a calculated field on the record being created, and why?**  
PreOperation. The Target is the row about to be written, so setting the value there saves it in the same write without an extra Update or another trigger of Update plugins.

**Q: Why can't you register an asynchronous step on PreOperation?**  
Async steps run after the operation has completed and been returned to the caller, so only PostOperation makes sense. Pre-stages exist to influence or stop the operation, which requires being synchronous.

**Q: Which stage runs outside the database transaction?**  
PreValidation, for the initial operation. If the request was triggered from inside an existing transaction, it runs inside that one, so don't rely on it either way.

**Q: A plugin throws in synchronous PostOperation. What happens to the record?**  
The whole transaction rolls back. The record is not saved, and neither are changes made by other synchronous plugins in the same transaction.

**Q: You need to prevent deleting an account that has open cases, and cases cascade-delete with the account. Which stage?**  
PreValidation, so the check sees the related records before the platform's cascade work begins, and rejects before a transaction is opened.

## What's next

We keep saying "read from the Target, fall back to the image". In Part 3 we go deep on that: what exactly is in the Target on each message, how pre and post images work, why an empty column is missing rather than null, and how shared variables let two plugins talk to each other in the same pipeline.
