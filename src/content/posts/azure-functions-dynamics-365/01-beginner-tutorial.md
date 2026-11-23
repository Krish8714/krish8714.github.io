---
title: "Beginner Tutorial: Webhooks, Service Bus and Logic Apps"
description: "Azure Functions is a serverless, event-driven compute service that runs your custom code in the cloud when triggered by events. You focus on writing the code you need, and Azure handles servers,…"
series: azure-functions-dynamics-365
part: 1
pubDate: 2025-05-05
cover: /covers/azure-part1.webp
tags: [Azure Functions, Dataverse, Dynamics 365]
linkedin: "https://www.linkedin.com/pulse/azure-functions-dynamics-365-crm-dataverse-beginner-krishna-karthik-dakdc/"
---

*📚 This is Part 1 of my series "Azure Functions with Dynamics 365". In this beginner guide, I walk through real use cases for each way to trigger an Azure Function from Dynamics 365 (webhooks, Service Bus queues and Logic Apps), with C# code for each.*

## Azure Functions with Dynamics 365 CRM (Dataverse): Beginner Tutorial

Azure Functions is a **serverless, event-driven** compute service that runs your custom code in the cloud when triggered by events. You focus on writing the code you need, and Azure handles servers, scaling, and infrastructure. For example, imagine Azure Functions as a programmable sensor or smart switch: it stays idle until an event (like an HTTP call or a message) “flips the switch,” then your C# code runs on demand. Azure Functions supports many built-in triggers (HTTP, timers, queues, etc.) to connect with other services.

In a Dynamics CRM context, you could use Azure Functions whenever a CRM event needs extra processing. For instance, when a new Contact is created in CRM, a webhook or workflow step could call an Azure Function that sends a welcome email. Or when a record is updated, an Azure Function might log changes or call an external API. In each case, Azure Functions lets you write just the business logic in C# without managing a server or plugin, scaling up only when these events happen.

### 2. Using Webhooks

Dynamics 365 supports **webhooks** – a simple HTTP callback mechanism – to connect CRM events with external services. Starting in Dynamics 365 v9, you can configure a webhook so that when a CRM event occurs, CRM makes an HTTP POST (with JSON data) to the external URL. In practice, you register your Azure Function’s URL as a service endpoint in the Plugin Registration tool, and attach it to an entity event (e.g. Create of Contact). CRM will then invoke your function when that event happens. The webhook POST contains the record data in JSON, which your function can parse (as noted, “Webhooks send POST requests with JSON payload and can be consumed by any programming language”).

### When a new Contact is created (Send Welcome Email)

**Concept:** Register a webhook on the Contact **Create** event. CRM will POST the new contact’s data to your Azure Function’s HTTP trigger. In the function, read the contact’s name and email and send a welcome message (e.g. via SendGrid or other email API). For simplicity below, the code just logs the email action.

```csharp
using System.IO;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

public static class ContactCreatedFunction
{
    [FunctionName("ContactCreatedFunction")]
    public static async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = null)] HttpRequest req,
        ILogger log)
    {
        log.LogInformation("Webhook received: new Contact created.");
        string json = await new StreamReader(req.Body).ReadToEndAsync();
        dynamic data = JsonConvert.DeserializeObject(json);
        string name = data?.fullname;
        string email = data?.emailaddress1;
        // (In a real function, call an email service here)
        log.LogInformation($"Welcome email sent to {email} (Contact: {name}).");
        return new OkResult();
    }
} 
```

### When an Account is updated (Log changes)

**Concept:** Set up a webhook on the Account **Update** event. When an account changes, CRM sends the updated data to your function. The function reads key fields and logs them or forwards them to an external system. In the example below, we parse the account ID and name from the JSON payload and log it.

```csharp
public static class AccountUpdatedFunction
{
    [FunctionName("AccountUpdatedFunction")]
    public static IActionResult Run(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = null)] HttpRequest req,
        ILogger log)
    {
        log.LogInformation("Webhook received: Account updated.");
        string json = new StreamReader(req.Body).ReadToEnd();
        dynamic data = JsonConvert.DeserializeObject(json);
        string accountId = data?.accountid;
        string accountName = data?.name;
        log.LogInformation($"Account updated: ID={accountId}, Name={accountName}");
        // (Additional code could post changes to an external API or database)
        return new OkResult();
    }
} 
```

### When a Lead is qualified (Notify Sales Manager)

**Concept:** Use a webhook on the Lead **Qualify** message (or a field that indicates qualification). When a lead is qualified, CRM sends lead details to your function. The function might then notify the sales manager (e.g. by email or Microsoft Teams). In this code, we extract the lead’s name and a manager email from the JSON and log a notification.

```csharp
public static class LeadQualifiedFunction
{
    [FunctionName("LeadQualifiedFunction")]
    public static async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = null)] HttpRequest req,
        ILogger log)
    {
        log.LogInformation("Webhook received: Lead qualified.");
        string json = await new StreamReader(req.Body).ReadToEndAsync();
        dynamic data = JsonConvert.DeserializeObject(json);
        string leadName = data?.leadid?.Name;
        string managerEmail = data?.manageremail; // assume field with manager email
        // (In a real function, send an email or Teams message to the manager)
        log.LogInformation($"Sales manager notified ({managerEmail}) that lead \"{leadName}\" was qualified.");
        return new OkResult();
    }
} 
```

### 3. Using Service Bus Queues

For scenarios where you want **reliable queuing or batch processing**, Dynamics CRM can send messages to an Azure Service Bus queue instead of calling a webhook. You would typically use a custom plugin or workflow action in CRM that sends a Service Bus message. Then your Azure Function uses the ServiceBus trigger to process each message. As Microsoft notes, “Both webhooks and Azure Service Bus can be invoked from a plugin or custom workflow activity”. A ServiceBus-triggered function listens to a queue (or topic) and runs whenever a message arrives.

### When a Case is closed (Send to Ticketing System)

**Concept:** Register a plugin on the Case **Close** event to post a message to a Service Bus queue (e.g. “case-closed-queue”). An Azure Function with a ServiceBusTrigger picks up each case message. The function reads the case data (here simulated as a simple string message) and can then forward details to a ticketing or tracking system. Below, the function logs the case information from the queue.

```csharp
using Microsoft.Azure.WebJobs;
using Microsoft.Extensions.Logging;

public static class CaseClosedFunction
{
    [FunctionName("CaseClosedFunction")]
    public static void Run(
        [ServiceBusTrigger("case-closed-queue", Connection = "ServiceBusConnection")] string message,
        ILogger log)
    {
        log.LogInformation($"Processing closed case message: {message}");
        // (Code to integrate with a ticketing system could go here)
    }
} 
```

### When a Product is updated (Batch Processing)

**Concept:** On the Product **Update** event, a CRM workflow could send a message to the “product-updates-queue”. An Azure Function triggers on this queue to handle updates in batch. For example, the function might add the product to a batch job or push it to another system. In the example below, we log the incoming product update message.

```csharp
public static class ProductUpdatedFunction
{
    [FunctionName("ProductUpdatedFunction")]
    public static async Task Run(
        [ServiceBusTrigger("product-updates-queue", Connection = "ServiceBusConnection")] string message,
        ILogger log)
    {
        log.LogInformation($"Received product update: {message}");
        // (For example, add message to a batch processing list or database)
    }
} 
```

### When a Contact is deleted (Archive Data)

**Concept:** On Contact **Delete**, CRM can post a summary message to a “contact-deleted-queue”. The Azure Function triggered by this queue could archive the contact’s information (e.g. write to an archival data store). In this sample function, we simply log that the contact data is being archived.

```csharp
public static class ContactDeletedFunction
{
    [FunctionName("ContactDeletedFunction")]
    public static void Run(
        [ServiceBusTrigger("contact-deleted-queue", Connection = "ServiceBusConnection")] string message,
        ILogger log)
    {
        log.LogInformation($"Archiving deleted contact info: {message}");
        // (Archive logic would go here, such as storing the JSON in long-term storage)
    }
} 
```

### 4. Using Logic Apps with Azure Functions

**Azure Logic Apps** is a visual, drag-and-drop workflow platform that can integrate Dynamics 365 (Dataverse) with Azure Functions. You build a Logic App workflow by adding triggers and actions on a canvas (no code needed). Using the Dataverse connector, you can trigger a workflow whenever CRM records change. Then in the workflow you add an **HTTP** action that calls your Azure Function’s endpoint. This way, CRM events handled by Logic Apps will invoke the Function. Below are some example flows.

For each example, imagine a Logic App workflow that starts with a Dataverse trigger (e.g. "When a record is added/updated") and then uses an HTTP action to call the function.

### When an Opportunity is won (Trigger Reward Process)

**Concept:** Create a Logic App that triggers when an Opportunity record is updated to status “Won”. In the Logic App, add an HTTP action to call an Azure Function with the opportunity details. The function (below) processes the winning opportunity – for example, sending a reward or notification.

```csharp
public static class OpportunityWonFunction
{
    [FunctionName("OpportunityWonFunction")]
    public static async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = null)] HttpRequest req,
        ILogger log)
    {
        log.LogInformation("Opportunity won event received.");
        string json = await new StreamReader(req.Body).ReadToEndAsync();
        dynamic data = JsonConvert.DeserializeObject(json);
        string oppName = data?.opportunityname;
        // (Perform reward process here)
        log.LogInformation($"Processed rewards for opportunity: {oppName}");
        return new OkResult();
    }
} 
```

### When an Invoice is created (Save PDF to Blob Storage)

**Concept:** Set up a Logic App trigger on **Invoice** creation. The Logic App then calls an Azure Function with the invoice data. The function (below) could generate a PDF and save it to Azure Blob Storage. In this example, we simply log that an invoice was created.

```csharp
public static class InvoiceCreatedFunction
{
    [FunctionName("InvoiceCreatedFunction")]
    public static async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = null)] HttpRequest req,
        ILogger log)
    {
        log.LogInformation("Invoice created event received.");
        // In a real function, parse req.Body, generate PDF, and upload to Blob Storage
        return new OkResult();
    }
} 
```

### When Customer preferences are updated (Sync with Other System)

**Concept:** Use a Logic App that triggers on update of a **Customer Preferences** record. The app then calls an Azure Function with the updated preferences. The function code can parse the JSON and push the changes to another system or database. Below, we log that the preferences were updated.

```csharp
public static class CustomerPrefsSyncFunction
{
    [FunctionName("CustomerPrefsSyncFunction")]
    public static async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = null)] HttpRequest req,
        ILogger log)
    {
        log.LogInformation("Customer preferences updated event received.");
        string json = await new StreamReader(req.Body).ReadToEndAsync();
        dynamic data = JsonConvert.DeserializeObject(json);
        // (Sync data with external system)
        log.LogInformation("Customer preferences synchronized.");
        return new OkResult();
    }
} 
```

Each of the above examples shows how an Azure Function (in C#) can tie into Dynamics CRM workflows via webhooks, queues, or Logic Apps. By wiring up triggers on CRM events to Azure Functions, you can extend CRM with custom logic (sending emails, updating other systems, etc.) without managing your own servers. The Concepts above give a high-level flow, and the C# code snippets show how simple the function code can be. This approach keeps the focus on real-world CRM scenarios while avoiding complex setup details.

**Sources:** Microsoft docs on Azure Functions and Dynamics CRM webhooks/Logic Apps.

Next in the series: [Part 2, surviving high-volume Dataverse integrations](/posts/azure-functions-dynamics-365/02-high-volume-integrations/).

**📚 The full series: Azure Functions with Dynamics 365**

- [Part 1: Beginner tutorial (webhooks, Service Bus, Logic Apps)](/posts/azure-functions-dynamics-365/01-beginner-tutorial/) (you are here)
- [Part 2: Surviving high-volume integrations](/posts/azure-functions-dynamics-365/02-high-volume-integrations/)
- [Part 3: Heavy Dataverse workloads with Durable Functions](/posts/azure-functions-dynamics-365/03-durable-functions/)
- [Part 4: Webhooks vs Service Bus for Dataverse events](/posts/azure-functions-dynamics-365/04-webhooks-vs-service-bus/)
- [Part 5: Retries, dead-letter queues and duplicates](/posts/azure-functions-dynamics-365/05-retries-dead-letter-queues/)
- Part 6: Securing the integration (coming next)
