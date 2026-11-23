---
title: "Reading Data Right: Target, Images and Shared Variables"
description: "The Target is the request, not the record: absent vs null, pre and post images, and shared variables."
series: dataverse-plugins
part: 3
pubDate: 2026-11-20
cover: /covers/plugins-part3.png
tags: [Dataverse, Plugins, Dynamics 365]
---

*Part 3 of my series, Dataverse Plugins: Built for Production. Part 2 was about choosing the stage. Today is about the data your plugin actually receives, because most "random" plugin bugs are really misunderstandings about what is in the Target.*

## The bug that only happens on Tuesdays

Every team has one. A plugin that works when you test it and fails "sometimes" in production. You add logging, you stare at it, and finally you find the pattern: it fails when the record is updated from a particular screen, or by the integration, or by a bulk edit.

Nine times out of ten, the cause is the same. The developer assumed the Target contains the whole record. It doesn't. It contains what the caller sent. A form sends what changed. An integration sends what it maps. A bulk edit sends one column. Your plugin sees a different shape of data depending on who saved.

This article is about reading data correctly, every time, from every caller.

## Back at the bank

Priya's team has a new rule: **when a loan's interest rate changes, log the old rate, the new rate and who changed it on a rate history record.** Simple, right? It needs three things: the old value, the new value, and the user. Each of them comes from a different place in the context, and each has a trap.

## The thought shift

**Stop thinking of the Target as "the record". Think of it as "the request".**

The Target is the message the caller sent to Dataverse: "please set these columns to these values." The record itself lives in the database. If you want to know what the record looks like, you need an image or a query. If you want to know what the caller asked for, you read the Target.

Keep those two ideas separate and an entire category of bugs disappears.

## What is in the Target, message by message

- **Create:** an Entity with the columns the caller supplied. Columns with default values the platform adds later are not necessarily in it during PreValidation. Don't assume "all columns" even here.
- **Update:** an Entity with the record's ID and only the columns being changed. If Priya edits only the rate, the Target has the ID and the rate. Nothing else.
- **Delete:** not an Entity at all. An EntityReference: logical name and ID. Casting it to Entity gives you null and a quiet early return, which is a classic "my delete plugin never runs" bug.
- **Associate / Disassociate:** no Target entity. You get `Target` (an EntityReference), `Relationship` and `RelatedEntities`.
- **Owner and status changes:** these can arrive as a plain Update of `ownerid` or `statecode`, or through older specialised messages such as Assign and SetState, depending on the caller. Check which message your step listens to and test both paths.

Write your plugin defensively for the message it is registered on:

```csharp
if (context.MessageName == "Delete")
{
    var reference = context.InputParameters["Target"] as EntityReference;
    if (reference == null) return;
    // ... delete logic
}
else
{
    var target = context.InputParameters["Target"] as Entity;
    if (target == null) return;
    // ... create / update logic
}
```

## Contains, null and "missing" are three different things

This is the most important paragraph in the article. On an Update Target, a column can be in three states:

1.  **Not in the Target at all.** `target.Contains("new_rate")` is false. The caller did not touch it. The value in the database is unchanged.
2.  **In the Target with a value.** The caller is setting it to that value.
3.  **In the Target with null.** `Contains` is true, value is null. The caller is clearing it.

`GetAttributeValue<T>` returns null (or the default) for both case 1 and case 3. If you only use `GetAttributeValue`, you cannot tell "user cleared the rate" from "user didn't touch the rate". For our rate history, that difference is everything.

```csharp
bool rateChanged = target.Contains("new_rate");
if (!rateChanged) return;                       // not touched: nothing to log
decimal? newRate = target.GetAttributeValue<decimal?>("new_rate"); // null means cleared
```

### And images have a fourth twist

In an image (or a retrieved Entity), a column whose database value is null is simply **absent**. It is not present with a null value. So "not in the image" can mean "this column is empty" or "you forgot to include it in the image definition". The plugin cannot tell which. That is why your image definition must be deliberate, and why Part 1's test suite had a case specifically for "empty column absent from image".

## Images: the before and after pictures

An image is a snapshot of the record that the platform hands to you, so you don't have to query for it. You define it on the step registration: a name (alias), pre or post, and which columns.

- **PreImage:** the record as it was before this operation. Available on Update and Delete. Not on Create, because there is no "before".
- **PostImage:** the record as it is after the operation. Available on PostOperation steps for Create and Update. Not on Delete, because there is no "after".

For the rate history we need the old rate, so we register a PreImage named `PreImage` with exactly one column: `new_rate`.

```csharp
// Update of new_loan, PostOperation (sync), filtering attribute: new_rate
// PreImage "PreImage" with column new_rate
var target = (Entity)context.InputParameters["Target"];
if (!target.Contains("new_rate")) return;

Entity before = context.PreEntityImages.Contains("PreImage")
    ? context.PreEntityImages["PreImage"] : null;

decimal? oldRate = before?.GetAttributeValue<decimal?>("new_rate");
decimal? newRate = target.GetAttributeValue<decimal?>("new_rate");
if (oldRate == newRate) return;   // same value re-saved: not a change

var history = new Entity("new_ratehistory");
history["new_loanid"]   = new EntityReference("new_loan", target.Id);
history["new_oldrate"]  = oldRate;
history["new_newrate"]  = newRate;
history["new_changedby"] = new EntityReference("systemuser", context.InitiatingUserId);
service.Create(history);
```

Three details worth noticing:

- **`oldRate == newRate` check.** Many clients send a column even when its value didn't change. Being in the Target does not prove the value changed. Compare.
- **`InitiatingUserId`, not `UserId`.** `UserId` is who the plugin runs as, which can be a service account if the step is set to run in a specific user's context. `InitiatingUserId` is the person who actually triggered it. For audit-style data, you want the human. (Part 9 goes deep on this.)
- **The image has one column.** Selecting "all columns" on an image looks harmless. It means the platform reads every column of the record, including large text fields, on every single save. Pick only what you read.

## Images vs a Retrieve: when to use which

You could skip the image and call `service.Retrieve` instead. Prefer the image because:

- The platform already has the record in hand during the pipeline; an image costs less than a separate request you make.
- A PreImage is guaranteed to be the state before this operation. A Retrieve in PostOperation returns the state after it, which is exactly the wrong value for "old rate".

Use a Retrieve when you need data from another record, or when you need a column whose value might have been changed by an earlier plugin in the same pipeline and you need the latest version.

## The merged view: one helper you will use forever

Most validations want "the value as it will be after this save". That is: Target if the caller sent it, otherwise the image. This is the helper from Part 1:

```csharp
private static T Read<T>(Entity target, Entity before, string column)
{
    if (target.Contains(column)) return target.GetAttributeValue<T>(column);   // includes "cleared"
    if (before != null && before.Contains(column)) return before.GetAttributeValue<T>(column);
    return default(T);                                                          // empty in DB
}
```

Note the order. If the Target contains the column with null, the helper returns null, meaning "cleared", and does not fall back to the old value. Getting this order wrong is how a plugin allows someone to clear a mandatory co-applicant: the validation reads the old value from the image and thinks it's still there.

## Shared variables: how plugins pass notes to each other

Sometimes a PreOperation plugin knows something a PostOperation plugin needs. For example, the PreOperation step calculates the old EMI before the rate changes, and the PostOperation step wants to put both old and new EMI on the history record.

You could recalculate. Or you can pass a note through `context.SharedVariables`, a dictionary that travels with the pipeline:

```csharp
// PreOperation step
context.SharedVariables["loanhub.oldEmi"] = oldEmi;   // decimal: a simple, serializable type

// PostOperation step, same message, same record
decimal? oldEmi = context.SharedVariables.Contains("loanhub.oldEmi")
    ? (decimal?)context.SharedVariables["loanhub.oldEmi"] : null;
```

Rules that keep shared variables from becoming a mystery:

- **Prefix your keys** (`loanhub.`) so they don't collide with another team's plugin or an ISV solution.
- **Use simple types** (strings, numbers, Guids, booleans). Values are serialized, especially when an async step receives them.
- **Always check Contains.** The PreOperation step might be disabled, filtered out, or not deployed in that environment.
- **If the note was set by a plugin in a parent pipeline** (the operation that caused this one), look in `context.ParentContext.SharedVariables`. We'll use this in Part 4 to stop loops cleanly.

## Day-2 situations tutorials never show

### "It works from the form but not from the integration"

The form sends the changed column. The integration sends the full mapped record, including columns that haven't changed. Your plugin treats "in Target" as "changed" and fires business logic for nothing. Fix: compare with the PreImage, and set filtering attributes on the step.

### "The PreImage is empty"

Check, in this order: the alias in code matches the registration exactly (it is case-sensitive); the step is Update or Delete; the column has a value in the database (empty columns are absent); and the image was registered on the same step, not a sibling step.

### "Formatted values are missing"

Target values are raw: an OptionSetValue is a number, a lookup is a Guid and logical name. Display labels are not in the Target. If your error message needs the label, retrieve it, or better, keep the message about the business rule rather than echoing data.

### "Lookup name is null"

An EntityReference in the Target often has `Name` empty. Don't build logic or messages on `reference.Name` unless you retrieved it.

### "Calculated column in the image looks stale"

Calculated and rollup columns are computed on read or on a schedule. Don't base server-side validation on them; compute what you need from the source columns.

## Checklist

- I know what shape the Target has for the message I'm on (Entity, EntityReference, or none).
- I use `Contains` to decide "touched or not", and compare with the image to decide "changed or not".
- I treat "in Target with null" as "cleared", never as "not supplied".
- My images have only the columns I read, and the alias matches the code.
- I use a PreImage for "old value", never a Retrieve in PostOperation.
- Audit-style data uses `InitiatingUserId`.
- Shared variable keys are prefixed, simple-typed, and always checked with Contains.

## If this comes up in an interview

**Q: On an Update, a column isn't in the Target. What does that mean?**  
The caller didn't send it, so it isn't changing. Read the current value from a PreImage if you need it.

**Q: How do you tell "the user cleared a field" from "the user didn't touch it"?**  
`target.Contains(column)` is true with a null value when cleared, and false when untouched. `GetAttributeValue` alone can't tell them apart.

**Q: Why is a PreImage better than a Retrieve for the old value?**  
It's guaranteed to be the state before this operation and avoids an extra request. A Retrieve in PostOperation returns the new value.

**Q: Can you have a PreImage on Create or a PostImage on Delete?**  
No. There's nothing before a Create and nothing after a Delete.

**Q: What are shared variables and when would you use them?**  
A dictionary on the execution context that passes values between plugins in the same pipeline, for example from a PreOperation step to a PostOperation step, or from a parent operation to a child via ParentContext.

## What's next

We've hinted twice now at plugins that update records and trigger themselves. Part 4 is all about it: depth, infinite loops, plugin chains, and why `if (context.Depth > 1) return;` is the most copied and most dangerous line in plugin development.
