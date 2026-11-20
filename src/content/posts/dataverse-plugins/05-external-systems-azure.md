---
title: "Calling External Systems, and When to Hand Off to Azure"
description: "Sandbox rules, timeouts, secrets with Key Vault, and the hand-off pattern: Dataverse publishes, Azure delivers."
series: dataverse-plugins
part: 5
pubDate: 2026-11-20
cover: /covers/plugins-part5.png
tags: [Dataverse, Plugins, Dynamics 365]
---

*Part 5 of my series, Dataverse Plugins: Built for Production. This is where this series meets my Azure Functions series. Today: calling external systems from a plugin, the rules of the sandbox, and the moment a plugin should stop doing the work and hand it off.*

## The save button that waits for someone else's server

Here's a requirement every CRM developer gets eventually: "When the loan is submitted, check the customer's credit score with the bureau and block the submission if it's below 650."

The first version is always the same. A synchronous plugin on PreOperation, an HttpClient, a call to the bureau's API, an if statement. It works in the demo. The bureau responds in 300 milliseconds.

Then one Monday morning the bureau's API takes 40 seconds to respond. Every loan officer in the company clicks Submit and watches a spinner. Each of those saves holds a database transaction open while it waits, so other saves on the same records start waiting too. Nothing is broken in your code. You just made your CRM exactly as reliable as somebody else's server.

## Back at the bank

Priya's team has three integration requirements this quarter:

- **Credit check** before a loan can be submitted. The answer decides whether the save is allowed.
- **Notify the core banking system** when a loan is approved, so it can open the loan account.
- **Generate a sanction letter PDF** and store it against the loan. Takes 10 to 30 seconds.

All three involve an external system. Only one of them belongs anywhere near a synchronous plugin, and even that one needs care.

## The thought shift

**A synchronous plugin is part of the user's save. Anything inside it inherits the save's deadline and the save's transaction.**

So the question is never "can a plugin call this API?" (it can). The question is: **does the user's save genuinely need this answer before it can complete?**

- If yes, you call it from a synchronous plugin, and you engineer that call to be short, bounded and safe.
- If no, the plugin's only job is to hand off reliably. The work happens elsewhere.

## The rules of the sandbox

Dataverse plugins in the cloud run in an isolated sandbox. It allows outbound web calls, with rules you must design around:

- **HTTP and HTTPS only.** No raw sockets, no other protocols.
- **Named hosts only.** You can't call an IP address directly; it must be a DNS name. Localhost is not allowed.
- **TLS must be current** on the server you call.
- **Firewalls:** if the API restricts inbound traffic, it must allow the Power Platform outbound ranges (Microsoft publishes them as a service tag). For private networks, Dataverse plugins support virtual network integration, which your platform team sets up per environment.
- **A hard time limit of 2 minutes** per plugin execution. Hit it and the operation fails. In practice, a synchronous plugin should finish in a tiny fraction of that.

## Requirement 1: the credit check (synchronous, but bounded)

The submission genuinely depends on the answer. So this stays synchronous. But we engineer the call:

```csharp
private static readonly HttpClient Http = CreateClient();

private static HttpClient CreateClient()
{
    var client = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };   // our deadline, not the default 100s
    client.DefaultRequestHeaders.ConnectionClose = true;                 // no KeepAlive in the sandbox
    return client;
}

public void Execute(IServiceProvider sp)
{
    // ... context, tracing, target
    var stopwatch = Stopwatch.StartNew();
    try
    {
        var response = Http.GetAsync(_bureauUrl + "?pan=" + Uri.EscapeDataString(pan))
                           .GetAwaiter().GetResult();
        tracing.Trace("Bureau responded {0} in {1} ms", (int)response.StatusCode, stopwatch.ElapsedMilliseconds);

        if (!response.IsSuccessStatusCode)
            throw new InvalidPluginExecutionException(
                "We couldn't reach the credit bureau. Please try again in a few minutes.");

        int score = ParseScore(response.Content.ReadAsStringAsync().GetAwaiter().GetResult());
        if (score < 650)
            throw new InvalidPluginExecutionException(
                "This application doesn't meet the minimum credit criteria.");
    }
    catch (TaskCanceledException)
    {
        tracing.Trace("Bureau timed out after {0} ms", stopwatch.ElapsedMilliseconds);
        throw new InvalidPluginExecutionException(
            "The credit bureau is slow to respond right now. Please try again in a few minutes.");
    }
}
```

What makes this production-grade:

- **An explicit timeout.** HttpClient's default is 100 seconds. Without your own timeout, one slow bureau call can hold Priya's transaction for most of the 2-minute limit. Microsoft's own guidance is to set a timeout and disable KeepAlive for external calls in plugins.
- **A static, reused HttpClient.** Creating a new one per execution exhausts connections under load. It's safe to share because we don't change its state after creation.
- **Clear, honest error messages.** Priya sees "try again in a few minutes", not a stack trace. And we never leak the score or the bureau's raw response.
- **Timing in the trace.** When someone says "submit is slow", the trace log shows exactly how long the bureau took.

### A design question worth raising

Even a bounded synchronous call makes your SLA depend on the bureau's. Ask the business: could the check run when the application is drafted (asynchronously), with the result stored on the record, so that Submit just validates the stored score? That turns a live dependency into a data check. Often the answer is yes, and it's a better design.

## Secrets: where the API key lives

The bureau needs an API key. Where should it go?

- **Never in code.** It ends up in source control and every developer's machine.
- **Never in unsecure configuration.** Unsecure configuration travels inside your solution and anyone who can read the step can read it.
- **Secure configuration** on the step is better: only system administrators can read it, and it does not travel with solutions, so each environment sets its own.
- **Best: Azure Key Vault with a managed identity.** Power Platform supports managed identity for Dataverse plugins, so the plugin can get a token and read the secret from Key Vault without any stored credential at all. Setup needs a user-assigned managed identity or app registration with federated credentials, and a properly signed plugin assembly. Rotation then happens in Key Vault, not in every environment's step registration.

## Requirement 2: notify core banking (hand off, don't call)

Does Priya's approval need core banking to respond before it can complete? No. It needs core banking to **eventually and reliably** know about it.

If you call core banking from a synchronous plugin, you've coupled the approval to their uptime. If you call it from an async plugin, you're closer, but you're still doing integration work (retries, mapping, auth, throttling) inside a sandbox with a 2-minute limit and limited observability.

The production pattern: **Dataverse publishes, Azure delivers.**

1.  Register a **service endpoint** (Azure Service Bus queue or topic) in the Plugin Registration Tool.
2.  Register a step on Update of loan, filtered to the status column, **asynchronous**, pointing at that endpoint. No custom code required: the platform posts the execution context to the queue.
3.  An **Azure Function** with a Service Bus trigger reads the message, maps it, calls core banking with proper retries, and moves poison messages to the dead-letter queue for investigation.

If you need to shape the message (add computed data, filter conditions too complex for registration), write a small plugin that uses `IServiceEndpointNotificationService` to post the context to the endpoint. The plugin still doesn't talk to core banking. It hands off.

That is exactly the architecture from Parts 4 and 5 of my Azure Functions series: webhooks vs Service Bus, retries and dead-letter queues. The plugin series and the Azure series meet here on purpose.

## Requirement 3: the sanction letter (definitely not a plugin)

Ten to thirty seconds of PDF generation is work, not a check. Even as an async plugin it competes with every other async job in the environment, it can't scale out, and a 2-minute ceiling is uncomfortably close for a big letter.

Same hand-off as Requirement 2: queue a message, let an Azure Function generate the PDF, then write the file back to the loan through the Dataverse Web API. The function can scale to fifty letters at month-end without anyone noticing.

## A simple rule for every integration

Put the requirement through these three questions:

1.  **Does the save need the answer to decide whether it's allowed?** Synchronous plugin, strict timeout, friendly error, and question whether it could be pre-computed.
2.  **Does it need to happen, but the user doesn't need to wait?** Async hand-off to a queue, processed by Azure with retries and dead-lettering.
3.  **Is it heavy or long-running?** Not in the sandbox. Queue it, process it in Azure, write results back.

## Day-2 situations tutorials never show

### "Works in dev, fails in production with a connection error"

The production API has an IP allow-list and doesn't include the Power Platform outbound ranges for your region, or the endpoint is on a private network. Fix it with the service tag on the firewall, or virtual network integration.

### "Our async plugin is retrying and sending duplicates"

Async operations can be retried by the platform after transient failures, and Service Bus delivers at least once. The receiver must be idempotent: send the loan ID and a version or modified-on value, and make core banking (or your function) ignore duplicates.

### "The plugin worked for a year and suddenly times out"

The external API got slower, or TLS settings on their side changed. Your trace lines with response times are how you prove which. Without them, it's your code that gets blamed.

### "We rolled back the approval, but core banking already opened the account"

You called core banking from a synchronous plugin, and a later plugin in the same transaction threw. Dataverse rolled back; the external call can't be rolled back. Never make non-reversible external calls inside a synchronous transaction. Hand off after commit (async).

## Checklist

- Every external call from a synchronous plugin has an explicit short timeout and KeepAlive disabled.
- HttpClient is created once and reused.
- Errors shown to users are friendly and leak no data; details go to the trace.
- No secrets in code or unsecure configuration. Prefer Key Vault with managed identity.
- Non-blocking integrations go through a queue (service endpoint) and are processed in Azure.
- No irreversible external calls inside a synchronous transaction.
- Receivers are idempotent.
- Response times are traced.

## If this comes up in an interview

**Q: What restrictions apply to web calls from sandboxed plugins?**  
HTTP/HTTPS only, DNS names not IP addresses, no localhost, current TLS, and a 2-minute execution limit for the plugin.

**Q: Why set a timeout and disable KeepAlive?**  
Without a timeout, a slow API holds the transaction for the default timeout; KeepAlive on short-lived sandbox executions can lead to failures on closed connections. Both are Microsoft best-practice recommendations.

**Q: How would you send approved loans to an external system reliably?**  
Asynchronous step to an Azure Service Bus service endpoint, processed by an Azure Function with retries, dead-lettering and idempotency.

**Q: Where would you store an API key used by a plugin?**  
Ideally Azure Key Vault accessed via Power Platform managed identity; at minimum secure configuration, never code or unsecure configuration.

**Q: Why shouldn't you call a payment API from a synchronous PostOperation plugin?**  
Because if anything later in the transaction fails, Dataverse rolls back but the payment doesn't. Irreversible side effects belong after commit.

## What's next

Every synchronous step we add makes the save a little slower. Part 6 is about performance: measuring what each plugin costs, bulk operations, CreateMultiple and UpdateMultiple, and the habits that keep a busy environment fast.
