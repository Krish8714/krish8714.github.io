---
title: "Dynamics 365 JavaScript, Part 2: The CRM Debugging Toolkit"
description: "Breakpoints, the Console, the Network tab, URL flags, Live monitor and caching. Six tools, six real bugs, and how to find each one in minutes instead of days."
series: dynamics-365-javascript
part: 2
pubDate: 2026-11-27
cover: /covers/js-part2.png
tags: [Dynamics 365, JavaScript, Debugging, DevTools, Power Apps]
---

*Part 2 of Dynamics 365 JavaScript, from Basics to Production. Every part builds working code, then breaks it on purpose the way it really breaks in projects, and shows you how to debug and fix it.*

> **Guessing is not debugging. Every bug in this part is found by looking, not by changing code and hoping.**

## The scenario: "it says 1 other loan, but there are none"

The lending bank liked Part 1's PAN banner. Now they want one more thing on the Loan Application form: **if the customer already has other open loans, show how many**, so the officer checks them before approving a new one.

Arjun writes it in an hour. Then the bug reports start:

1. "It says *1 other open loan* for a brand-new customer."
2. "On my machine it shows nothing at all. No banner, no error."
3. "The form got slow after your change."
4. "I fixed it yesterday, but users still see the old message."

Arjun's first instinct is to change the code and try again. Four times. **Each of these bugs has a tool that shows the cause in under five minutes.** This part is about those tools: what each one is for, and a lab for each, on the same form you built in Part 1.

By the end of this part you'll be able to:

- stop code exactly where you want, and read every value at that moment,
- run code in the right frame from the Console,
- read the real error behind a failed Web API call,
- switch off scripts with URL flags to find out whose script is the problem,
- use Live monitor to see which handlers a form really has,
- prove whether the browser is running your latest file.

## The thought shift

When a script misbehaves, most people **change code to find the bug**: add an alert, upload, publish, refresh, repeat. Each loop takes three minutes and teaches you very little.

Professionals **observe first, change once**. Every question about a script has a tool that answers it:

| The question | The tool |
| --- | --- |
| What is the value of this variable right now? | **Breakpoints** (Sources) |
| Can I try a line of code against the live form? | **Console**, in the right frame |
| Did my Web API call fail, and why? | **Network** tab |
| Is it my script, or someone else's? | **URL flags** |
| Which handlers does this form really have, and did they run? | **Live monitor** |
| Is the browser running my latest file? | **Caching** checks (Network + Sources) |

Learn the question, and you'll always know which tool to open.

## The code for this part

We add one function to Part 1's file. It's called from `onLoad`, and it has **one bug left in on purpose**. Can you spot it before the lab does?

```javascript
// Web resource: lh_/js/loanapplication.js
var LoanHub = window.LoanHub || {};

LoanHub.LoanApplication = (function () {
    "use strict";

    var BANNER_ID = "pan-not-verified";
    var OPEN_LOANS_ID = "other-open-loans";

    function onLoad(executionContext) {
        var formContext = executionContext.getFormContext();
        showPanBanner(formContext);
        showOtherOpenLoans(formContext);
    }

    function showPanBanner(formContext) {
        var panVerified = formContext.getAttribute("lh_panverified");
        if (!panVerified) {
            console.warn("LoanHub: lh_panverified is not on this form");
            return;
        }
        if (panVerified.getValue() !== true) {
            formContext.ui.setFormNotification(
                "PAN not verified yet. Verify before moving to Credit assessment.",
                "WARNING", BANNER_ID);
        } else {
            formContext.ui.clearFormNotification(BANNER_ID);
        }
    }

    function showOtherOpenLoans(formContext) {
        var customer = formContext.getAttribute("lh_customerid");
        var value = customer ? customer.getValue() : null;
        if (!value) {
            return; // no customer yet: nothing to check
        }

        // Lookup ids come with curly braces: {1234-...}. OData needs them without.
        var customerId = value[0].id.replace(/[{}]/g, "");

        var query = "?$select=lh_loannumber" +
            "&$filter=_lh_customerid_value eq " + customerId +
            " and statecode eq 0";

        Xrm.WebApi.retrieveMultipleRecords("lh_loanapplication", query).then(
            function (result) {
                var count = result.entities.length;
                if (count > 0) {
                    formContext.ui.setFormNotification(
                        "This customer has " + count + " other open loan(s). Check them before approving.",
                        "INFO", OPEN_LOANS_ID);
                } else {
                    formContext.ui.clearFormNotification(OPEN_LOANS_ID);
                }
            },
            function (error) {
                console.error("LoanHub: showOtherOpenLoans failed: " + error.message);
            });
    }

    return {
        onLoad: onLoad
    };
})();
```

**What's new compared with Part 1:**

- `Xrm.WebApi.retrieveMultipleRecords` asks Dataverse for rows. It doesn't return the rows straight away; it returns a **promise**, and the rows arrive later in the first function inside `.then(...)`.
- If the call fails, the **second** function in `.then(...)` runs, with an `error` object.
- Every log message starts with `LoanHub:`. You'll see why in the Console lab.

## Lab 1: Breakpoints, Scope and Watch (Sources)

**Bug report:** "It says *1 other open loan* for a brand-new customer."

![The bug in the lab: Kiran Rao has only this one loan, yet the form says "This customer has 1 other open loan(s)"](/images/js-part2-bug.png)

**The question:** what did the query actually return?

1. Open a loan whose customer has **only this one loan**. Press **F12**, go to **Sources**, press **Ctrl+P**, type `loanapplication`, open the file.
2. Click the line number of `var count = result.entities.length;` to set a breakpoint.
3. Refresh the form. Execution stops inside the callback, **after** the data came back.
4. In the right pane, open **Scope > Local** and expand `result.entities`. There is one row.
5. Expand that row and look at `lh_loannumber`. It's **the loan you have open**.

![Paused on breakpoint at line 47: DevTools shows result = {entities: Array(1)} inline and in Scope, while count is still undefined](/images/js-part2-paused.png)

You can confirm the same thing without DevTools: paste the query into the address bar (see Lab 3). The only row that comes back is LN-000101, the loan that's open on the screen:

![The Web API query result for this customer: one row, LN-000101, the same loan that is open on the form](/images/js-part2-query-result.png)

**The cause:** the query asks for "open loans for this customer", and the loan on the screen *is* an open loan for this customer. It counts itself.

**The fix:** leave the current record out of the query.

```javascript
var loanId = formContext.data.entity.getId().replace(/[{}]/g, "");

var query = "?$select=lh_loannumber" +
    "&$filter=_lh_customerid_value eq " + customerId +
    " and statecode eq 0";

if (loanId) { // a new, unsaved loan has no id yet
    query += " and lh_loanapplicationid ne " + loanId;
}
```

### Three breakpoint tricks worth knowing

- **Conditional breakpoint:** right-click a line number > **Add conditional breakpoint**, and type a condition such as `result.entities.length > 0`. Execution stops only when it's true. Perfect for "it only happens on some records".
- **Logpoint:** right-click > **Add logpoint**, and type something like `"count", result.entities.length`. It prints to the Console **without stopping and without changing your code**. You can use it in a test environment where you can't deploy a `console.log`.
- **Watch:** in the right pane, add an expression under **Watch** (for example `result.entities.length`). It's re-evaluated every time execution pauses.

![Adding a conditional breakpoint on line 47 with the condition result.entities.length > 0](/images/js-part2-conditional-breakpoint.png)

### Stepping through code

When paused:

| Key | What it does | Use it when |
| --- | --- | --- |
| **F8** | Continue to the next breakpoint | You've seen what you need |
| **F10** | Step **over**: run this line, stop on the next | You don't care what's inside the function being called |
| **F11** | Step **into**: go inside the function on this line | The bug may be inside that function |
| **Shift+F11** | Step **out** of the current function | You stepped into something you didn't need |

The **Call Stack** pane shows how you got here. Your functions are near the top; everything below them is the platform's own code. You never need to debug that, but it tells you which event called you.

## Lab 2: The Console, in the right frame

**The question:** can I test a line of code against the live form, without uploading anything?

Part 1 showed that form scripts run inside hidden frames, so the Console's default context (`top`) can't see `LoanHub`. There's an easier way than trying each frame:

1. Set a breakpoint anywhere in your file and refresh the form.
2. When execution pauses, look at the Console's context dropdown: it has **switched to your script's frame automatically**.
3. Now you can run code against the real form, using the variables in scope:

```javascript
formContext.getAttribute("lh_panverified").getValue()
formContext.getAttribute("lh_customerid").getValue()[0].id
formContext.data.entity.getId()
```

4. You can even test the fixed query before you change the file:

```javascript
Xrm.WebApi.retrieveMultipleRecords("lh_loanapplication",
    "?$select=lh_loannumber&$filter=statecode eq 0").then(r => console.table(r.entities))
```

`console.table` prints the rows as a table, which is much easier to read than nested objects.

![The Console while paused, already switched to the script's frame: getId() returns {C0DFA1F2-...}, and console.table(result.entities) shows one row, LN-000101, with the same id](/images/js-part2-console-paused.png)

Look closely: the form's id is `{C0DFA1F2-...}` and the only row the query returned has the id `c0dfa1f2-...`. It's the same loan. The Console proved the Lab 1 bug in two lines.

### Find your messages in the noise

Open the Console on any model-driven form and you'll see dozens of red errors and yellow warnings. **Almost none of them are yours.** They come from the platform, from browser extensions, and from telemetry.

That's why every message in our code starts with `LoanHub:`. Type `LoanHub` in the Console's **Filter** box, and only your messages remain. Agree one prefix per project and use it in every `console.log`, `console.warn` and `console.error`.

## Lab 3: The Network tab

**Bug report:** "On my machine it shows nothing at all. No banner, no error."

**Break it:** in the query, misspell the column: `$select=lh_loannumbr`.

**What you see:** nothing. The form opens normally. No error dialog.

**Why there's no error dialog:** the Script Error dialog appears only when your code **throws**. Here, nothing throws. The Web API call fails, the promise calls the **error function**, and that function only writes to the Console. If nobody opens the Console, nobody knows.

**The question:** did the Web API call fail, and why?

1. Open DevTools > **Network**. Tick **Keep log** (so the list survives a refresh). Called **Preserve log** in some Chrome versions.
2. In the filter box, type `lh_loanapplications`. This hides the hundreds of other requests the form makes.
3. Refresh the form. Your request appears in **red**, with status **400**.
4. Click it and open the **Response** tab. The real error is there:

![The Dataverse Web API error for a misspelled column: Could not find a property named 'lh_loannumbr' on type 'Microsoft.Dynamics.CRM.lh_loanapplication'](/images/js-part2-api-error.png)

**The fix:** correct the logical name to `lh_loannumber`.

**Prevent it:** check logical names in the table's **Columns** list (or in the Web API itself, see below) instead of typing them from memory.

### What the Network tab tells you at a glance

| Status | Usually means |
| --- | --- |
| **200 / 204** | It worked. If the result is still wrong, check the query (Lab 1). |
| **400** | The request itself is wrong: a misspelled column, a bad filter, curly braces left in a GUID. Read the Response. |
| **401** | The session expired. Sign in again. |
| **403** | The user lacks a privilege. The Response names it. |
| **404** | The row or the table name doesn't exist (check the plural entity set name, such as `lh_loanapplications`). |
| **429** | Too many requests. Your script is calling the API in a loop. |

### Two habits that save time

- **Test the query in the address bar.** Paste the request URL (`https://<your-org>.crm.dynamics.com/api/data/v9.2/lh_loanapplications?$select=...`) into a new tab. You see the result or the error as plain JSON, with no code involved. That's how the screenshot above was taken.
- **Copy as fetch.** Right-click the request > **Copy > Copy as fetch**, paste it in the Console, change one thing, and run it again. It's the fastest way to try a fix.

## Lab 4: URL flags (is it my script, or someone else's?)

**Bug report:** "The form got slow after your change."

Three teams have scripts on this form. Before you spend a day profiling your own code, find out **whose** script is slow. Model-driven apps let you switch off parts of a form, **for your session only**, by adding flags to the URL.

Open a loan normally. The banners are there:

![The Loan Application form opened normally: the PAN banner from our OnLoad handler is shown at the top](/images/js-part2-flags-normal.png)

Now add this to the end of the URL and press Enter:

```text
&flags=DisableFormHandlers=true
```

![The same loan with &flags=DisableFormHandlers=true: PAN Verified is still No, but the banner is gone because no event handlers ran](/images/js-part2-flags-off.png)

PAN Verified is still **No**, but the banner is gone: **no event handlers ran**. If the form is fast now, the slowness is in a handler. Then narrow it down, one step at a time:

| Flag | What it switches off |
| --- | --- |
| `DisableFormHandlers=true` | All event handlers (OnLoad, OnChange, OnSave) |
| `DisableFormHandlers=onload_2` | Only the OnLoad handler at index 2 |
| `DisableFormLibraries=true` | All form libraries: the files are not even loaded |
| `DisableFormLibraries=1` | Only the library at index 1 |
| `DisableWebResourceControls=true` | Web resources placed on the form (HTML, images) |
| `DisableFormCommandbar=true` | The command bar |

To use several at once, separate them with commas: `&flags=DisableFormLibraries=true,DisableWebResourceControls=true`.

**Use the flags one at a time.** Start with `DisableFormHandlers=true`. If the problem goes away, switch handlers off one index at a time until you find the one that matters. `DisableFormLibraries` is stronger, because it stops files from loading at all, so it can break more things on the form.

**Where do the index numbers come from?** From Live monitor, in the next lab.

**Important:** the flags only change **your** browser session. Users are not affected, so this is safe to use in a test or even a production environment, as long as you don't save data while the form is in a half-working state.

## Lab 5: Live monitor (what does this form really have?)

**Bug report:** "The Web API call runs twice." (You'll see it in the Network tab as two identical requests.)

**The question:** which handlers are registered on this form, in what order, and did they run?

The form designer shows what *you think* is registered. **Live monitor shows what the form actually loaded.**

1. Open the app and add `&monitor=true` to the end of the URL. A **Monitor** button appears in the header.

   ![The app header after adding &monitor=true: a new Monitor button appears next to Settings](/images/js-part2-monitor-button.png)

2. Select it. Live monitor opens in a new tab. Select **Play model-driven app**, and confirm **Join** in the app tab.

   ![The Join monitor debug session dialog in the app](/images/js-part2-monitor-join.png)

   The dialog warns that everyone in the session sees the app's events and data. That matters when you debug with a real user (see Day 2).

3. Open a loan in the app. Back in Live monitor, type `FormEvents` in the **Filter** box.
4. Select the **FormEvents** row and expand **data** in the details pane on the right.

   ![Live monitor: the FormEvents operation lists the OnLoad handler with eventIndex 0, function LoanHub.LoanApplication.onLoad, library lh_/js/loanapplication.js and enabledState Enabled](/images/js-part2-monitor-formevents.png)

For every event you see the **eventIndex**, the **function**, the **library** and whether it's **enabled**. This is the source of the index numbers for the URL flags.

**The cause of "runs twice":** the handler is registered twice on OnLoad (two entries, index 0 and 1, same function). It's easy to do in the form designer, especially when two people edit the same form. Remove one registration.

The **FormEvents.onload** row tells you that each handler actually **started**, so you can tell "registered but never ran" from "ran and failed".

### What else Live monitor shows

- **Network** rows for every request, with timings, like a simpler Network tab.
- **FormChecker** rows that explain form behaviour, such as why a column is hidden or read-only.
- **Download**, to save the session as a file and share it with a colleague.

## Lab 6: Caching (is the browser running my latest file?)

**Bug report:** "I fixed it yesterday, but users still see the old message."

Part 1 showed the quick fix (a hard refresh). Here is how to **prove** what's happening instead of guessing. When I tested this lab, the result surprised me, and it's the most useful thing in this part.

1. DevTools > **Network**, filter `loanapplication.js`, and refresh the form normally (F5).
2. Look at the **Size** column. In a model-driven app you'll most likely see **(ServiceWorker)**:

   ![Network tab filtered to loanapplication.js: Status 200, Size (ServiceWorker), 3 ms](/images/js-part2-serviceworker.png)

3. Now tick **Disable cache** and refresh again. **It still says (ServiceWorker).**

**Why:** the app installs a **service worker**, a small background script that sits between the page and the network and serves files from its own store. The **Disable cache** checkbox only switches off the browser's normal HTTP cache. It does **not** bypass the service worker. So you can tick Disable cache, refresh all day, and still run yesterday's file.

**How to really get the latest file:**

- **Hard refresh (Ctrl+Shift+R).** A hard refresh bypasses the service worker for that page load. This is what fixed it in Part 1.
- **While developing:** DevTools > **Application** > **Service workers** > tick **Bypass for network**. Now every normal refresh goes to the server. Untick it when you're done.
- **To prove it:** with Bypass for network ticked, refresh and check the Size column. It shows a real size (in my lab, **1.0 kB** in 64 ms) instead of (ServiceWorker).

![DevTools Application > Service workers, with Bypass for network ticked](/images/js-part2-bypass-for-network.png)

![After Bypass for network: loanapplication.js now shows Size 1.0 kB and 64 ms, a real download from the server](/images/js-part2-network-fresh.png)

4. Finally, open the file in **Sources** and check that the code matches what you published.

**For users, not just for you:**

- Publishing a web resource makes the platform serve the new version, but a browser that already has the old one can keep using it until it reloads the app.
- Tell testers to **close the app tab and open it again**, or do **Ctrl+Shift+R** after a release.
- Remember from Part 1 that the **form definition** is cached too (libraries, handlers, their settings), not only the file.

## The bug we left in on purpose

Did you spot it? It was the one from Lab 1: the query counted the current loan. The other bugs came from small changes (a misspelled column, a duplicate registration, a cached file). **None of them needed you to guess.** Each one was found by asking the right question and opening the right tool.

## Day 2: what goes wrong after go-live

### 1. "It only happens for one user"

**What you see:** a branch manager gets a wrong count. You can't reproduce it with your account.

**Why it happens:** different security role, different form, different data, different browser cache. Your account sees a different world.

**How to handle it:**

1. In Live monitor, use **Invite** (for a colleague) or **Connect user** to send the user a link. When they open it and join, you see **their** session's events: FormEvents, network calls and errors, from your own screen.
2. Check which form they got and whether your handler started for them.
3. Look at their failed requests: a **403** names the missing privilege.
4. Remember the warning in the join dialog: you will see their data. Use it with their consent, and preferably in a test environment.

### 2. "There's nothing in the Console"

**What you see:** the user sends a screenshot of the Console and says it's empty, or full of red errors that aren't yours.

**Why it happens:** the Console was filtered, or the user looked at the wrong tab, or your code swallows errors without logging them.

**How to handle it:**

1. Every catch or error callback must log something, with your prefix.
2. Show real failures to the user too, with a notification, not only in the Console: "Couldn't check other loans. Refresh, or contact support." A silent failure is the worst kind.
3. Ask users to filter by your prefix (`LoanHub`) before they send a screenshot.

### 3. "The breakpoint never hits"

**What you see:** you set a breakpoint, refresh, and execution never stops.

**Why it happens:** one of these, in this order:

1. The handler isn't registered on this form (check Live monitor).
2. The browser is running an old copy of the file, so your line numbers don't match the code that's running (Lab 6).
3. The code before your line returned early (a guard such as `if (!value) return;`). Put the breakpoint on the **first** line of the function to check.
4. You opened a second copy of the file in Sources. In the file list, the same file can appear under more than one frame. Use **Ctrl+P** from a paused state, or set the breakpoint in each copy.

### 4. "A vendor solution broke our form"

**What you see:** after importing a third-party solution, the Loan Application form shows a Script Error, or loads slowly.

**How to handle it:**

1. Open the form with `&flags=DisableFormLibraries=true`. If the problem goes away, it's a script.
2. Use Live monitor's FormEvents to see the libraries and their indexes.
3. Switch them off one at a time (`DisableFormLibraries=2`) until you find the one. Now you have evidence for the vendor, not a guess.

### 5. "We can't debug production"

**What you see:** the bug only happens in production, and you can't deploy debug code there.

**How to handle it:**

- **Logpoints** (Lab 1) print values without any change to the code.
- **URL flags** and **Live monitor** only affect your own session.
- The **Network** tab shows the real Web API errors for production data.
- Never change data while investigating. Read only.

## Using AI with the debugging toolkit

AI is useful for reading errors and suggesting what to check. It can't see your browser, so the looking is still your job.

### Where it helps

- **Explaining a Web API error.** Paste the Response JSON and the request URL, and ask what's wrong with the query.
- **Writing a Console snippet** to test a query or inspect a value while paused.
- **Turning a symptom into a checklist.** "Count is wrong" becomes: what did the query return, does it include the current record, is the filter right?

### Prompts that work (copy and adapt)

```text
This Dataverse Web API request from a Dynamics 365 form script fails.
Request URL: <paste>. Status: <status>. Response: <paste the JSON>.
Explain the error in plain words, show the corrected request, and tell
me how to confirm the fix in the browser's Network tab.
```

```text
I'm paused on a breakpoint in a Dynamics 365 form script. In scope I
have formContext and result (from Xrm.WebApi.retrieveMultipleRecords).
Give me Console one-liners to: read three column values, list the
returned rows as a table, and check whether the current record's id
is among the returned rows.
```

```text
A Dynamics 365 form script works for me but not for one user. List the
causes in order of likelihood (security, form, data, cache, browser),
and for each one, the exact tool and step to confirm it: DevTools
Network or Sources, Live monitor, or URL flags.
```

### Where AI goes wrong here

- It suggests `alert()` and `debugger;` statements, which means changing and redeploying code. Ask for a breakpoint or logpoint approach instead.
- It invents URL flags and Monitor features. Check every flag name against Microsoft Learn before you rely on it.
- It assumes the request reached the server. It can't tell a cached file from a fresh one, or one form from another. Only the Network tab and Live monitor can.
- It guesses logical names. Check them in the table's Columns list, or with a quick Web API call in the address bar.

## The "observe first" checklist

- [ ] **Value wrong?** Breakpoint in the callback, read Scope and Watch.
- [ ] **Testing an idea?** Pause, then try it in the Console, in the right frame.
- [ ] **Nothing happens?** Network tab, filter by your table, read the Response of any red row.
- [ ] **Whose script?** `&flags=DisableFormHandlers=true`, then narrow down by index.
- [ ] **What's registered?** `&monitor=true`, Live monitor, filter `FormEvents`.
- [ ] **Old behaviour?** Size column says (ServiceWorker) or memory/disk cache? Hard refresh, or Application > Service workers > Bypass for network, then confirm in Sources.
- [ ] **Every log message** starts with the project prefix, and every error callback logs something.

## Interview questions, with the answers that land

**1. A form script shows the wrong value. How do you debug it?**

I don't change code first. I set a breakpoint where the value is used, refresh, and read it in Scope or Watch. If it comes from a Web API call, I put the breakpoint inside the callback and look at what the query actually returned.

**2. A Web API call in a form script fails, but there's no error on screen. How do you find out why?**

The error callback probably only logs to the Console. I open the Network tab, filter by the table's entity set name, find the red request and read the Response, which gives the exact Dataverse error. Then I make the code show a notification, so it's never silent again.

**3. How do you find out whether a form problem is caused by your script or someone else's?**

URL flags. I open the form with `&flags=DisableFormHandlers=true`. If the problem disappears, it's a handler, and I switch them off one index at a time. I get the indexes from Live monitor's FormEvents operation.

**4. What is Live monitor used for in a model-driven app?**

To see what the app actually did: which form events and handlers were registered and started, the network calls, and FormChecker messages. You can also invite a colleague or connect to a user's session, to troubleshoot a problem that only happens for them.

**5. How do you prove a user is running an old version of your script?**

In the Network tab, the file's Size column shows (ServiceWorker) or a cache instead of a download, and the code in Sources doesn't match what was published. A detail many people miss: model-driven apps use a service worker, and DevTools' Disable cache doesn't bypass it. The fix is a hard refresh, and for me while developing, Bypass for network under Application > Service workers.

**6. What's a logpoint, and why is it useful in production?**

A breakpoint that prints a message instead of stopping. You add it in DevTools without changing or deploying the code, so you can see values in an environment where you can't release debug code.

## Rule of thumb

**Ask the question first, then open the tool that answers it. If you're changing code to find a bug, you haven't looked yet.**

## Next in the series

**Part 3: formContext in depth.** Columns, controls, tabs and sections: reading and setting values the right way, and the classic `Cannot read properties of null` from every angle.
