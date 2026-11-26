---
title: "Retries, Dead-Letter Queues and Duplicate Handling"
description: "In Part 4, Dataverse pushed every new loan application out to Azure, and our Function fetched the credit score from the bureau and wrote it back. The demo worked perfectly. Production is where…"
series: azure-functions-dynamics-365
part: 5
pubDate: 2026-11-21
cover: /covers/azure-part5.webp
tags: [Azure Functions, Dataverse, Dynamics 365]
linkedin: "https://www.linkedin.com/pulse/part-5-when-things-fail-retries-dead-letter-queues-karthik-ithakota-92ruf/"
---

*📚 This is Part 5 of my series "Azure Functions with Dynamics 365". New here? Start with* [*Part 1*](/posts/azure-functions-dynamics-365/01-beginner-tutorial/)*, or read the previous one:* [*Part 4: Webhooks vs Service Bus for Dataverse events*](/posts/azure-functions-dynamics-365/04-webhooks-vs-service-bus/)*.*

*Updated November 2026: new sections on what breaks after go-live (Day 2), on using AI, and a checklist.*

## Why this part comes next

In Part 4, Dataverse pushed every new loan application out to Azure, and our Function fetched the credit score from the bureau and wrote it back. The demo worked perfectly. Production is where things fail.

### The scenario

It's month-end. The bank imports 3,000 loan applications from a partner portal in 20 minutes. Halfway through, the credit bureau's API starts returning 503 Service Unavailable for 8 minutes. Then three things happen:

- **About 1,100 events fail.** If nothing retries them, 1,100 loans sit with an empty credit score, and loan officers start calling the IT team.
- **Twelve records have bad data**, for example a PAN in the wrong format. The bureau rejects them every single time. If they keep retrying, they block nothing but waste calls and fill the logs.
- **Some events arrive twice.** A Function times out after writing the score but before confirming the message, so Service Bus delivers it again. Without protection, the bureau is called twice and the bank pays twice.

Part 4 ended with "make the Function safe to run twice". This part shows how, step by step, with the same loan scenario and C# code. The rule we're working towards: **retry what might succeed, park what never will, and never do the same work twice.**

## Three kinds of failure

Every failure in an integration falls into one of three groups. The fix is different for each, so the first job of your code is to tell them apart.

- **Transient.** Example: the bureau returns 503 or 429, a network timeout, Dataverse throttling (429). Will a retry help? Yes, later. What to do: retry with a delay.
- **Permanent (poison).** Example: invalid PAN, loan record deleted, a required field is empty. Will a retry help? No, never. What to do: stop retrying, park it with a reason, alert a person.
- **Duplicate.** Example: the same event delivered twice after a timeout or retry. Will a retry help? It already did. What to do: detect it and skip the work.

Simple picture: a courier delivering parcels. If nobody is home, he tries again tomorrow (transient). If the address doesn't exist, he returns the parcel to the depot with a note (poison, dead-letter). If the parcel was already delivered, he doesn't deliver it again (duplicate).

## What happens to a failed event

![Article content](/images/azure-part5-1.webp)

  

On the Service Bus path, every event ends in one of three places: scored once, retried after the lock expires, or parked in the dead-letter queue where a person sees it. The webhook path is different, and we'll come back to it after the hands-on.

## Hands-on 1: Set up the queue for retries and dead-lettering

**What you need:** the Service Bus namespace, queue and Dataverse service endpoint from Part 4 (Hands-on 2), and the Function project from Part 4.

With a Service Bus queue, retries come built in. The Function receives the message in **peek-lock** mode: Service Bus hides it for a while (the lock) and waits. If the Function completes it, it's removed. If the Function fails or the lock runs out, the message becomes visible again and is delivered again. Each attempt increases its **delivery count**. When the count reaches the **max delivery count**, Service Bus moves the message to the queue's **dead-letter queue** automatically.

### Step 1: Set the queue properties

Azure portal → Service Bus namespace → **Queues** → loan-events → **Properties**:

- **Max delivery count: 5.** Enough to ride out a short outage, small enough that poison messages don't loop for long.
- **Message lock duration: 3 minutes.** Longer than the slowest bureau call plus the Dataverse update.
- **Dead-lettering on message expiration: On.** Messages that expire are kept, not silently deleted.
- **Message time to live: 1 day.** An unprocessed loan event older than a day needs a person, not a retry.

### Step 2: Know where the dead letters go

Every queue has a built-in sub-queue at loan-events/\$DeadLetterQueue. You don't create it. In the portal, open the queue and select **Service Bus Explorer** → **Dead-letter** to peek at messages, their delivery count and the reason they were parked.

### Step 3: Don't add a second retry layer

Azure Functions retry policies (\[FixedDelayRetry\], \[ExponentialBackoffRetry\]) are supported only for a few triggers, such as Timer, Event Hubs, Kafka and Cosmos DB. For a **Service Bus trigger**, the queue's delivery count is the retry mechanism. Stacking your own retry loop on top of it multiplies the attempts (5 deliveries × 5 inner retries = 25 bureau calls for one loan).

## Hands-on 2: A Function that knows the difference

In Part 4, LoanEventProcessor left two TODOs and relied on one rule: if the method throws, Service Bus delivers the message again. That treats a bureau outage and an invalid PAN the same way. Now we fill in those TODOs and settle each message ourselves, so we decide what happens to it.

### Step 1: Turn off auto-complete

By default, the Service Bus trigger completes the message when the Function succeeds and abandons it when it throws. We switch that off with AutoCompleteMessages = false and use ServiceBusMessageActions to complete, dead-letter or leave each message. (Isolated worker model, as in Part 4. Settling messages yourself needs version 5.14 or later of the Service Bus extension.)

### Step 2: Sort the errors

```csharp
using Azure.Messaging.ServiceBus;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

public class LoanEventProcessor(
    ICreditBureauClient bureau,
    ILoanRepository loans,
    ILogger<LoanEventProcessor> log)
{
    [Function("LoanEventProcessor")]
    public async Task Run(
        [ServiceBusTrigger("loan-events", Connection = "ServiceBusConnection",
            AutoCompleteMessages = false)] ServiceBusReceivedMessage message,
        ServiceBusMessageActions actions)
    {
        var context = DataverseContextParser.Parse(message.Body); // helper from Part 2
        var loanId = context.PrimaryEntityId;

        try
        {
            var loan = await loans.GetAsync(loanId)
                ?? throw new PermanentFailureException($"Loan {loanId} no longer exists");

            if (!PanValidator.IsValid(loan.Pan))
                throw new PermanentFailureException($"Invalid PAN on loan {loan.Number}");

            // Hands-on 3 adds the duplicate check here

            var score = await bureau.GetScoreAsync(loan.Pan); // 503, 429, timeout = transient
            await loans.SaveScoreAsync(loanId, score, context.OperationId);

            await actions.CompleteMessageAsync(message);
        }
        catch (PermanentFailureException ex)
        {
            log.LogError(ex, "Poison loan event {LoanId}", loanId);
            await actions.DeadLetterMessageAsync(message,
                deadLetterReason: "PermanentFailure",
                deadLetterErrorDescription: ex.Message);
        }
        catch (Exception ex) when (IsTransient(ex))
        {
            // Don't complete, don't abandon: the lock expires after 3 minutes
            // and Service Bus delivers the message again.
            log.LogWarning(ex, "Transient failure for {LoanId}, delivery {Count} of 5",
                loanId, message.DeliveryCount);
        }
    }

    private static bool IsTransient(Exception ex) =>
        ex is TransientFailureException or HttpRequestException or TaskCanceledException;
}
```

### Step 3: Why we don't abandon transient failures

AbandonMessageAsync makes the message available **immediately**. During an 8-minute bureau outage, five immediate retries are used up in a few seconds and every loan ends up dead-lettered. By leaving the message alone, the 3-minute lock becomes a built-in delay: five deliveries spread over about twelve minutes, which covers the 8-minute outage in our scenario. For longer outages, send a copy with a later ScheduledEnqueueTime and complete the original, so you control the backoff yourself.

### What about Dataverse throttling?

When the Function writes the score back, Dataverse may answer 429 Too Many Requests during a big import. The ServiceClient retries 429s for you using the Retry-After value, as we saw in Part 2. If it still fails after its own retries, it counts as transient here.

## Hands-on 3: Make the Function safe to run twice

Both webhooks and Service Bus are **at least once**: an event can arrive more than once. The classic case: the Function saves the score, then the lock expires before CompleteMessageAsync runs, and the same message comes back. The answer is **idempotency**: running the same event twice has the same result as running it once.

### Step 1: Pick a key that identifies the event

The Dataverse execution context carries an OperationId for the system job that sent the event. When Dataverse retries the same job, the OperationId stays the same. That makes it a good idempotency key for one loan event.

### Step 2: Store it with the result

Add a text column to the Loan Application table, new_scoreoperationid. When the Function saves the score, it saves the OperationId in the same update. One update means the score and the key are written together or not at all.

### Step 3: Check before doing the work

```csharp
// Inside the try block, before calling the bureau
if (loan.ScoreOperationId == context.OperationId)
{
    log.LogInformation("Duplicate event for {LoanId}, already scored", loanId);
    await actions.CompleteMessageAsync(message); // remove it, don't re-do it
    return;
}
```

Now a duplicate costs one Dataverse read instead of a paid bureau call and a second update.

### Other ways to get the same safety

- **Natural check:** for this loan scenario, "the loan already has a score from today" is often enough, as mentioned in Part 4.
- **Upsert with an alternate key:** when the Function creates records (for example, a Credit Check row per loan), an upsert on an alternate key such as the loan number can't create a second row.
- **A processed-events store:** for integrations that touch several systems, keep the processed keys in a small table (Azure Table Storage or a Dataverse table) and check it first.

What doesn't work: checking in memory. A Function app can run on several instances at once, and each one has its own memory.

## Hands-on 4: Don't let dead letters die quietly

A dead-letter queue nobody watches is just a slower way to lose data. Our 12 invalid PANs need a person, and the people who can fix them are loan officers, not Azure admins.

### Step 1: A Function on the dead-letter queue

```csharp
[Function("LoanEventsDeadLetter")]
public async Task HandleDeadLetter(
    [ServiceBusTrigger("loan-events/$DeadLetterQueue", Connection = "ServiceBusConnection")]
    ServiceBusReceivedMessage message)
{
    var context = DataverseContextParser.Parse(message.Body);

    // errors: an IIntegrationErrorRepository, injected like loans in Hands-on 2.
    // Create an Integration Error row in Dataverse that loan officers can see in a view
    await errors.CreateAsync(new IntegrationError
    {
        LoanId = context.PrimaryEntityId,
        Reason = message.DeadLetterReason,
        Details = message.DeadLetterErrorDescription,
        Attempts = message.DeliveryCount,
        OperationId = context.OperationId
    });
}
```

The loan officer sees "Invalid PAN on loan LN-20481" in a Dataverse view, fixes the PAN on the form, and that update fires a new event that goes through the normal path. No one has to open the Azure portal.

### Step 2: Alert when the dead-letter count rises

In the Service Bus namespace → **Alerts** → **Create alert rule**, use the metric **Count of dead-lettered messages in a Queue/Topic**, filtered to loan-events, and alert when it's greater than 0. Send it to the support team's email or Teams channel.

### Step 3: Replay after a long outage

If the bureau was down for hours, healthy loans may have been dead-lettered as transient failures. Once it's back, resubmit those messages to the main queue (Service Bus Explorer can re-send messages, or use a small replay script). Hands-on 3 makes this safe: any loan that was already scored is skipped.

## The webhook path: your status code is the message

With a webhook (Part 4, Hands-on 1) there is no queue and no dead-letter queue. Dataverse calls the Function directly, so the HTTP status code the Function returns is the only thing Dataverse understands.

- **Function returns 200 / 204.** Async webhook step: the system job succeeds. Sync webhook step: the save continues.
- **Function returns 5xx or times out.** Async step: Dataverse retries the system job, then marks it **Failed** in System Jobs. Sync step: the save fails and is rolled back; the user sees an error.
- **Function returns 4xx.** Async step: treated as a failure as well. Sync step: the save fails and is rolled back.

So, on a webhook:

- **Transient:** return 503 and let the async system job be retried.
- **Poison:** don't return an error that makes it retry forever. Return 200, and write an Integration Error row (as in Hands-on 4), so a person sees it.
- **Duplicate:** the same OperationId check from Hands-on 3 works here too.

Where do failed webhook calls end up? In **Settings → System Jobs**, filtered to failed jobs. That's a much weaker dead-letter queue: no alert by default, no easy replay, and admins have to look for it. This is one more reason why Part 4 recommended Service Bus when the receiver might be down or the volume is high.

**Verify in your environment:** check the OperationId in the trace logs of a retried system job before relying on it as your key. If yours changes between retries, use the loan ID plus the record's modifiedon value instead.

## Webhook vs Service Bus when things fail

- **Who retries.** Webhook: the Dataverse async service (async steps only). Service Bus: Service Bus, up to your max delivery count.
- **Control over delay.** Webhook: none. Service Bus: lock duration, or scheduled re-send.
- **Where failures end up.** Webhook: failed system jobs in Dataverse. Service Bus: the dead-letter queue, with reason and delivery count.
- **Alerting.** Webhook: build it yourself. Service Bus: built-in metric for dead-lettered messages.
- **Replay after an outage.** Webhook: hard. Service Bus: re-send from the dead-letter queue.
- **Duplicates.** Possible on both.

**Rule of thumb:** retry what might succeed, park what never will, and never do the same work twice. If a lost or doubled event costs money, put Service Bus in between and make the Function idempotent.

## Common mistakes

1.  **Treating every error the same.** An invalid PAN retried five times is five wasted bureau calls and a delay before anyone sees it.
2.  **Abandoning transient failures.** The message comes back immediately, and the retries are gone before the outage ends.
3.  **A retry loop inside the Function on top of Service Bus retries.** Attempts multiply, and the lock can expire mid-loop, which creates duplicates.
4.  **Lock duration shorter than the work.** The message is delivered again while the first attempt is still running.
5.  **No idempotency.** Every retry or redelivery calls the bureau again and may write twice.
6.  **Nobody watching the dead-letter queue.** Messages expire or sit there for weeks. Alert on a count greater than 0.
7.  **Returning 500 for poison data on a webhook.** Dataverse keeps retrying something that can never succeed.
8.  **Dead-letter details only in Azure.** The people who can fix the data are business users. Show them the error in Dataverse.

## Day 2: what breaks after go-live

The common mistakes above happen while you build. These show up after a few months live.

**1. A retry storm after an outage.**
The bureau comes back after two hours. All 1,100 waiting messages retry at the same moment, the bureau rate-limits you, and many fail again.
**How to fix it:** limit how many messages the Function handles at once, and spread retries out with a growing delay (for example, schedule the retry message 1, 2, 4 and 8 minutes later).

**2. A deployment causes duplicates.**
You deploy the Function while it is processing messages. The work finishes, but the message is never marked complete, so it comes back and runs again.
**How to fix it:** idempotency, again. Every message must be safe to run twice. Deploy with slots outside busy hours.

**3. People stop reading the alerts.**
"Dead-letter count greater than 0" fires every night because of one bad PAN. After a week, nobody reads it, and then a real outage goes unnoticed.
**How to fix it:** split the alerts. Bad data goes to the business users in Dataverse. Technical failures, like timeouts and outages, go to the support team.

**4. Replaying dead letters brings back old problems.**
Someone replays 900 dead-lettered messages without fixing the cause first, and they all fail again.
**How to fix it:** fix the cause, replay a small batch first, check the result, then replay the rest.

**5. The dead-letter queue becomes a storage room.**
Messages sit there for months. Nobody knows whether they still matter.
**How to fix it:** agree a rule with the business, for example "every dead letter is fixed or closed within 3 working days", and report on it every week.

**6. The code is on an unsupported version.**
Microsoft ended support for the in-process model and for .NET 8 on 10 November 2026.
**How to fix it:** run on the isolated worker model with .NET 10.

## Using AI with this part

**Good prompts:**

- *"Here are 20 dead-letter reasons from last week [paste, with customer data removed]. Group them into causes and tell me which are bad data and which are outages."* This turns a messy list into a short action plan.
- *"Review this Service Bus Function [paste]. Will it create duplicates if it is retried? Where exactly?"*
- *"Write a small C# tool that reads the dead-letter queue, shows the reason for each message, and resends only the ones I select."*

**Where AI gets it wrong:**

- It adds a retry loop inside the Function on top of the Service Bus retries, so attempts multiply.
- It calls `AbandonMessageAsync` for every error, which uses up the retries in seconds.
- It treats all errors the same, so bad data is retried as if it were an outage.
- Never paste real loan or customer data into an AI tool. Remove names, PANs and amounts first.

## Interview questions

1.  **What is the difference between a transient and a poison message, and how does your code treat each?** (Hint: retry vs dead-letter with a reason.)
2.  **What happens to a Service Bus message when the Function throws, and when does it go to the dead-letter queue?** (Hint: peek-lock, delivery count, max delivery count.)
3.  **Why can abandoning a message make an outage worse?** (Hint: immediate redelivery uses up the retries in seconds.)
4.  **Service Bus is "at least once". How do you stop a loan being scored twice?** (Hint: an idempotency key saved with the result, checked before the work.)
5.  **A webhook-triggered Function gets invalid data. What status code should it return, and why?** (Hint: not one that makes Dataverse retry forever.)
6.  **The bureau was down for three hours and 900 messages were dead-lettered. How do you recover?** (Hint: fix the cause, replay from the dead-letter queue, and rely on idempotency to skip the ones already done.)

## Checklist

- [ ] Max delivery count set on purpose (not left at 10 without thinking)
- [ ] Lock duration longer than the slowest call plus the Dataverse update
- [ ] Bad data dead-lettered at once with a clear reason; outages retried with a growing delay
- [ ] No extra retry loop inside the Function on top of Service Bus retries
- [ ] Every message safe to process twice (idempotency key checked before calling the bureau)
- [ ] A Function or job reading the dead-letter queue, writing errors back to Dataverse
- [ ] Separate alerts: bad data to business users, outages to support
- [ ] A tested way to replay dead letters in small batches
- [ ] Isolated worker model, .NET 10

## Conclusion

In the month-end import, nothing was lost. The 1,100 loans hit by the outage were retried over about twelve minutes and scored once the bureau came back. The 12 invalid PANs were parked with a reason and shown to loan officers in Dataverse. The duplicates were skipped with one read each, and the bank paid for each credit check once.

None of that needed new technology. It needed three decisions in the code: is this failure worth retrying, where does it go if not, and have I already done this work?

**Over to you:** what's the worst failure you've seen in a live Dataverse integration, and how did you find out about it? Tell me in the comments. 👇

------------------------------------------------------------------------

**Next in the series:** Part 6, securing the integration: Key Vault, managed identity and app registrations, so no secret sits in your app settings.

**📚 The full series: Azure Functions with Dynamics 365**

- [Part 1: Beginner tutorial (webhooks, Service Bus, Logic Apps)](/posts/azure-functions-dynamics-365/01-beginner-tutorial/)
- [Part 2: Surviving high-volume integrations](/posts/azure-functions-dynamics-365/02-high-volume-integrations/)
- [Part 3: Heavy Dataverse workloads with Durable Functions](/posts/azure-functions-dynamics-365/03-durable-functions/)
- [Part 4: Webhooks vs Service Bus for Dataverse events](/posts/azure-functions-dynamics-365/04-webhooks-vs-service-bus/)
- [Part 5: Retries, dead-letter queues and duplicates](/posts/azure-functions-dynamics-365/05-retries-dead-letter-queues/) (you are here)
- Part 6: Securing the integration (coming next)
