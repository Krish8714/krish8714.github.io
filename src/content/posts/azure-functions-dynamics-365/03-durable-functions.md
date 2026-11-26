---
title: "Processing Heavy Dataverse Workloads with Durable Functions"
description: "Processing enterprise-scale batch workloads against Microsoft Dataverse exposes the architectural boundary between transactional business applications and distributed computing engines. When an…"
series: azure-functions-dynamics-365
part: 3
pubDate: 2026-09-22
cover: /covers/azure-part3.webp
tags: [Azure Functions, Dataverse, Dynamics 365]
linkedin: "https://www.linkedin.com/pulse/stateful-serverless-crm-processing-heavy-dataverse-durable-ithakota-hn3kf/"
---

*📚 This is Part 3 of my series "Azure Functions with Dynamics 365". New here? Start with* [*Part 1*](/posts/azure-functions-dynamics-365/01-beginner-tutorial/)*, or read the previous one:* [*Part 2: Surviving high-volume integrations*](/posts/azure-functions-dynamics-365/02-high-volume-integrations/)*.*

*Updated November 2026: new sections on what breaks after go-live (Day 2) and on using AI.*

Processing enterprise-scale batch workloads against Microsoft Dataverse exposes the architectural boundary between transactional business applications and distributed computing engines. When an enterprise platform must process hundreds of thousands of operational records within a fixed maintenance window, standard extension models fail.

This guide provides an end-to-end architectural blueprint for engineering high-scale, stateful, and fault-tolerant batch systems using Azure Durable Functions and the Durable Task Framework (DTFx) to orchestrate complex Dataverse transactions.

Consider a Tier-1 financial services system managing active consumer and commercial loan portfolios implemented on Microsoft Dataverse. Every day at 00:00 UTC, the core ledger engine processes the active loan portfolio:

- **Active Records:** 250,000 active loan agreements.
- **Per-Record Operations:**
- Retrieve active contract parameters (current principal balance, indexed interest rates, penalty rules, grace periods).
- Compute daily accrued interest using fractional day-count conventions
- Evaluate delinquent repayment schedules and calculate compound late penalties.
- Create an immutable double-entry financial ledger transaction in Dataverse (fin_ledgerentry).
- Update the parent loan account (fin_loanaccount) with accrued totals, roll-up balances, and timestamp metadata.

&nbsp;

- ***Service Level Agreement (SLA):***
- Total batch execution must terminate within a strict ***4-hour maintenance window*** (00:00 UTC to 04:00 UTC) prior to regional banking integrations.
- ***Core Non-Negotiable Constraint:*** ***Exactly-Once Processing.*** Under no condition may a network failure, machine restart, or runtime timeout cause an account to accrue double interest or generate duplicated ledger postings.
-  ***The Architecture of Failure: Why Standard CRM Patterns Collapse Under High-Volume Loads***
- Before designing a highly scalable system, a Solution Architect must first deeply understand exactly how and why systems break. When processing massive datasets—such as recalculating 250,000 active loan records at midnight—relying on standard Microsoft Power Platform or Dynamics 365 extensibility points will result in catastrophic system failure.
- Below is an engineering evaluation of why familiar primitives collapse at this scale.

![Article content](/images/azure-part3-1.webp)

**1.** ***The Synchronous Plugin: The 120-Second Sandbox Kill-Switch***

Many developers attempt to trigger a synchronous plugin on a batch update or a custom action.

***How it fails*:** Dynamics 365 plugins execute within an isolated, resource-constrained sandbox worker process (Microsoft.Crm.Sandbox.WorkerProcess.exe). Microsoft enforces a non-negotiable **120-second timeout limit** to protect the shared multi-tenant SQL Server cluster from runaway queries.

***The Infrastructure Reality*:** If your loop processes record number 4,200 and hits the 120-second mark, the Sandbox Host aggressively terminates the thread.

***The Collateral Damage*:** Because synchronous plugins run within the main database transaction, the SQL Server must roll back the entire execution. Rolling back 4,200 complex records causes massive database locking, blocking other users and external integrations from reading or writing to those tables while the rollback completes.

**2.** ***The Asynchronous Plugin: The AsyncOperationBase Black Hole***

Realizing synchronous plugins time out, developers often offload the workload to Asynchronous Plugins or classic Background Workflows, firing off 250,000 individual async jobs.

- ***How it fails*:** Every async job generated in Dataverse is written to the physical SQL database in the *AsyncOperationBase* table.
- ***The Infrastructure Reality*:** Dropping 250,000 jobs instantly into this table causes sudden, massive database bloat. The Dataverse Asynchronous Processing Service (which operates on a FIFO/priority queue) is suddenly overwhelmed.
- ***The Collateral Damage (Queue Starvation*):** The Async Service doesn't just run your custom code; it is the heartbeat of the CRM. It processes SLAs, email sending, cascade deletes, and system jobs. By flooding the queue with a batch calculation, you cause *Queue Starvation*. Emails stop sending, SLAs miss their targets, and the entire CRM system degrades to a crawl for business users while the queue churns for the next 14 hours.

**3.** ***Power Automate (Cloud Flows): API Exhaustion and 429 Throttling***

Power Automate is exceptional for business logic, but it is not an ETL (Extract, Transform, Load) or heavy-compute engine. Using an "Apply to each" loop for 250,000 records introduces severe API limitations.

- ***How it fails:*** Power Automate execution is strictly metered. Every action inside a loop counts against the tenant's Power Platform Request limits. If you have 4 actions inside a loop running 250,000 times, you immediately consume 1,000,000 API calls.
- ***The Infrastructure Reality*:** You will violently hit the **Service Protection API Limits**. Dataverse allows a maximum of 6,000 requests per 5-minute window per user. Once breached, Dataverse responds with an HTTP 429 Too Many Requests error.
- ***The Collateral Damage*:** The flow halts, goes into a forced suspension (Retry-After backoff), and what should be a 3-hour job stretches into a multi-day execution. Furthermore, massive loops in Power Automate consume immense workflow memory, often causing the flow execution to time out or crash silently after 30 days.

**4.** ***Stateless Azure Functions: The "Partial Commit" Nightmare***

To avoid CRM limits entirely, the logical next step is writing a custom Azure Function (on a standard Consumption plan) to pull the records and process them externally.

- ***How it fails*:** Standard Azure Functions are **stateless**. They have a hard maximum execution time of 5 to 10 minutes. If you process records sequentially, the Azure fabric will forcefully terminate the host container at the timeout mark.
- **The Infrastructure Reality:** Even if you upgrade to a Premium plan with unlimited execution time, you are at the mercy of the cloud. The underlying virtual machine might need a security patch, or the Azure Load Balancer might drop the connection after 230 seconds of idle network time. The server reboots, and the function dies instantly.
- **The Collateral Damage:** Because the function is stateless, it has total amnesia. If it crashes after processing 134,000 out of 250,000 accounts, **how do you resume the job safely?** If you just restart the function, you will double-charge interest on the first 134,000 accounts, corrupting your financial ledger. To prevent this, you would have to engineer incredibly complex, custom tracking tables and checkpoint logic within Dataverse itself—essentially reinventing the wheel.

**3. High-Throughput Serverless Architecture: The Fan-Out / Fan-In Topology**

- To achieve high throughput, strict determinism, and complete resilience against compute drops, the workload is decoupled into a **Durable Functions Fan-Out / Fan-In** pattern.

![Article content](/images/azure-part3-2.webp)

***Component Roles Across the Lifecycle***

***The Timer Client*:** Triggers at 00:00 UTC and invokes DurableTaskClient.ScheduleNewOrchestrationInstanceAsync() (the isolated worker version of the old StartNewAsync), passing batch run parameters.

***The Orchestrator*:** Calls a metadata activity to query Dataverse and fetch the primary keys of all 250,000 eligible accounts.

1.  Splits the 250,000 IDs into 500 discrete chunks containing 500 records each.
2.  Dispatches 500 parallel activity tasks via Task.WhenAll().

***The Activity Functions (Workers)*:**Each activity receives an isolated slice of 500 record IDs.

1.  Executes business math in-memory.
2.  Packages database updates into transactional payloads using the Dataverse SDK (ExecuteTransactionRequest or ExecuteMultipleRequest).
3.  Returns a structured processing summary to the orchestrator.
4.  ***The Aggregator (Fan-In)*:** The orchestrator resumes upon completion of all 500 activity tasks, aggregates execution metrics (total successes, throughput per minute, failed account arrays), and writes a consolidated run log into Dataverse.

***Under the Hood: The Durable Task Framework (DTFx) & Event Sourcing***

Durable Functions does not keep compute threads active in memory while waiting for sub-tasks to finish. Understanding this mechanism requires looking under the hood at the ***Durable Task Framework (DTFx)****.*

***The Task Hub***

- The orchestration state is isolated within a logical boundary called a **Task Hub**. In standard deployments, the Task Hub consists of storage resources managed by the runtime:
- ***Control Queues*:** Ordered queues used to deliver lifecycle messages to orchestrators.
- ***Work-Item Queues*:** Queues dedicated to dispatching tasks to Activity Functions. When an orchestrator calls an activity, it drops an execution payload onto a work-item queue.
- ***History Table*:** An Azure Table Storage instance storing the event-sourced log of every state transition that occurs inside the orchestration.

**The Event Sourcing & Replay Engine**

Durable Functions implements the **Event Sourcing Pattern**. State is not persisted as a mutated object; rather, every lifecycle action is appended to an append-only log.

![Article content](/images/azure-part3-3.webp)

**The Step-by-Step Replay Lifecycle**

1.  **Invocation:** The orchestrator starts running code from line 1.
2.  **Reaching an Await:** The orchestrator encounters an await for an Activity.
3.  **Yield and Dehydration:** The framework checks its execution history. On first run, the activity has not completed. A record is written to the History table (TaskScheduled), and the orchestrator runtime flushes its state, **terminates the execution thread**, and yields compute resources. You pay nothing while the activity executes.
4.  **Activity Completion:** The worker finishes and writes its result payload to storage. It puts an orchestration wake-up message onto the Control Queue.
5.  **The Replay (Hydration):**

- The orchestrator wakes up.
- It starts executing again from Line 1 of the function code.
- When it reaches the line calling the Activity, it consults the local history log.
- The log indicates that the Activity has already executed and contains the cached result list.
- The orchestrator skips re-executing the activity, instantly assigns the cached output to the variable, and proceeds to the next line of code.

**5. The Golden Constraint: Determinism in Orchestrators**

Because the Orchestrator function reconstructs its state by re-running its code from the beginning during every single replay, **the code path must be 100% deterministic**. If re-executing the code on a different server at a different millisecond takes a different branch, the event-sourcing graph desynchronizes.

![Article content](/images/azure-part3-4.webp)

- **System Time:** DateTime.UtcNow evaluates differently on every replay. context.CurrentUtcDateTime returns the timestamp recorded during the initial scheduling of that step.
- **Random Identifiers:** Guid.NewGuid() generates a different ID during a replay, causing foreign key mismatches. context.NewGuid() generates a deterministic GUID based on the orchestration instance ID and execution step count.
- **Direct I/O:** Network calls can fail or return different data on a replay. All Dataverse ServiceClient calls must be strictly isolated inside the Activity Functions.

**6.** ***Enterprise Integration with Dataverse: Concurrency, Throttling & SDK Optimizations***

- Fanning out hundreds of concurrent Activity Functions against a Microsoft Dataverse tenant requires fine-grained control to prevent crushing the Dataverse Web API.

**1.** ***Dataverse Service Protection Limits & HTTP 429*:**To protect shared multi-tenant infrastructure, Dataverse enforces Service Protection Limits (e.g., maximum 6,000 requests per 5-minute window, max 52 concurrent execution requests per web-server tier). Exceeding these triggers an HTTP status code 429 (Too Many Requests).

**2.** : To prevent the Fan-Out pattern from overwhelming Dataverse, global concurrency must be constrained inside the function app's configuration:

![Article content](/images/azure-part3-5.webp)

By locking maxConcurrentActivityFunctionEvaluations to 32, even if the orchestrator dispatches 500 tasks simultaneously, the runtime host will only lease and execute 32 activity work-items at any single instant.

***3. Connection Pooling and SNAT Port Exhaustion***

Creating a new ServiceClient instance inside every activity invocation will rapidly exhaust the underlying Azure App Service worker's outbound SNAT ports.

- ***Architecture Requirement*:** The Dataverse ServiceClient must be registered as a **Singleton** using standard Azure Functions Dependency Injection. This manages connection pooling across all concurrent Activity Function runs, eliminating socket leaks.

**7*. Production-Grade Implementation (C#)***

Below is a complete, enterprise-grade implementation demonstrating deterministic orchestration, activity batching, native backoff retries, and transactional Dataverse operations using the isolated worker model.

**1.** ***The Orchestrator Implementation***

```csharp
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.DurableTask;
using Microsoft.Extensions.Logging;

namespace FinTech.Lms.Orchestrations
{
    public static class LoanProcessingOrchestrator
    {
        [Function(nameof(RunLoanPortfolioOrchestrator))]
        public static async Task<BatchExecutionSummary> RunLoanPortfolioOrchestrator(
            [OrchestrationTrigger] TaskOrchestrationContext context)
        {
            ILogger logger = context.CreateReplaySafeLogger(nameof(LoanProcessingOrchestrator));
            logger.LogInformation("Orchestration started. Execution ID: {instanceId}", context.InstanceId);

            // Step 1: Query eligible loan IDs (Deterministic: All I/O offloaded to activity)
            var eligibleLoanIds = await context.CallActivityAsync<List<Guid>>(
                nameof(QueryEligibleLoanIdsActivity), 
                null);

            if (eligibleLoanIds == null || !eligibleLoanIds.Any())
            {
                logger.LogWarning("No eligible loan records found. Terminating orchestration.");
                return new BatchExecutionSummary { TotalProcessed = 0, SuccessCount = 0, FailureCount = 0 };
            }

            // Step 2: Partition dataset into balanced chunks of 500 records
            const int chunkSize = 500;
            var chunks = eligibleLoanIds
                .Select((id, index) => new { id, index })
                .GroupBy(x => x.index / chunkSize)
                .Select(g => g.Select(x => x.id).ToList())
                .ToList();

            // Configure resilient retry options for activities encountering Dataverse throttling
            var activityRetryOptions = TaskOptions.FromRetryPolicy(new TaskRetryPolicy(
                maxNumberOfAttempts: 5,
                firstRetryInterval: TimeSpan.FromSeconds(5),
                backoffCoefficient: 2.0,
                maxRetryInterval: TimeSpan.FromMinutes(2)));

            // Step 3: FAN-OUT. Dispatch parallel Activity tasks across workers
            var processingTasks = new List<Task<ChunkResult>>();
            for (int i = 0; i < chunks.Count; i++)
            {
                var payload = new ChunkProcessingRequest
                {
                    ChunkIndex = i + 1,
                    TotalChunks = chunks.Count,
                    LoanIds = chunks[i],
                    // Generate deterministic timestamp through context, NEVER DateTime.UtcNow
                    CalculationTimestamp = context.CurrentUtcDateTime
                };

                processingTasks.Add(context.CallActivityAsync<ChunkResult>(
                    nameof(ProcessLoanChunkActivity), 
                    payload, 
                    activityRetryOptions));
            }

            // Step 4: FAN-IN. Await completion of all concurrent activities
            ChunkResult[] results = await Task.WhenAll(processingTasks);

            // Step 5: Aggregate results
            var finalSummary = new BatchExecutionSummary
            {
                TotalProcessed = results.Sum(r => r.RecordsProcessed),
                SuccessCount = results.Sum(r => r.SuccessCount),
                FailureCount = results.Sum(r => r.FailedCount),
                FailedRecordIds = results.SelectMany(r => r.FailedIds).ToList(),
                CompletedAt = context.CurrentUtcDateTime
            };

            // Step 6: Persist audit log back into Dataverse via dedicated final activity
            await context.CallActivityAsync(nameof(PersistBatchRunSummaryActivity), finalSummary);

            return finalSummary;
        }
    }

    public class ChunkProcessingRequest
    {
        public int ChunkIndex { get; set; }
        public int TotalChunks { get; set; }
        public List<Guid> LoanIds { get; set; }
        public DateTime CalculationTimestamp { get; set; }
    }

    public class ChunkResult
    {
        public int RecordsProcessed { get; set; }
        public int SuccessCount { get; set; }
        public int FailedCount { get; set; }
        public List<Guid> FailedIds { get; set; } = new();
    }

    public class BatchExecutionSummary
    {
        public int TotalProcessed { get; set; }
        public int SuccessCount { get; set; }
        public int FailureCount { get; set; }
        public List<Guid> FailedRecordIds { get; set; } = new();
        public DateTime CompletedAt { get; set; }
    }
}
```

  

**2. The Activity Worker Implementation**

```csharp
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Microsoft.PowerPlatform.Dataverse.Client;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;

namespace FinTech.Lms.Orchestrations
{
    public class LoanActivities
    {
        private readonly ServiceClient _dataverseClient;
        private readonly ILogger<LoanActivities> _logger;

        // ServiceClient injected as Singleton via Dependency Injection
        public LoanActivities(ServiceClient dataverseClient, ILogger<LoanActivities> logger)
        {
            _dataverseClient = dataverseClient ?? throw new ArgumentNullException(nameof(dataverseClient));
            _logger = logger;
        }

        [Function(nameof(ProcessLoanChunkActivity))]
        public async Task<ChunkResult> ProcessLoanChunkActivity(
            [ActivityTrigger] ChunkProcessingRequest request)
        {
            var result = new ChunkResult();

            // Create batch execution request to minimize network roundtrips to Dataverse
            var multipleRequest = new ExecuteMultipleRequest
            {
                Requests = new OrganizationRequestCollection(),
                Settings = new ExecuteMultipleSettings
                {
                    ContinueOnError = true,
                    ReturnResponses = true
                }
            };

            foreach (var loanId in request.LoanIds)
            {
                // In-memory calculations (interest, late fees, balances)
                decimal dailyInterest = CalculateAccruedInterest(loanId);

                // 1. Prepare Ledger Entry Entity
                var ledgerEntry = new Entity("fin_ledgerentry")
                {
                    Attributes =
                    {
                        ["fin_loanaccountid"] = new EntityReference("fin_loanaccount", loanId),
                        ["fin_amount"] = new Money(dailyInterest),
                        ["fin_entrytype"] = new OptionSetValue(100000001), 
                        ["fin_transactiondate"] = request.CalculationTimestamp
                    }
                };

                // 2. Prepare Parent Account Update
                var accountUpdate = new Entity("fin_loanaccount", loanId)
                {
                    Attributes =
                    {
                        ["fin_lastinterestaccrualdate"] = request.CalculationTimestamp,
                        ["fin_accruedinterestbalance"] = new Money(dailyInterest) 
                    }
                };

                multipleRequest.Requests.Add(new CreateRequest { Target = ledgerEntry });
                multipleRequest.Requests.Add(new UpdateRequest { Target = accountUpdate });
            }

            // Execute batch against Dataverse Web API
            var response = (ExecuteMultipleResponse)await _dataverseClient.ExecuteAsync(multipleRequest);

            // Parse responses to collect individual operational failures
            foreach (var responseItem in response.Responses)
            {
                if (responseItem.Fault != null)
                {
                    result.FailedCount++;
                    _logger.LogError("Dataverse batch item fault: {message}", responseItem.Fault.Message);
                }
                else
                {
                    result.SuccessCount++;
                }
            }

            result.RecordsProcessed = request.LoanIds.Count;
            return result;
        }

        private decimal CalculateAccruedInterest(Guid loanId)
        {
            return 12.50m;
        }
    }
} 
```

**8. Summary Comparison: Traditional Approaches vs. Durable Functions**

To evaluate this architectural shift, review how the patterns behave under heavy enterprise load:

![Article content](/images/azure-part3-6.webp)

But what happens when you need to trigger this massive batch process not from a scheduled timer, but directly from a live Dataverse event without locking up the user interface? That requires fully decoupling the event producer from the compute engine entirely.

...And that brings us to the edge of our next architectural deep dive.

**💡 The Interview Spotlight (Core Questions & Hints)**

If you are interviewing for a Solution Architect or Senior Developer role on enterprise Dynamics 365 projects, expect deep-dive questions like these:

**Why would you choose Azure Durable Functions over a standard Azure Function or Power Automate for processing 250,000 Dataverse records?**

💡 *Hint:* Discuss standard Function timeouts (5-10 minutes), Power Automate API exhaustion (throttling), and the need for stateful compute to prevent partial failures and corrupt data.

**Explain the "Fan-Out / Fan-In" pattern in the context of a Dataverse integration.**

💡 *Hint:* Talk about breaking the large dataset into chunks, using Task.WhenAll to spawn parallel Activity Functions (Fan-Out), and aggregating the results safely once all workers complete (Fan-In).

**Why must an Orchestrator function be strictly deterministic, and what common C# methods violate this rule?**

💡 *Hint:* Explain the Event Sourcing replay mechanism. Mention why DateTime.UtcNow, Guid.NewGuid(), and direct HttpClient calls will corrupt the execution history.

**If you fan out 500 concurrent workers against Dataverse, how do you prevent an HTTP 429 (Service Protection Limit) meltdown?**

💡 *Hint:* Mention concurrency throttling via maxConcurrentActivityFunctionEvaluations in host.json, and the absolute necessity of using a Singleton ServiceClient to avoid SNAT port exhaustion.

**How does the Durable Task Framework remember where it left off if the underlying Azure server reboots midway through a 3-hour job?**

💡 *Hint:* Discuss the Task Hub, checkpointing to Azure Table Storage (History Table), and how the Orchestrator safely rehydrates its state without custom CRM tracking tables.

  

### Day 2: what breaks after go-live

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

### Using AI with this part

**Good prompts:**

- *"Here is my orchestrator [paste]. List every line that is not deterministic and explain why it breaks on replay."* AI is good at spotting `DateTime.Now`, `Guid.NewGuid()` and direct HTTP calls inside orchestrators.
- *"Convert this in-process Durable Functions code to the isolated worker model on .NET 10."* It saves a lot of typing, but compile and test every line.
- *"Design a purge schedule for Durable Functions history: what to keep, for how long, and the code to run it."*

**Where AI gets it wrong:**

- It mixes the old in-process API and the new isolated API in the same file.
- It puts Dataverse calls directly in the orchestrator instead of in activities.
- It suggests fan-out with no limit on concurrency.
- Never paste real loan or customer data into an AI tool. Use test data from your developer environment.

**Over to You: Share Your War Stories**

Great architecture is usually born from the ashes of a spectacular production crash.

Let's debate this in the trenches before the next architectural breakdown drops:

- Have you ever accidentally caused queue starvation in Dataverse by firing off too many asynchronous workflows or plugins during a bulk update?
- How are you currently handling massive batch operations, end-of-month calculations, or heavy data migrations in your CRM?

Drop your thoughts in the comments below! 👇 Hit 🔔 on my profile so you don't miss the next part.

\#Dynamics365 \#PowerPlatform \#AzureFunctions \#Dataverse \#SolutionArchitecture \#CSharp \#MicrosoftAzure#Dynamics365 \#PowerPlatform \#AzureFunctions \#Dataverse \#SolutionArchitecture \#CSharp \#MicrosoftAzure \#CloudArchitecture \#SoftwareEngineering \#CloudComputing \#EnterpriseArchitecture \#BackendDevelopment \#DotNet \#SystemDesign \#ApiIntegration \#CloudIntegration

Next in the series: [Part 4, getting events out of Dataverse: webhooks vs Service Bus](/posts/azure-functions-dynamics-365/04-webhooks-vs-service-bus/).

**📚 The full series: Azure Functions with Dynamics 365**

- [Part 1: Beginner tutorial (webhooks, Service Bus, Logic Apps)](/posts/azure-functions-dynamics-365/01-beginner-tutorial/)
- [Part 2: Surviving high-volume integrations](/posts/azure-functions-dynamics-365/02-high-volume-integrations/)
- [Part 3: Heavy Dataverse workloads with Durable Functions](/posts/azure-functions-dynamics-365/03-durable-functions/) (you are here)
- [Part 4: Webhooks vs Service Bus for Dataverse events](/posts/azure-functions-dynamics-365/04-webhooks-vs-service-bus/)
- [Part 5: Retries, dead-letter queues and duplicates](/posts/azure-functions-dynamics-365/05-retries-dead-letter-queues/)
- Part 6: Securing the integration (coming next)
