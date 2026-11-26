---
title: "Surviving High-Volume Dataverse Integrations"
description: "What happens when 10,000 loan records hit your Dynamics 365 to Azure Function integration at once, and the three code fixes plus one design rule that keep it alive."
series: azure-functions-dynamics-365
part: 2
pubDate: 2026-09-14
cover: /covers/azure-part2.webp
tags: [Azure Functions, Dataverse, Dynamics 365]
linkedin: "https://www.linkedin.com/pulse/part-2-azure-functions-dynamics-365-dataversecrm-karthik-ithakota-pxryf/"
---

*📚 This is Part 2 of my series "Azure Functions with Dynamics 365". New here? Start with* [*Part 1: Beginner tutorial (webhooks, Service Bus, Logic Apps)*](/posts/azure-functions-dynamics-365/01-beginner-tutorial/)*.*

*Updated November 2026: rewritten in simpler English, code moved to the isolated worker model on .NET 10, and new sections on what breaks after go-live and on using AI.*

## The story

LoanHub's integration looks simple on paper:

1. A loan officer creates a loan application in Dynamics 365.
2. Dataverse sends an asynchronous webhook to an Azure Function.
3. The Function asks a credit bureau for a score.
4. The Function writes the score back to the loan.

With 5 or 50 loans an hour, this works well.

Then the business imports **10,000 old loan applications** in one go.

Dataverse treats every imported row as a new Create. Unless someone turned the webhook step off, Dataverse sends 10,000 webhooks within minutes. Three things go wrong at once:

- **The Function is flooded.** Azure starts many copies of it, and they all open new network connections.
- **The credit bureau is flooded.** It gets 10,000 calls almost at once, starts rate-limiting you, or falls over.
- **Dataverse is flooded.** 10,000 score updates arrive together and hit the service protection limits. Dataverse starts answering **429 Too Many Requests**.

This part shows the three code fixes that keep the Function alive, and the one design rule that stops the flood in the first place.

## "Why not just use Azure Data Factory or SSIS?"

People who work on data migrations often ask this. The short answer: **use batch tools for moving data, and event tools for reacting to events.**

- **ADF and SSIS** are built for scheduled bulk moves, like copying a table every night. They can't receive a webhook from Dataverse on their own.
- **Calling an external API for every row** from an ADF loop turns a data pipeline into a slow, hard-to-support script.
- **Writing 10,000 rows back without handling 429** gives the same throttling problem.

Simple rule:

- **ADF or SSIS:** bulk data migration, from A to B.
- **Azure Functions with webhooks or Service Bus:** reacting to a CRM event and calling another system.

## Why not a plugin or Power Automate?

- **A plugin** runs inside Dataverse's sandbox and has a **2-minute limit**. A slow credit bureau under load makes it time out, and synchronous plugins make the user wait.
- **Power Automate** can handle it, but 10,000 flow runs at once use up your request limits quickly and get throttled.

An Azure Function keeps the slow work outside Dynamics. But only if the code handles three traps.

## The three code traps

1. **Reading the payload wrong.** Dataverse doesn't send a simple JSON object. It sends the full execution context.
2. **Running out of connections.** Creating a new `HttpClient` for every call uses up the machine's outbound connections under load.
3. **Ignoring 429.** When Dataverse says "slow down", code that retries at once makes it worse.

> **Timeout warning:** Dataverse gives a webhook **60 seconds** to answer. If the credit bureau sometimes takes longer, a direct webhook will fail. For slow systems, put a queue in the middle. That is Part 4.

## The code

This uses the **isolated worker model on .NET 10**, with the Dataverse SDK package `Microsoft.PowerPlatform.Dataverse.Client`.

**Program.cs: create shared clients once**

```csharp
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.PowerPlatform.Dataverse.Client;

var builder = FunctionsApplication.CreateBuilder(args);

// One HttpClient setup for the bureau, reused for every call
builder.Services.AddHttpClient("bureau", c =>
{
    c.BaseAddress = new Uri(Environment.GetEnvironmentVariable("BureauUrl")!);
    c.Timeout = TimeSpan.FromSeconds(20);
});

// One Dataverse client for the whole app
builder.Services.AddSingleton(_ =>
    new ServiceClient(Environment.GetEnvironmentVariable("DataverseConnection")));

builder.Build().Run();
```

**CreditCheck.cs: the Function**

```csharp
using System.Net;
using System.Runtime.Serialization.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Microsoft.PowerPlatform.Dataverse.Client;
using Microsoft.Xrm.Sdk;

public class CreditCheck(IHttpClientFactory httpFactory, ServiceClient dataverse, ILogger<CreditCheck> log)
{
    [Function("CreditCheck")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData req)
    {
        // Trap 1: read the execution context with the SDK's own type
        using var body = new MemoryStream();
        await req.Body.CopyToAsync(body);
        body.Position = 0;
        var serializer = new DataContractJsonSerializer(typeof(RemoteExecutionContext));
        var context = (RemoteExecutionContext)serializer.ReadObject(body)!;
        Guid loanId = context.PrimaryEntityId;

        // Trap 2: use the shared HttpClient, never "new HttpClient()" here
        var bureau = httpFactory.CreateClient("bureau");
        var response = await bureau.GetAsync($"scores/{loanId}");
        response.EnsureSuccessStatusCode();
        int score = int.Parse(await response.Content.ReadAsStringAsync());

        // Trap 3: ServiceClient waits and retries when Dataverse answers 429
        var update = new Entity("lh_loanapplication", loanId) { ["lh_creditscore"] = score };
        await dataverse.UpdateAsync(update);

        log.LogInformation("Loan {LoanId} scored {Score}", loanId, score);
        return req.CreateResponse(HttpStatusCode.OK);
    }
}
```

## How the code avoids each trap

### Trap 1: read the payload with the SDK type

Dataverse sends the whole execution context: the message name, the user, depth, input parameters, images and more. If you dig into it by hand with string paths, one missing property can throw a `NullReferenceException`.

Reading it into `RemoteExecutionContext` from the Dataverse SDK gives you typed properties like `PrimaryEntityId` and `InputParameters`. If you prefer not to use the SDK type, Part 1 shows a small helper that reads the JSON safely.

### Trap 2: one shared HttpClient

`new HttpClient()` inside the Function opens new connections on every call. With a few calls that's fine. With thousands at once, the machine runs out of outbound connections and calls start failing.

Registering the client once with `AddHttpClient` and asking for it with `IHttpClientFactory` reuses connections safely. Create the `ServiceClient` once too, for the same reason.

### Trap 3: respect "429 Too Many Requests"

Dataverse protects itself with **service protection limits**. When you send too much too fast, it answers 429 and includes a **Retry-After** header that says how long to wait.

`ServiceClient` already waits and retries for you. If you call the Web API with your own `HttpClient`, do it yourself:

```csharp
if (response.StatusCode == (HttpStatusCode)429)
{
    var wait = response.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(5);
    await Task.Delay(wait);
    // then try again, with a maximum number of tries
}
```

Retrying at once, without waiting, makes the spike bigger and keeps you blocked for longer.

## The design rule that matters more than the code

The code above survives the flood. But ask the real question first: **why were live webhooks firing for 10,000 old loans at all?**

Old loans don't need a fresh credit check. Sending them through a real-time integration is a design mistake, and no amount of good C# fixes that.

> **Rule:** before a data migration, turn off the integration steps (or make them skip imported rows), load the data, then turn them back on. Keep real-time webhooks for real, live user actions.

## What if the credit bureau goes down?

Even with the import handled, one more problem remains. What if the bureau is down for 2 hours while officers keep creating loans?

A direct webhook can't wait 2 hours. Calls fail, and you have to find and resend them by hand. The fix is to **put a queue between Dataverse and the Function**, so messages wait safely until the bureau is back. Parts 4 and 5 cover this.

## Day 2: what breaks after go-live

These are the problems teams hit most often once a high-volume integration is live, and how to fix each one.

**1. A bulk import fires the live integration 10,000 times.**
Someone imports historical loans. Every row fires the webhook, and the credit bureau gets 10,000 real calls it should never have seen.
**How to fix it:** before any bulk load, turn off the step, or add a column such as "Imported" and make the step skip those rows. Put this in the import checklist so nobody has to remember it.

**2. Other background jobs slow down after a big import.**
Every asynchronous webhook call is a system job. 10,000 imports mean 10,000 extra jobs in the same background queue that workflows and other plugins use.
**How to fix it:** set filtering attributes so only real changes fire, and load big data in smaller batches outside business hours.

**3. Dataverse answers 429 Too Many Requests.**
Azure scales the Function out to many copies, and together they call Dataverse faster than the service protection limits allow.
**How to fix it:** read the `Retry-After` header and wait that long (the Dataverse ServiceClient does this for you). Also limit how many copies run at once, for example with Service Bus concurrency settings or a maximum instance count on the Function app.

**4. The Function starts failing with socket errors under load.**
The code creates a new `HttpClient` for every call. Under load, the machine runs out of outbound connections.
**How to fix it:** create one `HttpClient` and reuse it (`static readonly` or `IHttpClientFactory`). Do the same with the Dataverse ServiceClient.

**5. The same loan is processed twice.**
A timeout makes the caller retry, but the first call actually finished.
**How to fix it:** make the Function safe to run twice. Check whether the work is already done (for example, the score already exists) before doing it again. Part 5 covers this in detail.

**6. The Application Insights bill jumps.**
At high volume, every log line costs money.
**How to fix it:** turn on sampling, log one line per record instead of ten, and never log full payloads with customer data.

**7. The code is on an unsupported version.**
Microsoft ended support for the in-process model and for .NET 8 on 10 November 2026.
**How to fix it:** run on the isolated worker model with .NET 10.

## Using AI with this part

**Good prompts:**

- *"Write a KQL query for Application Insights that shows 429 responses from Dataverse per minute over the last 24 hours."* AI is very good at KQL, and this is the first query you need on a bad day.
- *"Here is my Function code [paste]. Find anything that will break under 10,000 calls an hour: new clients per call, missing retries, blocking calls, logging of personal data."*
- *"Generate a load-test plan for this webhook: 100, 1,000 and 10,000 records, what to measure, and when to stop the test."*

**Where AI gets it wrong:**

- It often suggests `Parallel.ForEach` with no limit. That is exactly how you hit 429s.
- It writes retry loops that wait a fixed time and ignore `Retry-After`.
- It creates a new `HttpClient` inside the method.
- Never paste real loan or customer data into an AI tool. Use test data from your developer environment.

## Interview questions

**1. Why use an Azure Function instead of a plugin for a slow external API?**
A plugin runs in the sandbox with a 2-minute limit, and a synchronous plugin makes the user wait. A Function runs outside Dynamics and can scale.

**2. "We already have Azure Data Factory. Why can't it handle Dataverse events?"**
ADF is for scheduled bulk data movement. It can't receive a webhook by itself, and calling an API per row from a pipeline is slow and hard to support.

**3. How should your code handle a 429 from Dataverse?**
Read the Retry-After header, wait that long, then try again, with a limit on the number of tries. `ServiceClient` does this for you.

**4. Why does `new HttpClient()` inside a Function cause failures under load?**
Each call opens new connections, and under heavy load the machine runs out of outbound connections. Use one shared client through `IHttpClientFactory`.

**5. Dataverse gives a webhook 60 seconds. The bureau sometimes takes 90. What do you change?**
Put Azure Service Bus between Dataverse and the Function, so the Function can take as long as it needs and retry safely.

**6. You are loading 1 million historical records. How do you stop live integrations from firing?**
Turn the integration steps off during the load, or make them skip imported rows, and turn them back on afterwards. Check the plan with the business before you start.

**7. How do you secure the Function's HTTP endpoint?**
Use a function key in a header, store secrets in Key Vault, and limit network access where you can. Part 6 covers managed identity.

**8. How do you stop duplicate processing when the same event arrives twice?**
Make the Function idempotent: check whether the work is already done (for example, the score already exists) before doing it again.

**9. How do you trace one failed loan from Dataverse to the bureau?**
Log the record ID and a correlation ID on every line in Application Insights, and match them with the Dataverse system job.

## Checklist

- [ ] Integration steps turned off (or skipping imported rows) during data migrations
- [ ] Payload read with `RemoteExecutionContext` or a safe helper
- [ ] One shared `HttpClient` and one `ServiceClient`
- [ ] 429 handled with Retry-After and a retry limit
- [ ] Timeout on every outbound call
- [ ] Idempotent processing
- [ ] A queue in the middle if the receiving system can be slow or down
- [ ] Isolated worker model, .NET 10

## Simple rule to remember

**Batch tools move data. Event tools react to events.** And before any big load, ask what your live integrations will do with it.

Next in the series: [Part 3, processing heavy Dataverse workloads with Durable Functions](/posts/azure-functions-dynamics-365/03-durable-functions/).

**📚 The full series: Azure Functions with Dynamics 365**

- [Part 1: Beginner tutorial (webhooks, Service Bus, Logic Apps)](/posts/azure-functions-dynamics-365/01-beginner-tutorial/)
- [Part 2: Surviving high-volume integrations](/posts/azure-functions-dynamics-365/02-high-volume-integrations/) (you are here)
- [Part 3: Heavy Dataverse workloads with Durable Functions](/posts/azure-functions-dynamics-365/03-durable-functions/)
- [Part 4: Webhooks vs Service Bus for Dataverse events](/posts/azure-functions-dynamics-365/04-webhooks-vs-service-bus/)
- [Part 5: Retries, dead-letter queues and duplicates](/posts/azure-functions-dynamics-365/05-retries-dead-letter-queues/)
- Part 6: Securing the integration (coming next)
