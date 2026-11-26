---
title: "Beginner Tutorial: Webhooks, Service Bus and Logic Apps"
description: "Three ways to run an Azure Function when something happens in Dynamics 365: a webhook, a Service Bus queue, or a Logic App. What each one is, when to use it, working C# code, and what breaks after go-live."
series: azure-functions-dynamics-365
part: 1
pubDate: 2025-05-05
cover: /covers/azure-part1.webp
tags: [Azure Functions, Dataverse, Dynamics 365, Webhooks, Service Bus, Logic Apps]
linkedin: "https://www.linkedin.com/pulse/azure-functions-dynamics-365-crm-dataverse-beginner-krishna-karthik-dakdc/"
---

*📚 This is Part 1 of my series "Azure Functions with Dynamics 365". It starts from zero. If you have never connected Dynamics 365 to Azure before, start here.*

*Updated November 2026: the code now uses the isolated worker model and .NET 10, and the article has new sections on what breaks after go-live, using AI, and interview questions.*

## The story

LoanHub is a small lending company. Its loan officers work in Dynamics 365.

When an officer saves a new loan application, three things must happen outside Dynamics:

1. The customer gets a welcome email.
2. The loan is sent to a credit bureau for a score.
3. The finance team's system gets a copy when the loan is approved.

None of this belongs inside Dynamics. The email service, the credit bureau and the finance system all live outside. So we need a small piece of code that runs **outside** Dynamics, **when** something happens **inside** Dynamics.

That is exactly what an Azure Function is for.

## What is an Azure Function, in simple words?

An Azure Function is a small piece of code that sleeps until something wakes it up. Then it runs, does one job, and goes back to sleep.

Think of a doorbell. Nothing happens until someone presses it. When they do, the bell rings. You don't pay for a doorbell that is always ringing. You only care that it rings when someone presses it.

- The thing that wakes the Function up is called a **trigger**. It can be a web request, a message in a queue, or a timer.
- You don't manage servers. Azure starts the code when needed and adds more copies when there is a lot of work.
- You write the code in C# (or other languages). This series uses C#.

## Three ways Dynamics 365 can wake up a Function

| Way | How it works | Good for | Watch out |
| --- | --- | --- | --- |
| **Webhook** | Dynamics calls the Function's web address directly when a record changes. | Fast, simple, one receiver. | If the Function is down, the call fails. |
| **Service Bus queue** | Dynamics drops a message in a queue. The Function picks it up. | Reliable delivery, big volumes, slow systems. | One more Azure service to set up and watch. |
| **Logic App (or Power Automate)** | A low-code workflow notices the change and calls the Function. | Teams that prefer drag-and-drop, extra steps like approvals. | Slower, and costs grow with volume. |

![Three ways Dynamics 365 can trigger an Azure Function](/images/azure-part1-three-ways.png)

The important point for beginners: **in the first two ways, no plugin code is needed.** You register them with the Plug-in Registration Tool, and Dynamics does the sending for you.

## Before you start

You need:

- A Dynamics 365 or Power Apps **developer environment** (free). Never practise on a client or company environment.
- An Azure subscription (a free trial is fine).
- Visual Studio 2022 or VS Code with the Azure Functions tools.
- The **Plug-in Registration Tool** (install it with `pac tool prt` from the Power Platform CLI).

Create a new Azure Functions project and choose the **.NET isolated worker** model on **.NET 10**. Older tutorials, including the first version of this article, used the "in-process" model. Microsoft ended support for the in-process model on 10 November 2026, so don't start anything new on it.

## The one thing every beginner gets wrong: what Dynamics actually sends

When Dynamics calls your Function, it does **not** send a simple object like this:

```json
{ "fullname": "Ravi Kumar", "emailaddress1": "ravi@example.com" }
```

It sends the full **execution context**. This is the same information a plugin sees: which message ran (Create, Update), which table, which user, and a list called `InputParameters`. The record itself sits inside that list, under the key `Target`, and its columns are a list of key/value pairs.

A shortened example:

```json
{
  "MessageName": "Create",
  "PrimaryEntityName": "lh_loanapplication",
  "PrimaryEntityId": "7f1c...e21",
  "Depth": 1,
  "InputParameters": [
    {
      "key": "Target",
      "value": {
        "LogicalName": "lh_loanapplication",
        "Attributes": [
          { "key": "lh_name", "value": "LN-000101" },
          { "key": "lh_amount", "value": { "Value": 500000 } },
          { "key": "lh_email", "value": "ravi@example.com" }
        ]
      }
    }
  ]
}
```

So `data.fullname` will always be empty. You have to dig into `InputParameters` → `Target` → `Attributes`. The helper below does that once, so the rest of your code stays simple.

```csharp
using System.Text.Json.Nodes;

public static class DataverseContext
{
    // Returns the Target record's columns as a simple dictionary.
    public static Dictionary<string, JsonNode?> ReadTarget(string body)
    {
        var context = JsonNode.Parse(body)!;
        var target = context["InputParameters"]!.AsArray()
            .First(p => p!["key"]!.GetValue<string>() == "Target")!["value"]!;

        return target["Attributes"]!.AsArray()
            .ToDictionary(a => a!["key"]!.GetValue<string>(), a => a!["value"]);
    }

    public static string? Text(Dictionary<string, JsonNode?> row, string column) =>
        row.TryGetValue(column, out var v) ? v?.ToString() : null;
}
```

**Tip:** before you write any parsing code, look at a real payload. Point a test webhook at a free request-logging site, save a record, and copy the JSON you see. Then write your code against that, not against what you think Dynamics sends.

## Way 1: Webhook

### What it is

A webhook is a web address that Dynamics calls when something happens. You tell Dynamics: "When a loan application is created, POST the details to this address."

### Example: welcome email when a loan application is created

**Step 1. Write the Function.**

```csharp
using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

public class LoanCreatedWebhook(ILogger<LoanCreatedWebhook> log)
{
    [Function("LoanCreatedWebhook")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData req)
    {
        string body = await new StreamReader(req.Body).ReadToEndAsync();
        var loan = DataverseContext.ReadTarget(body);

        string? number = DataverseContext.Text(loan, "lh_name");
        string? email  = DataverseContext.Text(loan, "lh_email");

        log.LogInformation("New loan {Number}, sending welcome email to {Email}", number, email);
        // Call your email service here (for example Azure Communication Services).

        return req.CreateResponse(HttpStatusCode.OK);
    }
}
```

`AuthorizationLevel.Function` means the caller must send a secret **function key**. Without it, the Function answers 401 and does nothing.

**Step 2. Publish the Function to Azure** and copy two things from the portal: the Function URL (without the `?code=` part) and the function key.

**Step 3. Register the webhook** in the Plug-in Registration Tool:

1. **Register → Register New Web Hook.**
2. **Endpoint URL:** your Function URL.
3. **Authentication:** choose **HttpHeader**, key `x-functions-key`, value = your function key.

**Step 4. Register a step** on the webhook:

- **Message:** Create
- **Primary entity:** `lh_loanapplication`
- **Execution mode:** **Asynchronous**. The officer's save does not wait for the email.

**Step 5. Test it.** Create a loan application. Open the Function's **Monitor** tab or Application Insights and look for your log line.

### Two more webhook ideas

- **Loan amount changed → log it.** Register on **Update** and set **filtering attributes** to `lh_amount`, so the Function only wakes up when the amount changes, not on every save. Remember that an Update only sends the columns that changed. If you also need other columns, add a **post-image** to the step.
- **Lead qualified → tell the sales manager.** Register on the **QualifyLead** message and send a Teams message from the Function.

## Way 2: Service Bus queue

### What it is

A queue is a waiting line. Dynamics puts a message in the line. The Function takes messages out one by one. If the Function is down, the messages **wait safely in the queue** until it comes back.

That is the big difference from a webhook. A webhook needs the Function to answer right now. A queue doesn't.

### Example: send approved loans to the finance system

The finance system is slow and goes down every night for maintenance. A webhook would fail during that time. A queue just holds the messages.

**Step 1. Create a Service Bus namespace and a queue** called `loan-approved` in the Azure portal. Create a **Shared Access Policy** on the queue with **Send** rights only. Dynamics only needs to send.

**Step 2. Register the Service Bus endpoint** in the Plug-in Registration Tool:

1. **Register → Register New Service Endpoint.**
2. Paste the connection string of the Send-only policy.
3. **Designation type:** Queue. **Message format:** **JSON**, so the Function can read it easily.

**Step 3. Register a step** on that endpoint: message **Update** on `lh_loanapplication`, filtering attribute `lh_status`, **Asynchronous**.

No plugin is needed. Dynamics posts the execution context to the queue for you.

**Step 4. Write the Function.**

```csharp
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

public class LoanApprovedListener(ILogger<LoanApprovedListener> log)
{
    [Function("LoanApprovedListener")]
    public void Run(
        [ServiceBusTrigger("loan-approved", Connection = "ServiceBusConnection")] string message)
    {
        var loan = DataverseContext.ReadTarget(message);
        log.LogInformation("Loan status changed: {Loan}", DataverseContext.Text(loan, "lh_name"));
        // Check the status is Approved, then send the loan to the finance system.
    }
}
```

The `ServiceBusConnection` setting points to a **Listen-only** policy. The sender can only send, and the reader can only read.

If the finance system is down, throw an exception. Service Bus puts the message back and tries again later. After too many tries, it moves the message to a **dead-letter queue** so nothing is lost. Part 5 of this series covers this in detail.

### More queue ideas

- **Case closed → send to a ticketing system** that has rate limits.
- **Customer deleted → archive** the record in Blob Storage for compliance before it disappears.

## Way 3: Logic App (or Power Automate)

### What it is

A Logic App is a workflow you build by dragging boxes on a screen. The **Dataverse connector** has a trigger called **"When a row is added, modified or deleted"**. Add an **HTTP** action after it that calls your Function.

Power Automate uses the same connector and works the same way. Choose Logic Apps when the IT or integration team owns the flow in Azure. Choose Power Automate when the Power Platform team owns it.

### Example: loan disbursed → create the repayment schedule

1. **Trigger:** When a row is modified, table **Loan Applications**, filter rows `lh_status eq 3` (Disbursed).
2. **Action:** HTTP POST to your Function URL, header `x-functions-key`, body = the loan ID and amount.
3. **Function:** builds the repayment schedule and writes it back to Dataverse.

Here **you** choose the body. So the Function can read a simple JSON object, unlike webhooks and Service Bus.

```csharp
public record DisbursedLoan(Guid LoanId, decimal Amount, int Months);

public class CreateSchedule(ILogger<CreateSchedule> log)
{
    [Function("CreateSchedule")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData req)
    {
        var loan = await req.ReadFromJsonAsync<DisbursedLoan>();
        log.LogInformation("Building {Months}-month schedule for loan {Id}", loan!.Months, loan.LoanId);
        // Calculate EMIs and create schedule rows through the Dataverse Web API.
        return req.CreateResponse(System.Net.HttpStatusCode.OK);
    }
}
```

## Which one should I use?

- **Does the user need to wait for the result?** Use a **synchronous webhook**, and keep the Function very fast. This is rare.
- **Can the other system be slow or down?** Use **Service Bus**.
- **Does a business team want to change the steps without a developer?** Use a **Logic App or Power Automate**.
- **Not sure?** Start with an **asynchronous webhook**. It is the simplest, and you can move to Service Bus later.

## Day 2: what breaks after go-live

These are the problems people hit most often once this goes live, and how to fix each one.

**1. The Function always gets empty values.**
The code reads `data.fullname` or similar. Dynamics sends the execution context, not a flat record.
**How to fix it:** read `InputParameters` → `Target` → `Attributes`, like the helper above. Test against a real captured payload.

**2. On Update, most columns are missing.**
An Update only sends the columns that changed. If the officer changed only the amount, the email column is not there.
**How to fix it:** add a **post-image** to the step with the columns you need, or read the record from the Web API.

**3. Saving a record becomes slow, or fails with a timeout.**
Someone registered the webhook as **synchronous**. Now every save waits for the Function. Dynamics gives a webhook 60 seconds to answer. A cold start plus a slow external API can go past that, and then the user's save fails.
**How to fix it:** use **asynchronous** unless the user truly must wait. If it must be synchronous, keep the Function tiny and move slow work to a queue.

**4. The Function runs again and again on the same record.**
The Function updates the same loan, which fires the Update step again, which calls the Function again.
**How to fix it:** set **filtering attributes** so the step ignores the columns the Function writes. Also check `Depth` in the context and stop if it is greater than 1.

**5. The Function returns 401 Unauthorized.**
The function key is missing or was rotated in Azure but not updated in the webhook registration.
**How to fix it:** use the **HttpHeader** option with `x-functions-key`. When you rotate keys, update the registration the same day. Part 6 shows how to move to managed identity so there are fewer secrets to rotate.

**6. Big records arrive cut short.**
When the payload is over 256 KB, Dynamics trims it and sends the header `x-ms-dynamics-msg-size-exceeded`.
**How to fix it:** check that header. If it is there, read the full record from the Web API using `PrimaryEntityId`.

**7. Old code stops getting updates.**
Functions built on the in-process model, or on .NET 8, are now out of support. Both ended on 10 November 2026.
**How to fix it:** move to the isolated worker model on .NET 10. Microsoft has a migration guide, and most of the work is changing the attributes and the startup code.

## Using AI with this part

AI is very useful here, but it makes the same mistakes beginners make.

**Good prompts:**

- *"Here is a real Dataverse webhook payload [paste]. Write a C# isolated-worker Azure Function that reads lh_name and lh_email from the Target."* AI writes good parsing code when it can see a real payload.
- *"Here is my Function's error log from Application Insights [paste]. What are the three most likely causes?"*
- *"Create five test payloads for this Function: a normal create, an update with only one column, a missing email, a very long name, and a record over 256 KB."*

**Where AI gets it wrong:**

- It often assumes Dynamics sends a **flat JSON object**. It doesn't. Always give it a real payload.
- It often writes **in-process** code (`[FunctionName]`, `Microsoft.Azure.WebJobs`). Ask for the isolated worker model on .NET 10.
- It sometimes puts **keys and connection strings in the code**. Keys belong in app settings, and better still in Key Vault (Part 6).
- Never paste real customer data or production connection strings into an AI tool. Use test data from your developer environment.

## Interview questions

**1. What are the ways to call an Azure Function from Dynamics 365 without writing a plugin?**
A webhook, or a Service Bus endpoint, both registered with the Plug-in Registration Tool. You can also use a Logic App or Power Automate flow with an HTTP action.

**2. What does a Dataverse webhook send in the request body?**
The JSON form of the `RemoteExecutionContext`: message name, table, user, depth, and `InputParameters` with the `Target` record inside.

**3. When would you choose Service Bus over a webhook?**
When the receiving system can be slow or down, when volume is high, or when you can't lose a message. The queue holds messages until the Function can process them.

**4. Should a webhook step be synchronous or asynchronous?**
Asynchronous in most cases. A synchronous webhook makes the user wait, and if the Function fails or takes longer than 60 seconds, the user's save fails.

**5. How do you secure a webhook call to an Azure Function?**
Use a Function-level key sent in the `x-functions-key` header (HttpHeader authentication option). Store keys in Key Vault and rotate them, and don't put them in the URL.

**6. Your Function updates the record that triggered it, and it keeps running. Why, and how do you fix it?**
The update fires the same step again. Set filtering attributes so the step ignores the columns the Function writes, and check `Depth`.

## Checklist

- [ ] Isolated worker model, .NET 10
- [ ] Parsing code tested against a real captured payload
- [ ] Steps are asynchronous unless the user must wait
- [ ] Filtering attributes set on every Update step
- [ ] Post-image added when you need columns that didn't change
- [ ] Function key sent in a header, not in the URL
- [ ] Service Bus: Send-only policy for Dynamics, Listen-only policy for the Function
- [ ] Logging in Application Insights, with the record ID in every log line

## Simple rule to remember

**Dynamics tells, Azure does.** Dynamics only says "this happened". The Function does the work. And if the work can fail, put a queue in the middle.

Next in the series: [Part 2, surviving high-volume Dataverse integrations](/posts/azure-functions-dynamics-365/02-high-volume-integrations/).

**📚 The full series: Azure Functions with Dynamics 365**

- [Part 1: Beginner tutorial (webhooks, Service Bus, Logic Apps)](/posts/azure-functions-dynamics-365/01-beginner-tutorial/) (you are here)
- [Part 2: Surviving high-volume integrations](/posts/azure-functions-dynamics-365/02-high-volume-integrations/)
- [Part 3: Heavy Dataverse workloads with Durable Functions](/posts/azure-functions-dynamics-365/03-durable-functions/)
- [Part 4: Webhooks vs Service Bus for Dataverse events](/posts/azure-functions-dynamics-365/04-webhooks-vs-service-bus/)
- [Part 5: Retries, dead-letter queues and duplicates](/posts/azure-functions-dynamics-365/05-retries-dead-letter-queues/)
- Part 6: Securing the integration (coming next)
