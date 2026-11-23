---
title: "Where Should Logic Live? Business Rules and JavaScript"
description: "Your validation works on the form, then an Excel import lets 2,000 bad records in. The form side of the logic question: business rules and scope, JavaScript done properly, how each breaks in production, and how to debug it."
series: dynamics-365-real-world
part: 3
label: "Part 3A"
pubDate: 2026-11-13
cover: /covers/rw-part3a.png
tags: [Business Rules, JavaScript, Dynamics 365]
linkedin: "https://www.linkedin.com/feed/update/urn:li:share:7526867859302453248"
---

*Part 3A of my Dynamics 365 Real-World Series. Parts 1 and 2 built the data model and the security model for a lending bank. Now the rules: where should each piece of logic live? This part covers the form side. Part 3B covers the server side.*

> **If a rule only holds on the form, it's a suggestion, not a rule.**

## The scenario: perfect on the form, broken in the table

The bank has three rules for loan applications:

1. Loans above **₹25 lakh** need a co-applicant.
2. The applicant's **PAN** must be in the valid format (5 letters, 4 digits, 1 letter).
3. The **Guarantor** section should only appear for Business loans.

The developer builds all three on the form. Testing goes well: try to save a ₹30 lakh loan without a co-applicant, and the form stops you.

Two weeks after go-live, the data team imports 2,000 historical loans from Excel. Then the credit bureau integration starts creating applications through the Web API. A month later, a report shows:

- 312 loans above ₹25 lakh with no co-applicant.
- 87 PANs like `ABCD1234` and `pan pending`.

Nothing was broken. **The rules were only ever on the form, and imports and integrations never open a form.**

## The thought shift

For every rule, ask one question before choosing a tool:

**"Does this rule have to hold however the data arrives?"**

- **No, it only helps the person typing.** (Show a field, give a hint, pre-fill a value.) → Form logic is perfect.
- **Yes, the data must never be wrong.** (Required co-applicant above ₹25 lakh, valid PAN.) → The rule needs a server-side guard. The form can still give a nicer experience on top, but it can't be the only check.

Think of a bank branch. A **business rule** is the sign at the counter. **JavaScript** is the assistant at the counter. Both help people who walk in through the front door, which is the form. **Plugins** and **Power Automate** work in the vault and the back office. That's Part 3B.

## The concepts in simple words

### Business rules

If-then logic built in a visual designer, with no code.

| They can | They can't |
| --- | --- |
| Show or hide a field | Show or hide a **tab or section** |
| Enable or disable (lock) a field | Read columns from **other tables** |
| Set a field value, clear it, set a default | Call an API or a flow |
| Make a field required or optional | Run on events other than load and change |
| Show an error message on a field | Loop over related records |
| Show a recommendation | |

### Scope: the setting most people miss

| Scope | Where it runs | What reaches imports and the API |
| --- | --- | --- |
| A specific form | Only in the browser, on that form | Nothing |
| All Forms | Only in the browser, on every form of the table | Nothing |
| **Entity** (Table) | In the browser **and on the server** | Error messages and set values. Show/hide, lock and required are form-only effects |

So "make Co-applicant required" with Entity scope still doesn't stop an import. "Show an error message when Amount > 25 lakh and Co-applicant is empty" with Entity scope **does**.

### JavaScript

Code you upload as a **web resource** and register on form events:

- **OnLoad:** the form opens.
- **OnChange:** a column's value changes.
- **OnSave:** the user (or autosave) saves.

It gives the best user experience: instant feedback, hiding whole sections, reading related data, calling APIs. And it's subject to the same limit as business rules: **it only runs where a form runs.**

## Implementation 1: the co-applicant rule as a business rule, with the right scope

**Steps:**

1. Open the Loan Application table, select **Business rules > New business rule**.
2. Condition: **Loan Amount** is greater than **2500000**.
3. If true:
    - **Show** Co-applicant.
    - **Set business required** on Co-applicant.
4. Add a second condition inside the true branch: Co-applicant **does not contain data**. If true: **Show error message** on Co-applicant: "Loans above ₹25 lakh need a co-applicant."
5. If false (amount ≤ ₹25 lakh): **Hide** Co-applicant and set it **Not business required**.
6. Set **Scope** to **Entity**.
7. Save, **Validate**, then **Activate**.

**What you now get:**

- On the form: the field appears, becomes required, and an error shows if it's empty.
- On import or API: the error message is enforced on the server, so the bad row fails with that message.

**Still recommended:** a plugin for the same rule (Part 3B), because business rules have limits (no access to other tables, harder to version and test), and compliance rules deserve code you can test.

## Implementation 2: PAN validation in JavaScript

The business rule can't check a format. JavaScript can, instantly, as the user leaves the field.

**Step 1: the web resource**

```javascript
// Web resource: new_/js/loanapplication.validation.js
var LoanHub = window.LoanHub || {};
LoanHub.Validation = (function () {
    "use strict";

    var PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

    // Register on OnChange of new_pan, with "Pass execution context" ticked
    function onPanChange(executionContext) {
        var formContext = executionContext.getFormContext();
        var attr = formContext.getAttribute("new_pan");
        var control = formContext.getControl("new_pan");
        if (!attr || !control) { return; }          // field removed from this form

        var value = (attr.getValue() || "").trim().toUpperCase();
        attr.setValue(value || null);                // normalise case and spaces

        if (value && !PAN_PATTERN.test(value)) {
            control.setNotification("PAN must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).", "pan-format");
        } else {
            control.clearNotification("pan-format");
        }
    }

    // Register on OnSave, with "Pass execution context" ticked
    function onSave(executionContext) {
        var formContext = executionContext.getFormContext();
        var attr = formContext.getAttribute("new_pan");
        var value = attr && attr.getValue();
        if (value && !PAN_PATTERN.test(value)) {
            executionContext.getEventArgs().preventDefault();   // stop this save
            formContext.ui.setFormNotification("Fix the PAN format before saving.", "ERROR", "pan-save");
        } else {
            formContext.ui.clearFormNotification("pan-save");
        }
    }

    return { onPanChange: onPanChange, onSave: onSave };
})();
```

**Step 2: register it**

1. Create the web resource (type **Script (JScript)**), upload the file, save and publish.
2. On the Loan Application main form: **Form libraries > Add library**.
3. Select the PAN column, **Events > On change**: function `LoanHub.Validation.onPanChange`, tick **Pass execution context as first parameter**.
4. **Form > Events > On Save**: function `LoanHub.Validation.onSave`, tick the same box.
5. Save and publish the form.

**What the code shows about doing JavaScript properly:**

- `executionContext.getFormContext()`, never the deprecated `Xrm.Page`.
- A **namespace** (`LoanHub.Validation`), so functions don't collide with other scripts.
- A **null check** for the attribute and control, because the field might not be on every form.
- Field notifications with **unique IDs**, so they can be cleared precisely.
- `preventDefault()` in OnSave stops this save only. The same PAN check still needs to exist on the server (Part 3B).

## Implementation 3: show the Guarantor section only for Business loans

Business rules can't hide sections. JavaScript can.

```javascript
LoanHub.Layout = (function () {
    "use strict";
    var PURPOSE_BUSINESS = 100000003;   // check the value in your choice column

    function toggleGuarantor(formContext) {
        var purpose = formContext.getAttribute("new_purpose");
        var tab = formContext.ui.tabs.get("tab_general");
        var section = tab && tab.sections.get("section_guarantor");
        if (!purpose || !section) { return; }
        section.setVisible(purpose.getValue() === PURPOSE_BUSINESS);
    }

    function onLoad(executionContext) {
        var formContext = executionContext.getFormContext();
        toggleGuarantor(formContext);
        formContext.getAttribute("new_purpose")?.addOnChange(function (ctx) {
            toggleGuarantor(ctx.getFormContext());
        });
    }

    return { onLoad: onLoad };
})();
```

Register `LoanHub.Layout.onLoad` on the form's OnLoad. Attaching the OnChange handler in code keeps the registration in one place.

**Remember:** hiding the section is presentation only. The Guarantor rows are still there in views and the API, which is fine, because this isn't a security rule.

## Implementation 4: reading related data without freezing the form

Requirement: when the user picks a Loan Product, show its maximum tenure as a hint.

```javascript
LoanHub.Product = (function () {
    "use strict";

    async function onProductChange(executionContext) {
        var formContext = executionContext.getFormContext();
        var lookup = formContext.getAttribute("new_loanproduct")?.getValue();
        var tenure = formContext.getControl("new_tenuremonths");
        if (!tenure) { return; }
        tenure.clearNotification("max-tenure");
        if (!lookup || !lookup.length) { return; }

        try {
            var id = lookup[0].id.replace(/[{}]/g, "");
            var product = await Xrm.WebApi.retrieveRecord("new_loanproduct", id, "?$select=new_maxtenuremonths");
            if (product.new_maxtenuremonths) {
                tenure.setNotification("Maximum for this product: " + product.new_maxtenuremonths + " months.", "max-tenure");
            }
        } catch (e) {
            console.error("LoanHub.Product: could not read product", e);
        }
    }

    return { onProductChange: onProductChange };
})();
```

`Xrm.WebApi` is **asynchronous**: the form stays responsive while the request runs. Old scripts using synchronous `XMLHttpRequest` freeze the browser for every call.

## Day 2: what actually goes wrong in production

### 1. "Also hide the Guarantor section"

**What you see:** the business rule designer has no option for sections.

**Why it happens:** business rules work on fields, not on tabs or sections.

**How to handle it:** use JavaScript (`section.setVisible`), as in Implementation 3. Keep simple field rules in business rules, and move to JavaScript only when you hit a limit.

### 2. Co-applicant is required on the form, but empty after an import

**What you see:** the form never allows it, yet the table has hundreds of loans without a co-applicant.

**Why it happens:** "Set business required" is a form behaviour. Imports and the API don't open the form.

**How to handle it:**

1. Change the rule to **Entity** scope with an **error message** condition (Implementation 1), or
2. Add a plugin that rejects the save (Part 3B).
3. Clean up the existing bad rows with a report and a correction plan.

### 3. The form rejects bad PANs, but the table is full of them

**What you see:** users can't enter a bad PAN, but the integration did.

**Why it happens:** the integration uses the Web API, so the JavaScript never ran.

**How to handle it:** put the same check in a plugin, keep the JavaScript for instant feedback, and keep the pattern in one place in each (a constant) so they don't drift apart.

### 4. A field is removed from the form, and every load shows a script error

**What you see:** "Cannot read properties of null (reading 'getValue')" when the form opens.

**Why it happens:** `getAttribute("new_pan")` returns **null** when the column isn't on the form, and the script calls a method on null.

**How to handle it:**

1. Guard every `getAttribute` and `getControl` call, as in the examples.
2. Before removing a field, search your scripts and business rules for its logical name.

### 5. Old scripts still use Xrm.Page

**What you see:** scripts that work today, written years ago with `Xrm.Page.getAttribute(...)`.

**Why it happens:** `Xrm.Page` was the old way to reach the form. It's deprecated.

**How to handle it:** refactor to take `executionContext` as the first parameter and use `getFormContext()`. Do it table by table, testing each form.

### 6. The form freezes for a few seconds on load

**What you see:** the form opens, then the browser stops responding briefly.

**Why it happens:** usually a **synchronous** request in an OnLoad script, or many requests one after another.

**How to handle it:**

1. Use `Xrm.WebApi` (async) and `await`, never synchronous `XMLHttpRequest`.
2. Load only the columns you need with `$select`.
3. Measure with the browser's Network tab and the form Monitor (see the debugging section).

### 7. A business rule and a script fight over the same field

**What you see:** a field flickers between visible and hidden, or a value set by script is overwritten.

**Why it happens:** two pieces of logic own the same field, and they run at different moments.

**How to handle it:** decide **one owner per field**. If the logic outgrew the business rule, move all of it to JavaScript and deactivate the rule.

## How to debug form logic

1. **Is it running at all?** Open the browser's DevTools (F12), go to **Sources**, find your web resource, and add a breakpoint. Or add `debugger;` temporarily.
2. **Is it something else on the form?** Add `&flags=DisableFormHandlers=true` to the app URL. This turns off form event handlers, including business rules, for your session only. If the problem disappears, it's form logic.
3. **Which handler ran, and in what order?** Add `&monitor=true` to the URL and open **Monitor**. It shows form events, handlers, business rules and timings.
4. **Is the data right?** Check the Network tab for Web API calls and their responses.
5. **Is it cached?** After publishing a web resource, do a hard refresh. A cached old version is a common "my fix didn't work".

## Using AI with business rules and JavaScript

### AI to write the first draft

```text
Write a Dynamics 365 model-driven app form script in plain JavaScript
(no TypeScript, no Xrm.Page). Use a namespace LoanHub.Validation and
executionContext.getFormContext(). On change of new_pan, normalise to
upper case, validate /^[A-Z]{5}[0-9]{4}[A-Z]$/, and show a field
notification. Guard against the field not being on the form.
```

### AI as a reviewer

```text
Review this Dynamics 365 form script. List: uses of deprecated APIs,
missing null checks, synchronous requests, notifications that are
never cleared, and any rule that must also be enforced on the server.
```

### Where AI goes wrong here

- It still writes `Xrm.Page` often, because so much old sample code uses it.
- It invents logical names (`pan` instead of `new_pan`) and choice values. Check every name against your table.
- It treats form validation as enough. Always ask it: "how does this rule hold for imports and the API?"

## Checklist

- [ ] Each rule classified: form help only, or must hold everywhere
- [ ] Rules that must hold everywhere also have a server-side guard
- [ ] Business rules with server effects use **Entity** scope and error messages
- [ ] JavaScript in a namespace, using `getFormContext()`, no `Xrm.Page`
- [ ] Every `getAttribute`/`getControl` guarded for null
- [ ] Only async calls (`Xrm.WebApi`), with `$select`
- [ ] One owner per field: business rule or script, not both
- [ ] Tested on every form of the table, and through an import

## Interview questions, with the answers that land

**1. What changes when a business rule's scope is Entity instead of All Forms?**

With Entity scope the rule also runs on the server, so its error messages and set-value actions apply to imports and API calls. Show, hide, lock and required are still form-only effects.

**2. Why isn't JavaScript validation enough for a compliance rule?**

JavaScript only runs in a form. Imports, flows, integrations and the Web API never load one, so the rule needs a server-side guard such as a plugin.

**3. Why does getAttribute sometimes return null?**

Because the column isn't on the current form. Scripts must check for null before calling methods on it.

**4. How do you stop a save from JavaScript?**

In an OnSave handler registered with the execution context, call `executionContext.getEventArgs().preventDefault()` and show a notification explaining why.

**5. A form freezes on load. What do you check first?**

Synchronous requests in OnLoad scripts. I'd switch them to `Xrm.WebApi` with async/await and `$select`, then measure with the Network tab and Monitor.

## Rule of thumb

**Start with a business rule, move to JavaScript when you hit a limit, and never rely on either one alone for data that has to stay clean.**

**Next:** Part 3B, the server side. Plugins and Power Automate.
