---
title: "Observability: Trace Log, Profiler and Application Insights"
description: "Plugin trace log, Plugin Profiler and Application Insights with ILogger: seeing what runs in production."
series: dataverse-plugins
part: 8
pubDate: 2026-11-20
cover: /covers/plugins-part8.png
tags: [Dataverse, Plugins, Dynamics 365]
---

*Part 8 of my series, Dataverse Plugins: Built for Production. Part 7 was about proving the plugin is right before it ships. Today is about seeing what it does after it ships, and debugging the problems that only happen in production.*

## "It failed for a customer yesterday. Can you check?"

This is the message that separates a production developer from a demo developer. A loan officer got an error yesterday afternoon. She doesn't remember the exact text. She doesn't remember which loan. It worked when she tried again. Can you check?

If your plugin writes nothing about what it did, there's nothing to check. You'll try to reproduce it, fail, and close the ticket as "cannot reproduce". It will happen again.

If your plugin was built to be observed, you can answer in ten minutes: which loan, what data, which rule, how long each step took, and why.

## Back at the bank

Priya reports that saving loan LN-20733 "sometimes" takes 20 seconds and sometimes fails with a generic error. It's the credit-check plugin from Part 5, plus the co-applicant rule from Part 1, plus four other steps on the loan table. We have three tools. Let's use each for what it's good at.

## The thought shift

**Write your plugin for the person who will debug it at 2 a.m. without access to your head.**

Logging isn't something you add after an incident. It's part of the design, like error handling. Every plugin should answer three questions from its logs alone: **what did it receive, what did it decide, and how long did it take?**

## Tool 1: the plugin trace log

Everything your plugin writes through `ITracingService.Trace` can be stored in the Plugin Trace Log table, along with the exception (if any), the message, the entity, the depth, the mode and the execution duration.

### Turning it on

It's controlled by an environment setting with three values: **Off**, **Exception** (only runs that throw are logged) and **All**. In the classic UI it's under System Settings, on the Customization tab, "Enable logging to plug-in trace log". You can also change it in the Power Platform admin center environment settings.

- **Production: Exception.** Failures are logged with your trace lines; successful runs cost nothing extra.
- **Dev and test: All.** You want to see everything while building.
- **Production investigation: All, briefly.** Then switch back. "All" on a busy environment writes a lot of rows.

### Limits to know

- **Retention is short:** trace log records are kept for about 24 hours. Yesterday afternoon's failure may already be gone by tomorrow morning. That's one reason Tool 3 exists.
- **Size is limited:** roughly 10 KB of trace text per execution. Write the essentials, not whole records.
- **Synchronous failures:** the trace is still written even though the transaction rolls back. That's what makes Exception mode useful.

### What to write

A small, consistent set of lines beats a wall of text:

```csharp
tracing.Trace("START {0} {1} {2} depth={3} cols=[{4}] corr={5}",
    context.MessageName, context.PrimaryEntityName, context.PrimaryEntityId,
    context.Depth, string.Join(",", target.Attributes.Keys), context.CorrelationId);

tracing.Trace("DECIDE amount={0} threshold={1} coApplicant={2} image={3}",
    amount, _threshold, coApplicant != null, before != null);

tracing.Trace("BUREAU status={0} ms={1}", status, stopwatch.ElapsedMilliseconds);
```

Notice what's **not** there: no PAN number, no customer name, no phone, no credit score. Trace logs are readable by more people than you think. Log IDs, flags and numbers that describe decisions, not personal data.

### The correlation ID

`context.CorrelationId` is shared by every plugin execution caused by the same original request. Put it in your first trace line, and you can find every step that ran because of Priya's one click, including child operations, in one filter.

## Tool 2: the Plugin Profiler (replay production in your debugger)

Sometimes the trace tells you what happened but not why. The Plugin Profiler, part of the Plugin Registration Tool, lets you capture the exact execution context of a real run and replay it in Visual Studio with breakpoints.

1.  In the Plugin Registration Tool, install the profiler in the environment (it's a solution).
2.  Select the step and choose to start profiling. You can choose to persist the profile to a table, so it can be captured even when the plugin succeeds.
3.  Reproduce the problem (or wait for the user to).
4.  Choose "Debug" in the tool, point it at your local assembly, attach Visual Studio to the tool's process, and set breakpoints.
5.  Replay. Your code runs locally against the captured context: the same Target, images, shared variables and depth that production saw.
6.  **Stop profiling and uninstall the profiler** when you're done. A profiled step runs differently and adds overhead.

Two cautions. The captured profile contains real data, so treat it like production data. And the profiler is a tool for focused investigations in non-production or with care in production, not something to leave running.

## Tool 3: Application Insights (the long memory)

The trace log is short-term and per-environment. When you need weeks of history, trends, alerts and queries across all plugins, export Dataverse telemetry to Application Insights.

### Two kinds of data

- **Platform telemetry** that Dataverse exports for you once the integration is set up in the Power Platform admin center: requests, plugin executions (in the dependency table, with type "Plugin"), durations and failures. No code needed.
- **Your own telemetry**, written from plugin code through the `ILogger` interface in `Microsoft.Xrm.Sdk.PluginTelemetry`. It goes directly to your Application Insights resource.

```csharp
using Microsoft.Xrm.Sdk.PluginTelemetry;   // not Microsoft.Extensions.Logging, or the logger is null

var logger = (ILogger)sp.GetService(typeof(ILogger));
logger.LogInformation("Bureau call for loan {LoanId} took {Ms} ms with status {Status}",
    target.Id, stopwatch.ElapsedMilliseconds, status);
```

Important details:

- **Keep using ITracingService too.** If an environment doesn't have the Application Insights integration enabled, ILogger writes nothing. Trace and ILogger work side by side.
- **Retention follows your Application Insights settings** (90 days by default), not the 24 hours of the trace log.
- **ILogger isn't supported in profiler replay sessions.** Make sure your code tolerates the logger being absent.
- Same rule about personal data: structured IDs and numbers, not customer details.

### Questions you can now answer

```kusto
// Which plugin steps got slower this month? (KQL, outline)
dependencies
| where type == "Plugin"
| summarize p95 = percentile(duration, 95), runs = count() by name, bin(timestamp, 1d)
| order by timestamp asc
```

And you can set an alert: if the credit-check plugin's 95th percentile goes above 5 seconds, notify the team, before Priya notices.

## Solving LN-20733

Here's how the three tools come together:

1.  **Application Insights:** query plugin executions for the loan table in the last two days. The credit-check plugin shows a cluster of 18 to 20 second durations between 2 and 4 p.m., and a few failures.
2.  **Our ILogger lines** in the same window show the bureau responding slowly. The failures are our timeout from Part 5 kicking in; the slow successes are calls that came back just under it.
3.  **Trace log** (still within 24 hours) for one failed run shows the START and DECIDE lines: the plugin was running at depth 2. That's surprising for a user save.
4.  **Correlation ID** filter shows why: an Update plugin on the payment table was updating the loan, which re-ran the credit check on every payment posting. The filtering attributes on the credit-check step had been removed in a "cleanup" two weeks earlier.

Fix: restore filtering attributes, add a unit test that documents them in the registration checklist, and move the credit check to drafting time as Part 5 suggested. Total investigation time: under an hour, with no reproduction needed.

## A newer option: plugin monitoring in the maker portal

Microsoft has added a plugin monitoring experience (in preview at the time of writing) that shows recent plugin, Custom API and low-code plugin runs from the trace table in one place, with status and details. It reads the same 24-hour trace data, so it's a convenient viewer, not a replacement for Application Insights.

## Day-2 situations tutorials never show

### "There's nothing in the trace log"

Check, in order: the setting is Exception or All; the run actually failed (in Exception mode successful runs aren't logged); the record is less than about 24 hours old; and your plugin actually wrote trace lines before it threw.

### "The trace is cut off"

You hit the size limit. Remove verbose lines, log decisions not data, and keep the important lines at the start and the end.

### "The user saw 'An unexpected error occurred'"

Your plugin let a non-plugin exception escape (null reference, key not found). The platform shows a generic message. Catch expected problems and throw InvalidPluginExecutionException with a clear message; let truly unexpected errors bubble, but trace context first.

### "We found personal data in the trace log"

Treat it as a data handling issue: fix the code, and remember the trace log is readable by anyone with access to that table. Log IDs.

## Checklist

- Every plugin traces START (message, entity, ID, depth, columns, correlation ID), DECIDE (inputs to the rule) and timings for external calls.
- No personal data in traces or telemetry.
- Production trace setting is Exception; All only during investigations.
- Application Insights integration is enabled for production, and plugins use ILogger alongside ITracingService.
- There's at least one alert on plugin failures or duration.
- The Plugin Profiler is used for focused investigations and removed afterwards.
- Expected failures throw InvalidPluginExecutionException with clear messages.

## If this comes up in an interview

**Q: How do you debug a plugin failure that happened in production?**  
Check the plugin trace log (if within about 24 hours) and Application Insights telemetry, filter by correlation ID, and if needed capture and replay the context with the Plugin Profiler.

**Q: What are the trace log settings?**  
Off, Exception and All. Exception is the usual production setting.

**Q: What's the difference between ITracingService and ILogger?**  
ITracingService writes to the plugin trace log (short retention, per-execution debugging). ILogger writes to Application Insights when the integration is enabled (long retention, querying and alerting). Use both.

**Q: What is the correlation ID used for?**  
It links all plugin executions caused by the same original request, so you can trace a whole chain.

**Q: What should you never write to traces?**  
Personal or sensitive data. Log identifiers and decision inputs.

## What's next

Notice how often we've talked about "who is running this". Part 9 is all about it: which user a plugin acts as, impersonation, the SYSTEM user, secure configuration, and how plugins can quietly bypass the security model you spent months designing.
