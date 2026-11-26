---
title: "Webhooks vs Service Bus for Dataverse Events"
description: "In Part 3, Durable Functions processed 250,000 Dataverse records without timing out. But every one of those designs starts with the same question: how does Azure even know that something changed…"
series: azure-functions-dynamics-365
part: 4
pubDate: 2026-11-18
cover: /covers/azure-part4.webp
tags: [Azure Functions, Dataverse, Dynamics 365]
linkedin: "https://www.linkedin.com/pulse/part-4-getting-events-out-dataverse-webhooks-vs-service-ithakota-ty0uf/"
---

*📚 This is Part 4 of my series "Azure Functions with Dynamics 365". New here? Start with* [*Part 1*](/posts/azure-functions-dynamics-365/01-beginner-tutorial/)*, or read the previous one:* [*Part 3: Heavy Dataverse workloads with Durable Functions*](/posts/azure-functions-dynamics-365/03-durable-functions/)*.*

*Updated November 2026: new sections on what breaks after go-live (Day 2) and on using AI.*

### Why this part comes next

In Part 3, Durable Functions processed 250,000 Dataverse records without timing out. But every one of those designs starts with the same question: how does Azure even know that something changed in Dynamics 365?

This part answers that. Dataverse can push an event to Azure the moment a record is saved, in two ways: a **webhook** or a **Service Bus endpoint**. Choosing the wrong one is behind many "the integration worked in testing" stories.

### The scenario: an instant credit check

A bank manages loan applications in Dynamics 365, in a custom table called Loan Application (new_loanapplication). About 400 applications are created on a normal day, and up to 8,000 when the marketing team runs a bulk import from a campaign.

The business wants a credit score on every new application within seconds, without anyone clicking a button.

### Why polling fails

The first idea is usually a scheduled job that asks Dataverse "any new applications?" every 15 minutes.

- **It is late.** A loan officer can wait up to 15 minutes for a score.
- **It wastes calls.** 96 runs a day, and most of them find nothing.
- **It struggles with spikes.** On bulk import days, one run suddenly picks up thousands of records at once.

**Polling:** a job asks for new records every 15 minutes. Up to 15 minutes late, many wasted calls. **Push (webhook or Service Bus):** Dataverse sends the event the moment the record is saved. Seconds, no wasted calls.

The fix is to let Dataverse push the event to us. A real-life comparison: you don't phone the restaurant every 2 minutes to ask if your biryani is ready. The delivery app notifies you when the order is picked up. That notification is a push.

### Two ways Dataverse pushes an event

Both options are built into Dataverse and registered with the same tool (the Plugin Registration Tool). Both send the same data: the **RemoteExecutionContext**, the same context a plugin receives.

- **Webhook.** Dataverse calls an HTTP URL you own, usually an Azure Function with an HTTP trigger. Simple and direct.
- **Service Bus endpoint.** Dataverse posts the context as a message to an Azure Service Bus queue or topic. Your Azure Function reads from the queue at its own pace.

A webhook is like a phone call: the other side must pick up now. A Service Bus endpoint is like a letterbox: the letter waits until someone collects it.

![Webhook vs Service Bus when the Function is down](/images/azure-part4-down.png)

### What happens when a loan application is saved

1.  A loan officer saves a new Loan Application.
2.  Dataverse finds a registered **step** for Create on new_loanapplication.
3.  For an asynchronous step, Dataverse creates a background **system job**. The user's save finishes immediately.
4.  The job sends the context out: as an HTTP POST to the webhook URL, or as a message on the Service Bus queue.
5.  The Azure Function runs. It calls the credit bureau and writes the score back through the Dataverse Web API.
6.  The officer refreshes the form and sees the score.

In **synchronous** mode, step 3 is skipped. Dataverse calls the endpoint straight away and the user's save waits for the reply. Any response other than 2xx counts as a failure.

### Why an Azure Function and not a plugin?

Plugins run inside the Dataverse sandbox, with a 2-minute limit and restricted network access. The credit bureau call needs secrets from Key Vault, external libraries and retry logic. All of that is easier and safer in an Azure Function.

### Hands-on 1: a webhook calling an Azure Function

**What you need:** an Azure subscription, a Dynamics 365 / Dataverse environment where you are System Administrator, Visual Studio or VS Code with the Azure Functions tools, and the Plugin Registration Tool (open it with "pac tool prt" from the Power Platform CLI).

### Step 1: Create the Azure Function

Create an Azure Functions project (.NET isolated worker) with an HTTP trigger and authorization level **Function**. Replace the function with this code:

```csharp
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

public class LoanCreditCheck
{
    private readonly ILogger<LoanCreditCheck> _logger;
    public LoanCreditCheck(ILogger<LoanCreditCheck> logger) => _logger = logger;

    [Function("LoanCreditCheck")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequest req)
    {
        // 1. Read the payload Dataverse sent
        string body = await new StreamReader(req.Body).ReadToEndAsync();
        using JsonDocument doc = JsonDocument.Parse(body);
        JsonElement ctx = doc.RootElement;

        // 2. Basic facts about the event
        string message  = ctx.GetProperty("MessageName").GetString();       // e.g. Create
        string table    = ctx.GetProperty("PrimaryEntityName").GetString(); // e.g. new_loanapplication
        string recordId = ctx.GetProperty("PrimaryEntityId").GetString();
        _logger.LogInformation("{Message} on {Table} {Id}", message, table, recordId);

        // 3. TODO: call the credit bureau API and update the record
        //    using the Dataverse Web API (ServiceClient + app registration)

        // 4. Return 200 so Dataverse knows it worked
        return new OkResult();
    }
}
```csharp

Publish it to Azure. In the portal, open the function, choose **Get function URL**, and copy two things: the URL without the ?code= part, and the function key.

### Step 2: Register the webhook

1.  Open the Plugin Registration Tool and connect to your environment.
2.  Choose **Register → Register New Web Hook**.
3.  Name = LoanCreditCheckHook. Endpoint URL = the function URL **without** ?code=.
4.  Authentication = **WebhookKey**, Value = the function key. Dataverse adds it as ?code=\<key\> on every call.
5.  Save.

### Step 3: Register a step (when should it fire?)

The webhook alone does nothing. A step tells Dataverse which event triggers it.

1.  Right-click the webhook → **Register New Step**.
2.  Message = **Create**, Primary Entity = new_loanapplication.
3.  Event Pipeline Stage = **PostOperation** (the record is already saved).
4.  Execution Mode = **Asynchronous** (the user does not wait).
5.  Register the step.

### Step 4: Test it

1.  Create a new Loan Application in Dynamics 365.
2.  In Azure, open the function's Log stream or Application Insights. You should see "Create on new_loanapplication \<id\>".
3.  If nothing arrives, go to **Settings → System Jobs** in Dynamics 365 and look for a failed job with the error message.

### Hands-on 2: the same event through Service Bus

Now the bulk-import day. 8,000 applications arrive in an hour, and the credit bureau allows only a few calls per second. A webhook would hit the Function 8,000 times as fast as Dataverse can send them. With Service Bus, the messages wait in a queue and the Function works through them at a safe pace.

### Step 1: Create the queue

1.  In the Azure portal, create a Service Bus namespace (Standard tier) and a queue called loan-events.
2.  Under the namespace, open **Shared access policies** and create a policy with **Send** rights for Dataverse. Copy its connection string.
3.  Create a second policy with **Listen** rights for the Azure Function.

### Step 2: Register the Service Bus endpoint

1.  In the Plugin Registration Tool, choose **Register → Register New Service Endpoint**.
2.  Paste the Send connection string.
3.  Designation Type = **Queue**, Queue name = loan-events.
4.  Message Format = **JSON**, so the Function can read it easily.
5.  Save, then register a step on the endpoint exactly as before: Create, new_loanapplication, PostOperation, Asynchronous.

### Step 3: The Service Bus-triggered Function

```csharp
using System.Text.Json;
using Azure.Messaging.ServiceBus;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

public class LoanEventProcessor
{
    private readonly ILogger<LoanEventProcessor> _logger;
    public LoanEventProcessor(ILogger<LoanEventProcessor> logger) => _logger = logger;

    [Function("LoanEventProcessor")]
    public async Task Run(
        [ServiceBusTrigger("loan-events", Connection = "ServiceBusConnection")]
        ServiceBusReceivedMessage message)
    {
        // 1. The body is the RemoteExecutionContext in JSON
        using JsonDocument doc = JsonDocument.Parse(message.Body.ToString());
        string recordId = doc.RootElement.GetProperty("PrimaryEntityId").GetString();
        _logger.LogInformation("Message {MessageId} for loan {RecordId}", message.MessageId, recordId);

        // 2. TODO: skip if this loan already has a score (safe to run twice)
        // 3. TODO: call the credit bureau and write the score back via the Web API

        // If this method throws, Service Bus delivers the message again.
        // After the queue's max delivery count, it moves to the dead-letter queue.
        await Task.CompletedTask;
    }
}
```

Put the Listen connection string in the app setting ServiceBusConnection, or better, use a managed identity with the **Azure Service Bus Data Receiver** role so there is no secret at all.

To protect the credit bureau, limit how many messages the Function handles at once with maxConcurrentCalls under the Service Bus settings in host.json.

### How to decide: four questions

The registration is the easy part. Before I register anything, I ask four questions.

1.  **Must the user wait?** If the result must block a bad save, use synchronous. Everything else (scoring, notifications, syncing) should be asynchronous. A slow credit bureau should never block a loan officer.
2.  **What if the receiver is down?** A webhook has no queue in between. A Service Bus endpoint keeps the message safe until the Function is back.
3.  **How much volume?** A few events an hour: a webhook is simple and enough. Thousands in a burst, or a slow downstream API: Service Bus, so the Function works at its own pace.
4.  **What if it arrives twice?** Both options deliver "at least once". Retries can send the same event again, so the Function must be safe to run twice (idempotent).

### Synchronous vs asynchronous

- **User waits?** Synchronous: yes, the save waits for your endpoint. Asynchronous: no, it runs in the background.
- **If the call fails:** Synchronous: the save fails and is rolled back; the user sees an error. Asynchronous: a failed system job is logged; the record stays saved.
- **Retries:** Synchronous: none; the user must try again. Asynchronous: Dataverse retries the system job.
- **Use it for:** Synchronous: validation that must block a bad save. Asynchronous: scoring, notifications, syncing to other systems.

### Webhook authentication options

When you register a webhook, you choose how Dataverse proves it is allowed to call your URL:

- **WebhookKey** adds ?code=\<key\> to the URL. Made for Azure Functions keys.
- **HttpHeader** adds headers you define, such as an API key header.
- **HttpQueryString** adds query string parameters you define.

Never leave the Function at authorization level Anonymous in production.

### What the payload contains

The JSON is the RemoteExecutionContext. The properties you will use most:

- **MessageName:** Create, Update, Delete and so on
- **PrimaryEntityName and PrimaryEntityId:** which table and which record
- **InputParameters:** key/value pairs; the Target entry holds the record's columns
- **PreEntityImages and PostEntityImages:** the record before and after, if you registered images
- **UserId and InitiatingUserId:** who triggered it

Very large webhook payloads are trimmed, and a header tells you data was removed. Treat the event as a signal: when in doubt, read the full record from the Web API using PrimaryEntityId.

### Common mistakes

1.  **Pasting the full URL with ?code= into Endpoint URL.** Put the bare URL there and the key in the WebhookKey value, or the key is duplicated or exposed.
2.  **Registering the endpoint but forgetting the step.** Without a step, nothing ever fires.
3.  **Synchronous mode for slow work.** The user waits, and any timeout or error blocks their save.
4.  **Long work before replying to a webhook.** Return 200 quickly. For heavy work, put a message on a Service Bus queue and process it in a second Function.
5.  **Firing on every Update.** Set Filtering Attributes on the step so it fires only when the columns you care about change.
6.  **An infinite loop.** The Function updates the same record, which fires the event again. Filter on columns the Function never writes, or skip calls made by the integration user.
7.  **Not handling duplicates.** Make the logic safe to run twice, for example by checking whether a score already exists.
8.  **No logging.** Turn on Application Insights from day one, and watch the dead-letter queue as closely as production errors.

### Webhook, Service Bus, plugin or Power Automate?

- **Plugin** runs inside the Dataverse sandbox. Best for fast validation and logic close to the data. Watch out for the 2-minute limit and restricted network access.
- **Webhook** calls your own HTTP endpoint, e.g. an Azure Function. Best for real-time calls to code you control. Watch out: your endpoint must be up, and there is no queue in between.
- **Service Bus endpoint** posts to an Azure Service Bus queue or topic. Best for high volume, slow receivers and decoupled processing. Watch out: more setup, and it needs a consumer.
- **Power Automate** runs cloud flows. Best for low-code automation by makers. Watch out: it runs after the save, with licensing and throttling limits.

**Rule of thumb:** a direct, simple call to your own code, use a webhook. The receiver might be down or the volume is high, use Service Bus.

### Day 2: what breaks after go-live

The common mistakes above happen while you build. These happen later, once the integration has been live for a while.

**1. Failed webhook calls pile up and nobody notices.**
An asynchronous webhook that fails just shows "Failed" in System Jobs. Users don't see an error, so nobody looks.
**How to fix it:** create a view of failed system jobs for your webhook steps and check it every day. Better still, alert on failures from Application Insights on the Function side.

**2. A copied environment sends test data to production.**
Someone copies production to UAT. The webhook and Service Bus registrations are copied too, so they still point to the production Function and queue. Testers' fake loans reach the real credit bureau.
**How to fix it:** straight after every copy, change the endpoint URLs and keys or turn off the steps, before anyone logs in. Put this first in the environment-copy checklist.

**3. A deployment points UAT at the dev Function.**
Webhook and Service Bus registrations travel inside the solution with their URL. After import, UAT calls the dev Function.
**How to fix it:** update endpoint URLs and keys in every environment after import, as a fixed step in the release checklist.

**4. Everything stops after a key is rotated.**
The function key or the Service Bus key is changed in Azure, but the registration in Dataverse still has the old one. Every call fails with 401.
**How to fix it:** keep a list of where each key is used, and update both places in the same change. Part 6 shows how to reduce the number of secrets.

**5. Events arrive in the wrong order.**
An Update arrives before the Create was processed, or two quick updates arrive the other way round. Background jobs and queues don't promise order.
**How to fix it:** don't trust the message to be the latest state. Read the current record from Dataverse before acting, or use Service Bus sessions when order really matters.

**6. The code is on an unsupported version.**
Microsoft ended support for the in-process model and for .NET 8 on 10 November 2026.
**How to fix it:** run the Functions on the isolated worker model with .NET 10.

### Using AI with this part

**Good prompts:**

- *"Here is a real webhook payload from my developer environment [paste]. Write a C# helper that returns the Target columns, the message name and the record ID."*
- *"Write an environment-copy checklist for a Dataverse environment that has webhooks and Service Bus endpoints."*
- *"Compare webhook and Service Bus for this case: 2,000 loans a day, a credit bureau that is down every night from 1 to 3 AM. Which one, and why?"* Then check its answer against the four questions above.

**Where AI gets it wrong:**

- It assumes the webhook body is a flat record. It is the execution context.
- It writes a plugin to send to Service Bus. You don't need one: register a Service Bus endpoint and a step.
- It forgets filtering attributes, which leads to loops and too many calls.
- Never paste real loan or customer data, or real keys, into an AI tool.

### Interview questions

1.  **What is a Dataverse webhook, and how is it different from a plugin?** A webhook sends the execution context to an external URL. A plugin runs your .NET code inside Dataverse.
2.  **When would you choose a Service Bus endpoint over a webhook?** When the receiver may be down, volume comes in bursts, or the downstream API must be protected. The queue holds messages until they are processed.
3.  **What happens if a synchronous webhook fails?** The operation fails, the transaction is rolled back and the user sees an error.
4.  **Which authentication types can a webhook use?** WebhookKey, HttpHeader and HttpQueryString.
5.  **How do you avoid an infinite loop when the Function updates the same record?** Use filtering attributes, avoid writing those columns, or skip calls made by the integration user.
6.  **Why must the consumer be idempotent?** Both options deliver at least once, so retries can bring the same event twice.

### Conclusion

Webhooks and Service Bus endpoints let Dynamics 365 tell Azure about changes the moment they happen, with no polling. Register the endpoint, add a step, choose async for anything slow, secure it, and make the Function safe to run twice.

The choice comes down to one question: can the receiver keep up right now? If yes, a webhook is enough. If not, put Service Bus in between.

Next in the series: [Part 5, what happens after the message arrives: retries, dead-letter queues and duplicate handling](/posts/azure-functions-dynamics-365/05-retries-dead-letter-queues/).

**📚 The full series: Azure Functions with Dynamics 365**

- [Part 1: Beginner tutorial (webhooks, Service Bus, Logic Apps)](/posts/azure-functions-dynamics-365/01-beginner-tutorial/)
- [Part 2: Surviving high-volume integrations](/posts/azure-functions-dynamics-365/02-high-volume-integrations/)
- [Part 3: Heavy Dataverse workloads with Durable Functions](/posts/azure-functions-dynamics-365/03-durable-functions/)
- [Part 4: Webhooks vs Service Bus for Dataverse events](/posts/azure-functions-dynamics-365/04-webhooks-vs-service-bus/) (you are here)
- [Part 5: Retries, dead-letter queues and duplicates](/posts/azure-functions-dynamics-365/05-retries-dead-letter-queues/)
- Part 6: Securing the integration (coming next)
