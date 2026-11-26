---
title: "Processing Heavy Dataverse Workloads with Durable Functions"
description: "How to process 250,000 Dataverse loan records every night without timeouts, duplicates or a stuck queue, using Azure Durable Functions, in simple English with working code."
series: azure-functions-dynamics-365
part: 3
pubDate: 2026-09-22
cover: /covers/azure-part3.webp
tags: [Azure Functions, Dataverse, Dynamics 365]
linkedin: "https://www.linkedin.com/pulse/stateful-serverless-crm-processing-heavy-dataverse-durable-ithakota-hn3kf/"
---

*📚 This is Part 3 of my series "Azure Functions with Dynamics 365". New here? Start with* [*Part 1*](/posts/azure-functions-dynamics-365/01-beginner-tutorial/)*, or read the previous one:* [*Part 2: Surviving high-volume integrations*](/posts/azure-functions-dynamics-365/02-high-volume-integrations/)*.*

*Updated November 2026: rewritten in simpler English, the code now makes every ledger posting safe to retry, and new sections on what breaks after go-live, using AI and a checklist.*

## The story

LoanHub has 250,000 active loans. Every night at midnight (UTC), a batch job must:

1. Read each loan's balance, interest rate and penalty rules.
2. Work out today's interest and any late fee.
3. Create a **ledger entry** for each loan.
4. Update the loan with its new totals.

Two rules can't be broken:

- **It must finish by 4 AM**, before the banking systems pick up the data.
- **Each loan must be charged exactly once.** If a server restarts halfway, no loan may get interest twice.

## Why the usual tools fail at this size

![Why common Dynamics 365 tools fail for a 250,000-record nightly batch](/images/azure-part3-1.webp)

### 1. A synchronous plugin: the 2-minute limit

Plugins run in a sandbox with a **2-minute limit**. A loop over thousands of loans hits it, the plugin is stopped, and because a synchronous plugin is part of the database transaction, all its work is rolled back. While that happens, other users can be blocked on the same rows.

### 2. Asynchronous plugins or workflows: a flooded background queue

Starting 250,000 background jobs puts them all in the same queue Dynamics uses for its own work: emails, SLAs, cascade deletes, other plugins. That work waits behind your batch, and users notice everything getting slow.

### 3. Power Automate: request limits and throttling

An "Apply to each" over 250,000 records with 4 actions inside is about **1 million actions**. That uses up your Power Platform request limits, and Dataverse starts answering **429 Too Many Requests** (one user can make about 6,000 requests in 5 minutes). A 3-hour job turns into days.

### 4. A normal Azure Function: it forgets where it stopped

A normal Function on the classic Consumption plan stops after **5 minutes by default, 10 at most**. Even on a bigger plan, servers restart for patches. And a normal Function keeps no memory: if it stops after 134,000 loans, you don't know safely where to restart. Start again from the top and the first 134,000 loans get charged twice. To avoid that, you'd have to build your own tracking tables, which is exactly what Durable Functions already does.

## The design: fan-out, fan-in

![Fan-out and fan-in with Durable Functions](/images/azure-part3-2.webp)

Durable Functions splits the work and remembers progress for you. There are four parts:

1. **Timer starter:** runs at midnight and starts one orchestration for that night.
2. **Orchestrator:** gets the list of loan IDs, splits it into batches of 400, and starts one activity per batch.
3. **Activities (workers):** each one handles one batch of 400 loans and writes the results to Dataverse.
4. **Fan-in:** when every batch is done, the orchestrator adds up the results and writes one run summary to Dataverse.

**Fan-out** means starting many batches in parallel. **Fan-in** means waiting for all of them and combining the results.

## How Durable Functions remembers progress

![Event sourcing and replay](/images/azure-part3-3.webp)

Durable Functions keeps a **history** of everything the orchestrator has done, in Azure Storage. This storage area is called a **task hub**.

Here is what happens step by step:

1. The orchestrator runs from the top and reaches "start batch 1".
2. It writes "batch 1 started" to the history, then **stops running**. You don't pay while it waits.
3. The batch finishes and writes its result to the history.
4. The orchestrator **starts again from the top**. When it reaches "start batch 1", it looks in the history, sees the result is already there, and uses it instead of running the batch again.
5. It carries on to the next step.

So if the server restarts at loan 134,000, the orchestrator just replays its history and continues with the batches that aren't finished. No custom tracking tables needed.

## The one rule: orchestrator code must give the same result every time

![What breaks determinism](/images/azure-part3-4.webp)

Because the orchestrator re-runs from the top many times, its code must take the same path every time. So inside the orchestrator:

- **No `DateTime.UtcNow`.** It is different on every replay. Use `context.CurrentUtcDateTime`.
- **No `Guid.NewGuid()`.** Use `context.NewGuid()`.
- **No calls to Dataverse or other systems.** Put them in activities.

## Keeping Dataverse safe while you fan out

Starting hundreds of batches at once can overwhelm Dataverse. Three things keep it safe:

**1. Limit how many batches run at once**, in `host.json`:

```json
{
  "version": "2.0",
  "extensions": {
    "durableTask": {
      "maxConcurrentActivityFunctions": 16
    }
  }
}
```

This is per Function app instance. Start low, watch for 429s, then raise it.

**2. One shared ServiceClient.** Register it once as a singleton. Creating a new one in every activity uses up outbound connections.

**3. Batch the writes.** Send each batch's creates and updates in one `ExecuteMultipleRequest`. It accepts up to 1,000 requests, so 400 loans with 2 requests each (800) fits.

## Exactly once: make every posting safe to retry

Durable Functions can run an activity **more than once**: after a timeout, a restart, or a retry. If the activity creates ledger entries with a plain Create, a retry creates them again, and the loan is charged twice.

The fix is to give each ledger entry a **business key** that is the same on every retry, for example the loan ID plus the posting date, and to use **Upsert** instead of Create:

- Add a text column `lh_postingkey` to the ledger entry table and make it an **alternate key**.
- Fill it with `{loanId}-{yyyyMMdd}`.
- Use `UpsertRequest`. On a retry, Dataverse finds the existing entry and updates it instead of creating a second one.

## The code

This uses the **isolated worker model on .NET 10** and the Durable Functions isolated packages.

### Timer starter: one run per night, never two

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.DurableTask.Client;
using Microsoft.Extensions.Logging;

public class NightlyStarter(ILogger<NightlyStarter> log)
{
    [Function(nameof(NightlyStarter))]
    public async Task Run(
        [TimerTrigger("0 0 0 * * *")] TimerInfo timer,
        [DurableClient] DurableTaskClient client)
    {
        // Fixed ID per night, so a restart or a manual run can't start a second copy
        string instanceId = $"loan-batch-{DateTime.UtcNow:yyyyMMdd}";

        var existing = await client.GetInstanceAsync(instanceId);
        if (existing is not null)
        {
            log.LogWarning("Run {Id} already exists with status {Status}", instanceId, existing.RuntimeStatus);
            return;
        }

        await client.ScheduleNewOrchestrationInstanceAsync(
            nameof(LoanBatchOrchestrator.Run),
            new StartOrchestrationOptions(instanceId));
    }
}
```

### The orchestrator

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.DurableTask;
using Microsoft.Extensions.Logging;

public static class LoanBatchOrchestrator
{
    [Function(nameof(Run))]
    public static async Task<RunSummary> Run([OrchestrationTrigger] TaskOrchestrationContext context)
    {
        ILogger log = context.CreateReplaySafeLogger(nameof(LoanBatchOrchestrator));

        // All reading from Dataverse happens in an activity
        var loanIds = await context.CallActivityAsync<List<Guid>>(nameof(LoanActivities.GetActiveLoanIds));
        if (loanIds.Count == 0) return new RunSummary();

        // Batches of 400 loans
        var batches = loanIds.Chunk(400).Select(b => b.ToList()).ToList();
        DateTime postingDate = context.CurrentUtcDateTime.Date; // never DateTime.UtcNow here

        var retry = TaskOptions.FromRetryPolicy(new RetryPolicy(
            maxNumberOfAttempts: 5,
            firstRetryInterval: TimeSpan.FromSeconds(10),
            backoffCoefficient: 2.0,
            maxRetryInterval: TimeSpan.FromMinutes(2)));

        // Fan-out
        var tasks = batches
            .Select(b => context.CallActivityAsync<BatchResult>(
                nameof(LoanActivities.ProcessBatch), new BatchRequest(b, postingDate), retry))
            .ToList();

        // Fan-in
        BatchResult[] results = await Task.WhenAll(tasks);

        var summary = new RunSummary
        {
            Processed = results.Sum(r => r.Processed),
            Failed = results.Sum(r => r.Failed),
            FailedLoanIds = results.SelectMany(r => r.FailedLoanIds).ToList(),
            CompletedOn = context.CurrentUtcDateTime
        };

        await context.CallActivityAsync(nameof(LoanActivities.SaveRunSummary), summary);
        log.LogInformation("Batch finished: {Processed} processed, {Failed} failed", summary.Processed, summary.Failed);
        return summary;
    }
}

public record BatchRequest(List<Guid> LoanIds, DateTime PostingDate);

public class BatchResult
{
    public int Processed { get; set; }
    public int Failed { get; set; }
    public List<Guid> FailedLoanIds { get; set; } = new();
}

public class RunSummary
{
    public int Processed { get; set; }
    public int Failed { get; set; }
    public List<Guid> FailedLoanIds { get; set; } = new();
    public DateTime CompletedOn { get; set; }
}
```

### The activity: one batch, safe to retry

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Microsoft.PowerPlatform.Dataverse.Client;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;

public class LoanActivities(ServiceClient dataverse, ILogger<LoanActivities> log)
{
    [Function(nameof(ProcessBatch))]
    public async Task<BatchResult> ProcessBatch([ActivityTrigger] BatchRequest request)
    {
        var result = new BatchResult();
        var batch = new ExecuteMultipleRequest
        {
            Requests = new OrganizationRequestCollection(),
            Settings = new ExecuteMultipleSettings { ContinueOnError = true, ReturnResponses = true }
        };

        foreach (Guid loanId in request.LoanIds)
        {
            decimal interest = CalculateDailyInterest(loanId);
            string postingKey = $"{loanId:N}-{request.PostingDate:yyyyMMdd}";

            // Upsert on an alternate key: a retry updates the same entry instead of adding a second one
            var entry = new Entity("lh_ledgerentry", "lh_postingkey", postingKey)
            {
                ["lh_loanaccountid"] = new EntityReference("lh_loanaccount", loanId),
                ["lh_amount"] = new Money(interest),
                ["lh_postingdate"] = request.PostingDate
            };
            batch.Requests.Add(new UpsertRequest { Target = entry });

            var loan = new Entity("lh_loanaccount", loanId)
            {
                ["lh_lastaccrualdate"] = request.PostingDate
            };
            batch.Requests.Add(new UpdateRequest { Target = loan });
        }

        var response = (ExecuteMultipleResponse)await dataverse.ExecuteAsync(batch);

        foreach (var item in response.Responses.Where(r => r.Fault is not null))
        {
            // Each loan adds 2 requests, so the loan's position is RequestIndex / 2
            Guid failedLoan = request.LoanIds[item.RequestIndex / 2];
            if (!result.FailedLoanIds.Contains(failedLoan)) result.FailedLoanIds.Add(failedLoan);
            log.LogError("Loan {LoanId} failed: {Message}", failedLoan, item.Fault.Message);
        }

        result.Failed = result.FailedLoanIds.Count;
        result.Processed = request.LoanIds.Count;
        return result;
    }

    private static decimal CalculateDailyInterest(Guid loanId) => 12.50m; // your real calculation here
}
```

The loan update sets the last accrual date rather than adding to a running total, so running it twice gives the same result. Keep running totals as a rollup or a calculation from the ledger entries, not as "old value plus today".

## Comparing the options

![Comparing the options for a nightly batch](/images/azure-part3-6.webp)

What if the batch must start from a live Dataverse event instead of a timer, without making users wait? Then Dataverse and the compute need a queue between them. That is Part 4.

## Day 2: what breaks after go-live

These are the problems teams hit most often once a Durable Functions job is live, and how to fix each one.

**1. A code change breaks jobs that are already running.**
You deploy a new version of the orchestrator while last night's job is still running. When it replays, the history no longer matches the code, and the job fails with a non-deterministic error.
**How to fix it:** never change an orchestrator's steps in place while instances are running. Either wait until nothing is running, or deploy the change under a new orchestrator name and let the old one finish.

**2. The job runs twice on the same night.**
The timer fires again after a restart, or someone starts the job manually while it is already running. Two runs process the same 250,000 loans.
**How to fix it:** start the orchestration with a fixed instance ID (for example `loan-batch-2026-11-26`). Before starting, check whether that instance is already running.

**3. Test and production share one task hub.**
Two Function apps use the same storage account and the same task hub name. They pick up each other's work.
**How to fix it:** give every environment its own task hub name, and ideally its own storage.

**4. Storage keeps growing.**
Every run writes history. After months, the history tables are huge and slow.
**How to fix it:** purge the history of completed and failed instances on a schedule, for example everything older than 30 days.

**5. Fan-out causes 429s from Dataverse.**
500 activities start at once and all call Dataverse together.
**How to fix it:** limit concurrent activities in `host.json`, use batches of a few hundred records, and use one shared ServiceClient.

**6. A job looks "stuck".**
It shows Running for hours. Usually one activity is waiting on a slow call or retrying forever.
**How to fix it:** give every activity a retry policy with a maximum number of attempts and a timeout. Check the instance status with the Durable Functions monitor, and terminate and rerun only the failed part.

**7. The code is on an unsupported version.**
Microsoft ended support for the in-process model and for .NET 8 on 10 November 2026. Durable code written with `IDurableOrchestrationContext` is in-process code.
**How to fix it:** use the isolated worker model (`TaskOrchestrationContext`, `DurableTaskClient`) on .NET 10, as in the code above.

## Using AI with this part

**Good prompts:**

- *"Here is my orchestrator [paste]. List every line that is not deterministic and explain why it breaks on replay."* AI is good at spotting `DateTime.Now`, `Guid.NewGuid()` and direct HTTP calls inside orchestrators.
- *"Convert this in-process Durable Functions code to the isolated worker model on .NET 10."* It saves a lot of typing, but compile and test every line.
- *"Design a purge schedule for Durable Functions history: what to keep, for how long, and the code to run it."*

**Where AI gets it wrong:**

- It mixes the old in-process API and the new isolated API in the same file.
- It puts Dataverse calls directly in the orchestrator instead of in activities.
- It suggests fan-out with no limit on concurrency.
- Never paste real loan or customer data into an AI tool. Use test data from your developer environment.

## Interview questions

**1. Why Durable Functions instead of a normal Function or Power Automate for 250,000 records?**
A normal Function has a time limit and forgets its progress if it stops. Power Automate hits request limits and gets throttled. Durable Functions saves its progress and carries on after a restart.

**2. Explain fan-out and fan-in.**
Split the records into batches, start an activity per batch in parallel (fan-out), then wait for all of them and combine the results (fan-in).

**3. Why must orchestrator code be deterministic, and what breaks it?**
The orchestrator replays from the top using its history, so it must take the same path every time. `DateTime.UtcNow`, `Guid.NewGuid()` and direct calls to other systems break this.

**4. How do you stop 500 parallel batches from overwhelming Dataverse?**
Limit concurrent activities with `maxConcurrentActivityFunctions` in `host.json`, use one shared ServiceClient, batch writes with ExecuteMultiple, and use retry policies with growing delays.

**5. How does Durable Functions know where it stopped after a server restart?**
It keeps a history of every step in its task hub in Azure Storage, and replays it to rebuild its state.

**6. An activity was retried. How do you make sure no loan is charged twice?**
Give each posting a business key (loan plus date) as an alternate key and use Upsert, and set values instead of adding to them.

## Checklist

- [ ] Fixed instance ID per run, checked before starting
- [ ] No `DateTime.UtcNow`, `Guid.NewGuid()` or I/O inside the orchestrator
- [ ] Batches sized under the ExecuteMultiple limit of 1,000 requests
- [ ] `maxConcurrentActivityFunctions` set and tested for 429s
- [ ] One singleton ServiceClient
- [ ] Every write safe to retry (alternate key and Upsert, set values instead of adding)
- [ ] Retry policy with a maximum number of attempts
- [ ] Own task hub name per environment
- [ ] History purged on a schedule
- [ ] Run summary written to Dataverse, with the failed loan IDs

## Simple rule to remember

**Durable Functions remembers where it stopped. Your code must make sure doing a step twice changes nothing.**

Next in the series: [Part 4, webhooks vs Service Bus for Dataverse events](/posts/azure-functions-dynamics-365/04-webhooks-vs-service-bus/).

**📚 The full series: Azure Functions with Dynamics 365**

- [Part 1: Beginner tutorial (webhooks, Service Bus, Logic Apps)](/posts/azure-functions-dynamics-365/01-beginner-tutorial/)
- [Part 2: Surviving high-volume integrations](/posts/azure-functions-dynamics-365/02-high-volume-integrations/)
- [Part 3: Heavy Dataverse workloads with Durable Functions](/posts/azure-functions-dynamics-365/03-durable-functions/) (you are here)
- [Part 4: Webhooks vs Service Bus for Dataverse events](/posts/azure-functions-dynamics-365/04-webhooks-vs-service-bus/)
- [Part 5: Retries, dead-letter queues and duplicates](/posts/azure-functions-dynamics-365/05-retries-dead-letter-queues/)
- Part 6: Securing the integration (coming next)
