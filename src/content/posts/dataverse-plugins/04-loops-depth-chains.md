---
title: "Loops, Depth and Plugin Chains"
description: "What context.Depth really measures, why 'Depth > 1, return' is dangerous, and five better ways to stop loops."
series: dataverse-plugins
part: 4
pubDate: 2026-11-20
cover: /covers/plugins-part4.png
tags: [Dataverse, Plugins, Dynamics 365]
---

*Part 4 of my series, Dataverse Plugins: Built for Production. Parts 2 and 3 covered where a plugin runs and what data it sees. Today: what happens when plugins trigger plugins, and how to stop a loop without breaking everything else.*

## The most copied line in plugin development

```csharp
if (context.Depth > 1) return;
```

You have seen it. You have probably written it. It sits at the top of thousands of production plugins, added the day someone hit an infinite loop and needed it fixed before lunch.

It works. The loop stops. And quietly, it also stops your plugin from running in every situation where a legitimate change arrives through another process: a workflow, another plugin, a bulk import that runs through a plugin, a child record update that rolls up to the parent. Months later someone asks why the validation "sometimes doesn't fire", and nobody connects it to a line written in a hurry.

This article is about understanding depth well enough that you never need that line.

## Back at the bank

Priya's loan has two plugins:

- **Plugin A** (Update of loan, PostOperation): when the rate or amount changes, it recalculates the EMI and updates the loan with the new EMI.
- **Plugin B** (Update of loan, PostOperation): when anything on the loan changes, it updates `new_lastreviewedon` on the loan.

Priya changes the rate. Plugin A updates the EMI. That Update triggers Plugin B, which updates the review date. That Update triggers Plugin A again, which recalculates the EMI (same value) and updates it again. Which triggers B. Which triggers A.

After eight rounds the platform stops it and Priya sees an error. Her rate change is rolled back. She tries again. Same error. The ticket says "Can't change interest rate. Urgent."

## What depth actually is

Every request into the pipeline carries a number: `context.Depth`.

- Priya's save from the form arrives at depth 1.
- When a plugin, running because of that save, calls `service.Update`, the new request runs at depth 2.
- If a plugin in that request makes another call, depth 3. And so on.

The platform has a ceiling (8 by default). When a chain goes past it, the platform assumes an infinite loop and throws. That's a safety net, not a design tool. By the time you hit it, you've already done eight rounds of database writes inside one transaction.

Two things people don't realise about depth:

1.  **Depth is about the chain, not the plugin.** Depth 2 doesn't mean "my plugin is running for the second time". It means "this request was caused by another request". The first time your plugin ever runs for a record can be at depth 2, if the record was created by another plugin.
2.  **Depth doesn't travel through everything.** A Power Automate cloud flow triggered by a Dataverse change calls back into Dataverse through the API as a new request. As far as the platform's counter is concerned, that's a fresh chain starting at depth 1. A loop between a plugin and a cloud flow can therefore run far past eight rounds, until something throttles it. Depth won't save you there.

## Why "Depth \> 1, return" is wrong

Look at what it says: "only run when a human or external caller saved directly." Now list the legitimate ways a loan gets updated by another request:

- A plugin on the payment table updates the loan's outstanding balance.
- A classic workflow or a plugin creates the loan from an approved application.
- A Custom API (Part 11) updates the loan as part of a restructure.
- A data migration tool calls a Custom API that creates loans.

Every one of these arrives at depth 2 or more. Every one of them silently skips your validation. You haven't fixed a loop. You've created a back door.

## The thought shift

**Don't ask "how deep am I?" Ask "is there real work for me to do?"**

A loop happens because a plugin does work that isn't needed: it writes a value that didn't change, or it reacts to a column it doesn't care about. Remove the unnecessary work and the loop has nothing to feed on. Depth then goes back to being what it should be: a piece of tracing information.

## Five fixes, from best to last resort

### 1. Don't update yourself: use PreOperation

Plugin A writes to the same loan that is being saved. That belongs in PreOperation, as we saw in Part 2. Set `target["new_emi"]` and the EMI is saved in the same write. No Update call, no new request, no depth 2, no trigger for Plugin B. Same for Plugin B's review date.

This one change removes the loop entirely, and makes both plugins faster.

### 2. Filtering attributes

Plugin B said "when anything changes". Almost nothing should run on "anything". Register Plugin A with filtering attributes `new_rate, new_amount, new_tenuremonths`. Now an Update that only touches the EMI or the review date never calls Plugin A at all. The platform doesn't even load it.

A step with no filtering attributes on Update runs for every column change made by every caller. It's the single most common cause of both loops and slow saves.

### 3. Only write what actually changed

Even with filtering, a plugin should compare before writing:

```csharp
decimal newEmi = CalculateEmi(amount, rate, tenure);
decimal? currentEmi = Read<decimal?>(target, before, "new_emi");
if (currentEmi == newEmi) return;          // nothing to do, so do nothing
target["new_emi"] = newEmi;
```

A plugin that writes only real changes cannot sustain a loop, because the second round finds nothing to change.

### 4. Mark your own updates, and recognise them

Sometimes you genuinely must update another record that will trigger a plugin which updates you back. For example, the loan updates its parent customer's total exposure, and a customer plugin recalculates risk on all the customer's loans.

Use a shared variable to leave a note, and check for it in the parent context:

```csharp
// In the loan plugin, before updating the customer
context.SharedVariables["loanhub.exposureSync"] = true;
service.Update(customer);

// In the customer plugin: was I triggered by the loan's exposure sync?
private static bool CameFrom(IPluginExecutionContext ctx, string key)
{
    for (var c = ctx.ParentContext; c != null; c = c.ParentContext)
        if (c.SharedVariables.Contains(key)) return true;
    return false;
}

if (CameFrom(context, "loanhub.exposureSync")) return;   // skip only this specific path
```

This is the precise version of the depth check. It skips only the path you know is circular, and keeps running for every other caller, at any depth.

### 5. Depth as a last guard, with a high bar and a trace

If you still want a depth guard as a safety net, make it high and visible, not silent:

```csharp
if (context.Depth > 4)
{
    tracing.Trace("Stopping at depth {0} for {1} {2}. Check for a loop.",
        context.Depth, context.PrimaryEntityName, context.PrimaryEntityId);
    return;
}
```

Now the guard only triggers in a real runaway, and it leaves evidence in the trace log instead of hiding the problem.

## Plugin chains: the loops that aren't loops

Not every long chain is circular. Some are just long. A loan approval creates a disbursement, which updates an account, which creates a ledger entry, which updates a summary, which recalculates a dashboard field. Five plugins, each reasonable on its own, all inside one synchronous transaction.

The problems with long chains:

- **Every step adds to Priya's wait.** She is waiting for the whole chain.
- **Any failure rolls back everything,** including the approval, because they share one transaction.
- **Locks are held longer,** because the transaction stays open until the last plugin finishes. Two users approving loans for the same customer start blocking each other.
- **Nobody owns the whole chain.** Each developer sees only their link.

The fix is a design question: **which links truly must succeed or fail with the save?** Usually it's one or two. Make those synchronous. Make the rest asynchronous, or move them to a queue and an Azure Function (Part 5). The approval returns in milliseconds, and the downstream work happens reliably in the background.

## A loop you can't see: plugin + cloud flow

A flow is triggered "when a loan is modified" and updates the loan's status text. The plugin is triggered on status text and updates a timestamp. The flow sees the modification and runs again.

Because each flow run comes back as a new request, depth stays at 1 or 2 forever. You won't get the depth error. You'll get thousands of flow runs, API limits consumed, and a record that changes every few seconds.

Prevention:

- Use the flow trigger's **column filter** (select columns) and **trigger conditions**, just like filtering attributes on a plugin.
- Compare before writing in the flow too.
- Decide one owner per column: either the plugin writes it or the flow does.

## How to diagnose a loop in minutes

1.  Turn the plugin trace log to "All" in a dev or test environment.
2.  Make sure every plugin's first trace line prints the message, entity, ID, depth and which columns are in the Target.
3.  Reproduce once.
4.  Sort the trace log by time and read the depth column. A repeating pattern of the same two plugins with increasing depth is your loop, and the Target columns show you which write is unnecessary.

```csharp
tracing.Trace("{0} {1} {2} depth={3} cols=[{4}]",
    context.MessageName, context.PrimaryEntityName, context.PrimaryEntityId,
    context.Depth, string.Join(",", target.Attributes.Keys));
```

That one line pays for itself the first time something goes wrong.

## Day-2 situations tutorials never show

### "It worked for months, then a new flow started a loop"

Someone added a cloud flow that updates the same table. Your plugin updates a column, the flow fires, the flow updates another column, and your plugin fires again.
**How to fix it:** set filtering attributes on both sides, and keep a list of every plugin and flow that writes to the table.

### "The Depth check blocked a real update"

A `Depth > 1` check stopped a legitimate update that came from another plugin or a Custom API.
**How to fix it:** use the better loop stoppers from this part (filtering attributes, compare old and new values, mark your own updates). Keep Depth only as a last guard with a high limit and a trace message.

### "Imports are slow and full of plugin errors"

A bulk import set off a long chain of plugins, and each save waited for the whole chain.
**How to fix it:** bypass custom logic for migration loads where your team allows it, and run the business logic afterwards in a controlled batch.

## Using AI with this part

**Good prompts:**

- *"Here are all the plugin steps and flows on the loan application table [paste a list]. Draw the chain: what updates what, and where a loop is possible."*
- *"Here is my trace log from a loop [paste]. Which step started it and which column keeps changing?"*

**Where AI gets it wrong:**

- Its first answer is almost always "add `if (context.Depth > 1) return;`". This part explains why that is dangerous.
- It forgets that cloud flows and other plugins are part of the chain.
- It suggests turning off the step instead of fixing the cause.

## Checklist

- No plugin updates the record it is registered on from PostOperation. It sets the Target in PreOperation.
- Every Update step has filtering attributes.
- Every write is preceded by a "did it actually change?" comparison.
- Known circular paths are broken with a prefixed shared variable checked through ParentContext.
- No `Depth > 1` guards. If there's a guard, it's high, and it traces.
- Long synchronous chains have been reviewed: only links that must share the transaction are synchronous.
- Cloud flows on the same tables use column filters and trigger conditions.

## If this comes up in an interview

**Q: What does context.Depth tell you?**  
How many requests deep in a chain the current one is. 1 is the original caller; each nested call from a plugin adds one. It's not "how many times my plugin has run".

**Q: Why is `if (Depth > 1) return;` risky?**  
It skips the plugin for every legitimate change that arrives through another process (plugins, Custom APIs, workflows), creating gaps in validation and logic.

**Q: How would you prevent a plugin from triggering itself?**  
Set values in PreOperation instead of calling Update, use filtering attributes, compare before writing, and if a circular path is unavoidable, mark it with a shared variable and check ParentContext.

**Q: Does the depth limit protect you from loops involving Power Automate?**  
Not reliably. A flow calls back as a new request, so the chain restarts. Use trigger filters and conditions and single ownership of columns.

**Q: Your approval takes eight seconds because of a chain of plugins. What do you do?**  
Identify which steps must succeed or fail with the approval, keep only those synchronous, and move the rest to async steps or a queue processed by Azure.

## What's next

We keep saying "move it to Azure". Part 5 is about exactly that boundary: calling external systems from plugins, timeouts, secrets, retries, and the moment a plugin should stop doing the work and simply hand it off.
