---
title: "Dynamics 365 JavaScript, Part 1: Your First Web Resource"
description: "Writing CRM JavaScript is easy. Finding out why it didn't run is the job. Build your first web resource the production way, then break it six ways and learn to debug each one."
series: dynamics-365-javascript
part: 1
pubDate: 2026-11-25
cover: /covers/js-part1.png
tags: [Dynamics 365, JavaScript, Dataverse, Power Apps, Debugging]
---

*Part 1 of my new series, Dynamics 365 JavaScript, from Basics to Production. Every part builds working code, then breaks it on purpose the way it really breaks in projects, and shows you how to debug and fix it.*

> **Writing CRM JavaScript is easy. Finding out why it didn't run is the job.**

## The scenario: the script that never ran

The lending bank from my Real-World Series wants one small thing on the Loan Application form: when an officer opens a loan, show a yellow banner if the applicant's PAN hasn't been verified.

A new developer, Arjun, gets the task on Monday morning. He writes four lines of JavaScript, uploads them, refreshes the form, and nothing happens. No banner. No error. Nothing.

By Tuesday he has tried:

1. Uploading the file again.
2. Clearing the browser cache.
3. Copying a different script from a blog, which uses `Xrm.Page` and shows a red error dialog instead.
4. Asking in the team chat, where someone says "did you publish?" (he had, but only the web resource, not the form).

Arjun's code was fine. **Every problem was in how the script was created, attached and called.** That's what this first part is about, because every later part of the series depends on getting this right, and on knowing how to prove where it broke.

By the end of this part you'll be able to:

- create a JavaScript web resource the way production teams do,
- attach it to a form and call it with the execution context,
- break it in the six ways it most often breaks, recognise each from the error (or the silence), and fix it,
- debug any "my script didn't run" problem in under five minutes.

## The thought shift

Most tutorials teach JavaScript in Dynamics 365 as "write a function, paste it in". So when it fails, people look at the function.

In practice, a form script is a **chain of five links**, and any one of them can break silently:

1. **The file** exists as a web resource, and is published.
2. **The library** is added to this specific form.
3. **The handler** is registered on the right event, with the right function name, and the right checkbox.
4. **The browser** has loaded the new version, not a cached old one.
5. **The code** runs, and doesn't throw.

When "nothing happens", check the links in that order. The code is the **last** suspect, not the first.

## The concepts in simple words

| Term | In plain words | Where you see it |
| --- | --- | --- |
| **Web resource** | A file stored inside Dataverse: JavaScript, HTML, CSS, images | Solution > Web resources |
| **Form library** | A web resource that a form loads when it opens | Form designer > Form libraries |
| **Event handler** | "When this event happens, call this function from that library" | Form designer > Events |
| **Form events** | OnLoad (form opens), OnChange (a column changes), OnSave (form saves) | Form, column and form-save events |
| **Execution context** | An object Dataverse passes to your function, describing what just happened | Your function's first parameter |
| **formContext** | The form itself: its columns, controls, tabs, notifications | `executionContext.getFormContext()` |
| **Namespace** | One global object that holds all your functions, so names never clash | `var LoanHub = window.LoanHub \|\| {};` |

### Why `executionContext` and not `Xrm.Page`

`Xrm.Page` assumed there was exactly one form on the screen. Modern model-driven apps can show a main form, a quick create form, a side pane and a dialog at the same time. `Xrm.Page` can't tell them apart. `executionContext.getFormContext()` always gives you the form that **raised the event**. That's why the checkbox **"Pass execution context as first parameter"** matters so much: without it, your function receives nothing useful.

### Why a namespace

Every form loads all its libraries into the same browser window. If two scripts both declare `function onLoad()`, the last one loaded wins, and the other script silently calls the wrong function. Wrapping everything in one object, such as `LoanHub.LoanApplication`, makes each function name unique.

## Build it: your first web resource, step by step

**Requirement:** when a Loan Application opens and **PAN Verified** is No, show a yellow banner: "PAN not verified yet. Verify before moving to Credit assessment."

### Step 1: write the file

Create `loanapplication.js` on your machine:

```javascript
// Web resource: new_/js/loanapplication.js
// Table: Loan Application (new_loanapplication)
var LoanHub = window.LoanHub || {};

LoanHub.LoanApplication = (function () {
    "use strict";

    var BANNER_ID = "pan-not-verified";

    // Registered on Form OnLoad with "Pass execution context as first parameter" ticked
    function onLoad(executionContext) {
        var formContext = executionContext.getFormContext();
        var panVerified = formContext.getAttribute("new_panverified");

        if (!panVerified) {
            // The column isn't on this form: do nothing, but say so for whoever debugs
            console.warn("LoanHub.LoanApplication.onLoad: new_panverified is not on this form");
            return;
        }

        if (panVerified.getValue() !== true) {
            formContext.ui.setFormNotification(
                "PAN not verified yet. Verify before moving to Credit assessment.",
                "WARNING",
                BANNER_ID);
        } else {
            formContext.ui.clearFormNotification(BANNER_ID);
        }
    }

    return {
        onLoad: onLoad
    };
})();
```

**What each part does:**

- `var LoanHub = window.LoanHub || {};` creates the namespace once, and reuses it if another LoanHub file already created it.
- The `(function () { ... })()` wrapper keeps `BANNER_ID` and helper functions private. Only what's in `return { ... }` is visible to the form.
- `"use strict"` turns silent mistakes (like a typo creating a new global variable) into errors you can see.
- `getAttribute` returns **null** if the column isn't on this form. The guard turns a crash into a clear console message.
- The notification has a **unique ID**, so the same function can clear it later.

### Step 2: create the web resource

1. In Power Apps, open your solution (never the Default solution).
2. Select **New > More > Web resource**.
3. **Display name:** Loan Application scripts. **Name:** `new_/js/loanapplication.js` (the prefix comes from your publisher; the folder-style name keeps web resources organised).
4. **Type:** JavaScript (JS). Upload the file.
5. **Save**, then **Publish**.

### Step 3: add it to the form and register the handler

1. Open the **Loan Application** main form in the form designer.
2. In the left pane, open **Form libraries > Add library**, find `new_/js/loanapplication.js`, and add it.
3. Open **Events** (with the form itself selected, not a field) > **On Load** > **Add event handler**.
4. **Library:** `new_/js/loanapplication.js`. **Function:** `LoanHub.LoanApplication.onLoad` (exactly, including the namespace; no brackets).
5. Tick **Enabled** and **Pass execution context as first parameter**.
6. **Save and publish** the form.

### Step 4: see it run

1. Open the app and a loan with PAN Verified = No.
2. Do a hard refresh (Ctrl+F5) the first time, so the browser fetches the new file.
3. You should see the yellow banner at the top of the form.

### Step 5: prove it ran (before anything goes wrong)

Get into the habit now, while it works:

1. Press **F12** to open DevTools, go to **Sources**, and press **Ctrl+P**.
2. Type `loanapplication` and open the file. If you can find it, **the library loaded**.

   ![DevTools Sources tab with loanapplication.js open, next to the Loan Application form showing the PAN banner](/images/js-part1-sources.png)
3. Click the line number next to `var formContext = ...` to set a **breakpoint**.
4. Refresh the form. Execution stops on your line: **the handler is registered and called**.

   ![Paused on breakpoint at line 12: Scope shows executionContext set and formContext still undefined](/images/js-part1-breakpoint.png)

   Look at **Scope** on the right: `executionContext` has a value, while `formContext` and `panVerified` are still `undefined`, because line 12 hasn't run yet.
5. Hover over `panVerified` to see its value, then press **F8** to continue.

Those five steps check four of the five links in the chain. You'll use them in every part of this series.

## Break it, debug it, fix it

Now we break the working script on purpose, six ways. Each one is a real failure from real projects. For each: what you see, how to find the cause in minutes, the fix, and the habit that prevents it.

| # | What you broke | What you see | Link in the chain |
| --- | --- | --- | --- |
| 1 | Typo in the function name | Script Error; Show Details says "Web resource method does not exist" | 3. The handler |
| 2 | Forgot "Pass execution context" | Script Error: cannot read properties of undefined | 3. The handler |
| 3 | Library on a different form | Nothing at all | 2. The library |
| 4 | Old version still cached | Your fix "doesn't work" | 4. The browser |
| 5 | Column not on this form | Script Error: cannot read properties of null | 5. The code |
| 6 | A syntax error in the file | Every handler from that file fails | 1. The file |

### Break 1: a typo in the function name

**Break it:** in the event handler, type `LoanHub.LoanApplicaton.onLoad` (missing an "i").

**What you see:** when the form opens, a **Script Error** dialog says only *"One of the scripts for this record has caused an error."* The real message is hidden: select **Show Details** and you'll see something like:

> Web resource method does not exist: LoanHub.LoanApplicaton.onLoad. However the closest object we found is LoanHub that contains these properties: LoanApplication.

Below it are the **Event Name**, **Function Name** and **Web Resource Name**. Always open Show Details first; the summary line never tells you what broke.

**Debug it:**

1. Read the details carefully: the function name it prints is the name **in the registration**, not in your file. Here Dataverse even points at the fix: the closest object is `LoanHub`, and it has a property called `LoanApplication`.
2. Open DevTools (F12) > **Console**. Form scripts don't run in the main page: they run inside hidden frames (their ids start with `ClientApiFrame_`). In the Console's context dropdown (top-left, it says `top` by default) these frames are listed as **id-NN (blank.htm)**, and the number changes on every page load. Pick each **blank.htm** entry in turn until the next step works. Shortcut: while execution is paused on a breakpoint in your file, the Console switches to your script's frame automatically.
3. Type `LoanHub.LoanApplication` and press Enter. If you see `{onLoad: ƒ}`, the file is fine and the registration is wrong. In the `top` context you'll get `undefined` even when everything works, which is why the frame matters.

**Fix it:** correct the function name in the form's event handler, save and publish the form.

**Prevent it:** copy the function name from the code (namespace included) instead of typing it, and keep one naming pattern: `Publisher.Table.function`.

### Break 2: "Pass execution context as first parameter" not ticked

**Break it:** edit the handler and untick the checkbox.

**What you see:** the same Script Error summary. Under **Show Details**: **Cannot read properties of undefined (reading 'getFormContext')**, with the function and web resource names below it.

**Debug it:**

1. Set a breakpoint on the first line of `onLoad` (Sources > Ctrl+P > `loanapplication`).
2. Refresh. When it stops, hover `executionContext`: it's **undefined**.
3. That means Dataverse called your function but passed nothing.

**Fix it:** tick the checkbox, save and publish the form.

**Prevent it:** add a first-line guard in every handler while you develop: `if (!executionContext) { console.error("No execution context: check the handler registration"); return; }`.

### Break 3: the library is on a different form

**Break it:** the table has two main forms, "Loan Officer" and "Information". You add the library and handler to "Information", but officers open "Loan Officer".

**What you see:** nothing. No banner, no error.

**Debug it:**

1. Check which form is open: the form name shows at the top of the record (and in the form selector if the user has more than one).
2. DevTools > Sources > Ctrl+P > `loanapplication`. If the file **isn't listed**, this form didn't load the library.

**Fix it:** add the library and handler to every form that needs them (including quick create forms, if they need the logic).

**Prevent it:** when you add a script, list every form of the table and decide for each one. Remember Part 5 of the Real-World Series: users see the first form their role allows, which may not be the one you edited.

### Break 4: the browser is running the old version

**Break it:** change the banner text, upload the file, publish, and refresh normally.

**What you see:** the old text. Your fix "doesn't work".

**Debug it:**

1. DevTools > Sources > open `loanapplication.js`. Look at the code there: is it your new text?
2. If not, the browser used a cached copy.

**Fix it:** confirm the web resource was **published**, then hard refresh (Ctrl+F5). While developing, keep DevTools open with **Network > Disable cache** ticked.

**It's not only the file that gets cached.** The **form definition** is cached too: the list of libraries and handlers, and settings such as "Pass execution context". When I tested this series, a fixed and published handler kept failing with the old function name after a normal refresh. A hard refresh (Ctrl+Shift+R) picked up the change straight away.

**Prevent it:** after every upload or form change, hard refresh, then check the code in the Sources tab before testing. It takes five seconds and saves hours of fixing code that was never running.

### Break 5: the column isn't on this form

**Break it:** remove the guard and write `formContext.getAttribute("new_panverified").getValue()`. Then remove the PAN Verified column from the form.

**What you see:** a Script Error saying it **cannot read properties of null (reading 'getValue')**.

**Debug it:**

1. The error's details include the file and line number. Open that line in Sources.
2. Set a breakpoint, refresh, and hover the `getAttribute(...)` call: it returns **null**.
3. `getAttribute` returns null when the column isn't on the form, or when the logical name is misspelled (`new_panverfied`).

**Fix it:** put the column back on the form (it can be hidden), or keep the guard and handle the missing column.

**Prevent it:** never chain a method straight onto `getAttribute` or `getControl`. Check for null first, every time.

### Break 6: a syntax error in the file

**Break it:** delete one closing bracket and upload.

**What you see:** "method does not exist" for **every** handler from that file, even ones you didn't touch.

**Debug it:**

1. DevTools > **Console**: a red **SyntaxError** names the file and line.
2. Because the file failed to parse, `LoanHub.LoanApplication` was never created, so every function in it "does not exist".

**Fix it:** fix the syntax, upload, publish, hard refresh.

**Prevent it:** check the file before uploading. Open it in an editor with JavaScript checking turned on (VS Code does this out of the box), or paste it into the browser console to see if it parses.

## Day 2: what goes wrong after go-live

The six breaks above happen on your machine. These happen in test and production, usually reported as "the form is broken".

### 1. "It works in dev, but not in test"

**What you see:** the banner appears in development. After deploying the solution to test, nothing.

**Why it happens:** the form was changed in dev, but the **form** wasn't in the solution, only the web resource. Or the solution was imported and not published.

**How to handle it:**

1. Open the form in test and check **Form libraries** and **Events**. If they're missing, the form didn't travel.
2. Add the **form** (not just the table's web resource) to the solution, export and import again, then publish.
3. Add "form libraries and handlers present" to your deployment checklist.

### 2. Two scripts, one function name

**What you see:** after another team adds their script to the same form, your banner stops appearing, or shows on the wrong records.

**Why it happens:** both scripts declared a global `function onLoad()`. The last one loaded replaced the other.

**How to handle it:** move every function into a namespace (`LoanHub.LoanApplication.onLoad`), and agree one namespace per publisher across teams.

### 3. The script works for admins but not for users

**What you see:** the same form, the same record, and the script fails only for loan officers.

**Why it happens:** the script reads data the user can't see (a related record, a secured column), or the user gets a different form than the admin does.

**How to handle it:**

1. Reproduce with a test user in the same role. Testing as an admin hides the problem.
2. Check the Network tab for failed calls (403 means a privilege is missing) and check which form the user gets.
3. Fix the role or the form order, or make the script handle "no access" gracefully.

### 4. "The banner disappeared after the upgrade"

**What you see:** an old script using `Xrm.Page` starts behaving oddly after a platform update, or fails on quick create and in side panes.

**Why it happens:** `Xrm.Page` is deprecated. It assumes one form on the page, which modern apps no longer guarantee.

**How to handle it:** refactor each handler to accept `executionContext` and use `getFormContext()`. Do it form by form, testing each.

### 5. The form became slow after adding "just one script"

**What you see:** users say the loan form takes longer to open.

**Why it happens:** OnLoad scripts run while the form loads. Heavy work there, especially requests one after another, delays the whole form.

**How to handle it:** keep OnLoad light (show, hide, notify); load extra data asynchronously; measure with the Network tab and with Monitor (`&monitor=true` on the app URL). Part 8 of this series covers async in depth.

### 6. A user reports a Script Error you can't reproduce

**What you see:** a screenshot of a Script Error from one user, on one record.

**Why it happens:** almost always data: an empty column, a lookup with no value, a record in a state your code didn't expect.

**How to handle it:**

1. Ask for the record and the time, or for the error's details (the dialog lets the user see and copy them).
2. Open the same record yourself, with the same role, and set a breakpoint where the error points.
3. Fix the code to handle that data, not just the one record.

## Using AI with your first web resource

AI is genuinely useful here, as long as you treat it like a fast junior developer whose work you check.

### Where it helps

- **Writing the skeleton:** namespace, `"use strict"`, the handler signature, null guards.
- **Explaining an error:** paste the Script Error details and the line it points to, and ask what could cause it.
- **Reviewing old scripts:** paste a legacy file and ask it to list every `Xrm.Page` use and missing null check.

### Prompts that work (copy and adapt)

```text
Write a Dynamics 365 model-driven app form script in plain JavaScript
(no TypeScript, no Xrm.Page). Use the namespace LoanHub.LoanApplication
and executionContext.getFormContext(). On form load, if the column
new_panverified is not true, show a WARNING form notification with a
unique ID; otherwise clear it. Guard against the column not being on
the form. Tell me exactly how to register the handler.
```

```text
This Dynamics 365 form script shows a Script Error: "<paste the error
details>". Here is the code: <paste>. And here is the handler
registration: library <name>, function <name>, pass execution context
<yes/no>. List the possible causes in order of likelihood, and how to
confirm each one in the browser's DevTools.
```

```text
Review this legacy Dynamics 365 form script. List every use of
Xrm.Page, every getAttribute or getControl call without a null check,
every global function outside a namespace, and every synchronous
request. Then rewrite it with a namespace and executionContext.
```

### Where AI goes wrong here

- It still writes **`Xrm.Page`** often, because so much old sample code online uses it. Always say "no Xrm.Page".
- It **invents logical names**: `panverified`, `new_PanVerified`. Logical names are lowercase and include your prefix; check every one against the table.
- It **forgets the registration**. A perfect function with the wrong handler settings still does nothing. Ask it for the exact registration steps and check them against Step 3.
- It **can't see your environment**. It doesn't know which form users get, what's cached, or what's published. The five-link chain is still your job.

## The five-minute "my script didn't run" checklist

- [ ] **The file:** is the web resource published? Does Sources show your latest code?
- [ ] **The library:** is it on **this** form (the one the user actually gets)?
- [ ] **The handler:** right event, function name copied exactly (with namespace), **Enabled** and **Pass execution context** ticked, form published?
- [ ] **The browser:** hard refresh (Ctrl+Shift+R) after every upload or form change, or Disable cache ticked?
- [ ] **The code:** a breakpoint on the first line is hit? Any red errors in the Console?

## Interview questions, with the answers that land

**1. Why use `executionContext.getFormContext()` instead of `Xrm.Page`?**

`Xrm.Page` is deprecated and assumes one form on the page. A model-driven app can show a main form, quick create and side panes at once. `getFormContext()` returns the form that raised the event, so the code acts on the right one.

**2. A form script "does nothing". How do you debug it?**

I check the chain in order: the web resource is published, the library is on the form the user actually gets, the handler is registered with the exact function name and the execution context checkbox, the browser has the new version, and then the code itself, with a breakpoint on its first line.

**3. What does "web resource method does not exist" mean?**

The form called a function name that isn't defined when the library loads. Either the name in the registration is wrong, or the file failed to load or parse, so the namespace was never created.

**4. Why wrap functions in a namespace?**

All libraries on a form share one browser window. Global function names can collide, and the last one loaded wins. A namespace makes every function name unique.

**5. Why does `getAttribute` return null?**

The column isn't on the current form, or the logical name is wrong. Code must check for null before calling methods on it.

## Rule of thumb

**When a script "doesn't run", check the file, the library, the handler and the browser before you touch the code.**

## Next in the series

**Part 2: The CRM debugging toolkit.** Everything we used today in passing (Sources, breakpoints, the Console context, the Network tab, URL flags, Monitor, caching) properly, with a lab for each.
