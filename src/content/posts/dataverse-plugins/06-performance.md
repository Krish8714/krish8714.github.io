---
title: "Performance: Every Sync Step Taxes Every Save"
description: "Filtering attributes, column discipline, CreateMultiple/UpdateMultiple, bypass for migrations, and measuring cost."
series: dataverse-plugins
part: 6
pubDate: 2026-11-20
cover: /covers/plugins-part6.png
tags: [Dataverse, Plugins, Dynamics 365]
---

*Part 6 of my series, Dataverse Plugins: Built for Production. We now know where plugins run, what they see, how they chain and how they call out. Today: what they cost. Every synchronous step you register is a small tax on every save, forever.*

## Nobody files a ticket for 300 milliseconds

Performance problems in Dataverse rarely arrive as one big failure. They arrive as drift. A plugin here adds 80 milliseconds. A validation there adds 120. A Retrieve with all columns adds 60. Each one was reviewed and approved on its own. Each one was fine.

Two years later, saving a loan takes three seconds, the nightly import misses its window, and nobody can point to the change that did it. Because there wasn't one. There were forty.

This article is about treating plugin cost as a budget, not an afterthought.

## Back at the bank

Month-end at Priya's company. The operations team imports 60,000 repayment schedule rows and updates 25,000 loans with new balances. The same import that took 40 minutes last year now takes four hours. The loan table has nine plugin steps registered. Priya's team owns three. An ISV solution owns two. Nobody is sure who owns the other four.

Let's fix it properly.

## The thought shift

**Your plugin doesn't run "when the user saves". It runs on every request that matches its registration, from every caller, multiplied by every record.**

When you write a plugin, picture Priya clicking Save once. When you register it, picture the 25,000-row import, the integration that updates every loan nightly, and the bulk edit someone will do next year. Design for that number.

## Step 1: know what's actually registered

You can't optimise what you can't see. For each busy table, list every step: message, stage, mode (sync or async), filtering attributes, images and owner. The Plugin Registration Tool shows it, and so do the SDK message processing step records you can query.

In almost every review I do, this list alone finds:

- Update steps with **no filtering attributes**.
- Images set to **all columns**.
- Steps for features that were **switched off** in the business but never unregistered.
- Synchronous steps doing work nobody waits for.

## Step 2: the five habits that matter most

### 1. Filtering attributes on every Update step

A step with no filtering attributes runs for every column change. The balance import updates `new_outstanding`. Does your co-applicant validation care? No. Without filtering attributes, it runs 25,000 times for nothing. With them, the platform doesn't even load your plugin.

This single setting is usually the biggest win in the whole review.

### 2. Ask for the columns you need, nothing more

```csharp
// Expensive: reads every column, including big text fields
var loan = service.Retrieve("new_loan", id, new ColumnSet(true));

// Cheap: reads what we use
var loan = service.Retrieve("new_loan", id, new ColumnSet("new_amount", "new_status"));
```

Same rule for images. Same rule for queries. `ColumnSet(true)` in a plugin should fail code review.

### 3. Don't query in a loop

```csharp
// One query per payment: 200 payments = 200 round trips
foreach (var payment in payments)
{
    var loan = service.Retrieve("new_loan", payment.LoanId, cols);
    ...
}

// One query for all of them
var query = new QueryExpression("new_loan") { ColumnSet = cols };
query.Criteria.AddCondition("new_loanid", ConditionOperator.In, loanIds.Cast<object>().ToArray());
var loans = service.RetrieveMultiple(query).Entities.ToDictionary(e => e.Id);
```

### 4. Use what the context already gives you

The Target, the images, the user ID, the record ID, the message name. All free. A Retrieve of the record you're already processing is often a sign that an image is missing from the registration.

### 5. Don't use batch requests inside plugins

ExecuteMultiple and ExecuteTransaction feel like performance tools. Inside a plugin they're not. Your plugin is already running inside the platform's transaction; Microsoft's guidance is not to use batch request types in plugins and workflow activities. Write the individual requests, or redesign so the bulk work happens outside the pipeline.

## Step 3: CreateMultiple and UpdateMultiple

Dataverse has bulk messages, `CreateMultiple` and `UpdateMultiple` (and `UpsertMultiple` where both are supported), that create or update many records of one table in a single request. Modern import tools and integrations increasingly use them because they are much faster.

What this means for your plugins:

- **Your existing Create and Update plugins still run.** The pipeline merges the single and multiple versions of the message, so your logic is applied per record either way. No silent gap.
- **But only plugins written for the multiple message get the big performance gain.** A plugin registered on `UpdateMultiple` is invoked once for the batch and receives an `EntityCollection` named `Targets`, instead of being invoked once per record with `Target`.

```csharp
// Registered on UpdateMultiple of new_loan, PreOperation
var targets = (EntityCollection)context.InputParameters["Targets"];

// Collect what you need for the whole batch, query once
var customerIds = targets.Entities
    .Select(t => t.GetAttributeValue<EntityReference>("new_customerid"))
    .Where(r => r != null).Select(r => r.Id).Distinct().ToArray();

var limits = LoadExposureLimits(service, customerIds);   // one query for the batch

foreach (var target in targets.Entities)
{
    // apply per-record logic using the preloaded data
}
```

Things to get right when you move to the multiple messages:

- **Images** come per record through `IPluginExecutionContext4` (collections of images aligned with the Targets), not the single `PreEntityImages`.
- **Errors should say which record failed.** The exception has constructors that take the record's ID, so the caller knows which row in a 1,000-row batch broke the rule.
- **Filtering attributes behave per batch:** the step runs if any record in the batch contains any of the filtered columns. Your code must still check each record.
- **Don't register the same logic on both** Update and UpdateMultiple, or it will run twice because of the merged pipeline.

For new plugins on tables that get bulk loads, Microsoft's direction is clear: write for the multiple messages. For existing ones, migrate the hot tables first.

## Step 4: synchronous only when someone is waiting

Go through every synchronous step and ask Part 2's question: does the save need this to succeed or fail with it? If the answer is "it's nice if it's done by the time the page refreshes", it's async. Async work is queued and processed by the async service; it no longer adds to the user's save time or to the transaction's lock time.

The trade-off is real (async failures don't roll back the save, and someone must watch failed system jobs), but in most environments a third of synchronous steps can move.

## Step 5: bulk loads and the bypass option

For a one-time data migration, it can be correct to skip custom business logic and validate the data before loading it. Dataverse supports this with the `BypassBusinessLogicExecution` optional parameter (values `CustomSync`, `CustomAsync`, or both), and a caller needs a specific privilege to use it. You can also bypass specific steps by ID.

Use it deliberately:

- Only for migrations or controlled loads where the data has been validated another way.
- Only by service accounts that have been granted the bypass privilege, not everyday users.
- With a written list of what's being skipped and why. Skipping the plugin that sets risk bands means 60,000 loans without risk bands unless something else sets them.

Microsoft's own business logic still runs; this bypasses your custom logic, not the platform's.

## Stateless means fast and safe

The platform may cache your plugin instance and run it on several threads at once. That's good for speed, but it means any instance field that changes during Execute is shared between concurrent saves. Two loans can overwrite each other's values. That's not just a correctness bug; the usual "fix" (locks) turns into a performance bottleneck.

Keep plugins stateless: everything per-execution lives in local variables. Read-only values set in the constructor (like the threshold from configuration in Part 1) and thread-safe shared objects (like a static HttpClient) are fine.

## Measure, don't guess

- **Plugin trace log** records the execution duration of each plugin run. Sort by duration to find your slowest steps.
- **Trace your own timings** around anything suspicious: queries, external calls, loops.
- **Application Insights** (Part 8) gives you plugin execution telemetry across the environment over time, so you can see drift before users feel it.
- **Load test the hot path** before a big import: create 5,000 records in a test environment with all production steps registered, and time it. Then do it again after your change.

## Day-2 situations tutorials never show

### "The import fails with timeouts but the plugin is fast"

Each plugin is fast; together they're not. Nine synchronous steps at 150 ms each is over a second per record, inside one transaction, before the import tool's own overhead. Look at the total per save, not plugin by plugin.

### "Deadlocks during month-end"

Long synchronous chains hold locks while they work. Two batches updating loans of the same customer, with a plugin that updates the customer, block each other. Shorter transactions (fewer synchronous steps, no external calls inside them) are the fix, not retries.

### "Saving one loan updates 300 schedule rows"

That plugin will be the slowest thing in the system. Ask whether the 300 updates need to be in the same transaction. Often they can be regenerated asynchronously, or computed when needed.

### "The ISV's plugin is the slow one"

You can't change their code, but you can see it in the trace log, raise it with the vendor, and check whether their steps have filtering attributes you're allowed to configure. Know your whole table, not just your code.

## Using AI with this part

**Good prompts:**

- *"Here is my plugin [paste]. List every call to Dataverse, which columns it asks for, and how to cut the number of calls."*
- *"Rewrite this loop of 300 Update calls to use UpdateMultiple, and keep the same error handling."*
- *"Here are timings from my trace log [paste]. Which step is the slowest, and why?"*

**Where AI gets it wrong:**

- It uses `new ColumnSet(true)` and reads every column.
- It updates records one by one inside a loop.
- It suggests making everything asynchronous, even when the user needs the result before the save finishes.

## Checklist

- I have a list of every step on the busy tables, with owner and purpose.
- Every Update step has filtering attributes.
- No `ColumnSet(true)`, no all-column images.
- No queries inside loops; batch reads with `In` conditions.
- No ExecuteMultiple or ExecuteTransaction inside plugins.
- Hot tables have plugins on CreateMultiple/UpdateMultiple, using Targets, with per-record error IDs.
- Synchronous only where someone is waiting for the result.
- Bypass is used only for validated migrations by privileged service accounts.
- Plugins are stateless.
- Slowest steps are known from the trace log or telemetry, not guessed.

## If this comes up in an interview

**Q: What's the quickest performance win on a slow Dataverse table?**  
Add filtering attributes to Update steps and trim images and ColumnSets to the columns actually used.

**Q: Do Create plugins run when someone uses CreateMultiple?**  
Yes. The pipeline merges single and multiple messages so the logic still applies. But only plugins registered on the multiple message get the performance benefit of processing the batch at once.

**Q: Why not use ExecuteMultiple inside a plugin?**  
The plugin already runs inside the platform transaction, and Microsoft recommends against batch request types in plugins; it adds load without the expected benefit.

**Q: How do you skip custom plugins during a data migration?**  
Pass the BypassBusinessLogicExecution optional parameter with CustomSync and/or CustomAsync, from an account that has the bypass privilege, after validating the data.

**Q: Why must plugins be stateless?**  
Instances can be cached and run concurrently, so mutable instance fields are shared between executions and cause data mix-ups.

## What's next

We've said "test it" many times. Part 7 makes it concrete: unit testing plugins without a Dataverse environment, the cases that matter, and running those tests on every commit in a CI pipeline.
