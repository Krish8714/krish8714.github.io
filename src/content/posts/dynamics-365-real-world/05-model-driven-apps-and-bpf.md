---
title: "Model-Driven Apps and Business Process Flows"
description: "Your BPF works perfectly for you, then 300 loan officers log in and half can't see it. Apps shaped by role, views, forms, a BPF with a branch, JavaScript for commands and stages, and seven production problems."
series: dynamics-365-real-world
part: 6
label: "Part 5"
pubDate: 2026-11-23
cover: /covers/rw-part5.png
tags: [Model-driven Apps, Business Process Flows, JavaScript, Dynamics 365]
linkedin: "https://www.linkedin.com/pulse/dynamics-365-real-world-series-part-5-model-driven-apps-ithakota-dawwf/"
---

*Part 5 of my Dynamics 365 Real-World Series. Parts 1 to 4 built the data model, the security model and the business logic for a lending bank. Today: the layer people actually touch every day, and the one that decides whether they use the system at all.*

> **A model-driven app is not a set of screens. It is the shape of someone's working day.**

## The scenario: 300 loan officers, back on Excel

The bank goes live with Dynamics 365 for 300 loan officers in 25 branches. The data model is clean. Security is right: officers see their branch, managers see their region. Plugins block bad loans on every path.

Three weeks later, the Hyderabad branch manager sends the project team this list:

1. "Creating one loan means 4 tabs and 60 fields. My officers use about 20 of them."
2. "I can't see which loans are stuck waiting for documents. I keep an Excel sheet for that."
3. "New joiners don't know what comes after Verification, so they call me for every loan."
4. "To send a loan for approval, they change a Status field and save. Half the time they pick the wrong status."
5. "Some officers can't see the progress bar at the top of the loan. Admins can."
6. "The manager's dashboard and the officer's screens are the same app, so everyone sees everything in the menu."

Not one of these is a bug in the data, security or code. **The app was built around the tables, not around the loan officer's day.** Items 1 to 4 are design problems. Items 5 and 6 are configuration problems that real teams hit every week, as we'll see in the Day-2 section.

By the end of this part you'll know three things: how to design the app layer for a role, how to use AI inside it, and how to debug it when users say "it's not there".

## The thought shift

Most teams build the app layer last, in a hurry, by opening each table and accepting the default form and the "Active records" view. That produces an app that shows the **data model**, not the **work**.

Flip the order. Before you open the app designer, write down for each role:

- **What do they do at 9 AM?** That becomes their default view or dashboard.
- **Which records do they create, and in what order do they collect the data?** That becomes the form layout.
- **What are the stages of their work, and who hands over to whom?** That becomes the business process flow.
- **What are the 3 to 5 actions they repeat all day?** Those become command bar buttons.
- **What should they never see?** That stays out of their app and their role.

Think of the bank branch from Part 2. The tables are the filing cabinets in the back room. A model-driven app is **the office for one business process**. Loan officers, credit analysts and the branch manager all work in it. But each person's desk shows what their role needs, and some drawers are locked for some people. **Build the app around the process, then shape each role's view inside it.**

## The concepts in simple words

A model-driven app does not store any data. It is a **definition** of how a person meets the data: which tables, which forms, which views, which process and which buttons. The data stays in Dataverse, protected by the security model from Part 2.

| Building block | What it is | The user's question it answers |
| --- | --- | --- |
| **App (app module)** | A container that lists the tables, forms, views, dashboards and processes one audience uses | "Is this my app?" |
| **Site map** | The left navigation: areas, groups and pages | "Where do I go?" |
| **Views** | Saved queries with columns, filters and sort order | "Which records need me today?" |
| **Forms** | Main, quick create, quick view and card forms for one table | "What do I see and fill for this record?" |
| **Business process flow (BPF)** | Stages and steps shown as a bar on top of the form | "What stage is this in, and what's next?" |
| **Command bar** | Buttons on forms, grids and subgrids | "What can I do here in one click?" |
| **Dashboards and charts** | Visual summaries of views | "How is my work going overall?" |

### What happens under the hood

Knowing these four facts will solve most of the Day-2 problems later in this article:

1. **An app only shows what it includes.** A form, view or BPF that exists on the table but isn't added to the app is invisible inside that app. Each component has its own inclusion list in the app designer.
2. **Forms and apps are secured by roles.** You can assign each form to security roles, and each app to security roles. A user sees the first form, in form order, that their role allows.
3. **Each active BPF is its own Dataverse table.** When you activate a BPF, Dataverse creates a table to track every instance. It stores which record it runs on, the active stage and the path taken. Users need privileges on that table, like any other.
4. **BPFs and business rules also read process definitions.** They load their definitions from the Process (workflow) table, so users need read access there too. We'll see exactly how this breaks in production.

## Implementation 1: one app for the lending process, shaped by role inside it

The manager's complaint 6 ("everyone sees everything") tempts teams to build one app per role. In real projects that rarely works. The same people hold **several roles**. A senior officer is also a credit analyst on Saturdays. The branch manager approves loans and also creates them. Nobody wants to jump between three apps to finish one loan.

The usual production pattern is **one app per business process**, shared with every role that works in that process, and **role-based tailoring inside the app**.

**Steps:**

1. In your solution, select **New > App > Model-driven app** and name it for the process: **Branch Lending Hub**.
2. Add the site map in the order of the day:
   - **My Work:** dashboards, loan applications, tasks and appointments
   - **Customers:** contacts, accounts
   - **Loans:** loan applications, documents, repayment schedules
   - **Approvals:** credit committee queue, approval history
3. Leave out what nobody in this process touches: rate tables, configuration tables, integration logs. Those belong in a separate admin app.
4. Share the app with **Loan Officer**, **Credit Analyst** and **Branch Manager** roles.
5. Save, then **Publish**. An unpublished app change is the most common "I added it but can't see it" cause.

### How each role gets a different experience in the same app

| Tool | What it does | In our loan app |
| --- | --- | --- |
| **Table privileges** | A site map page for a table the role can't read is hidden automatically | Officers have no read on the committee queue table, so **Approvals** shows only the pages they can open |
| **Role-based forms** | Each main form is assigned to roles; the user gets the first allowed form in form order | Loan Officer form (20 fields) and Branch Manager form (adds risk band and approval history) |
| **Role-based dashboards** | Dashboards can be enabled for specific roles | Officer dashboard: my pipeline. Manager dashboard: branch totals, stuck loans |
| **Views with "current user" filters** | One view adapts to whoever opens it | "My loans waiting on documents" works for every officer |
| **BPF security roles** | A BPF can be enabled for chosen roles only | Everyone sees the Loan Approval Process; only managers and analysts can move it past Credit assessment (enforced on the server) |
| **Command visibility rules** | Buttons can check the user's role or the record's state | **Send for approval** for officers; **Approve** only for managers |
| **Column security** | Specific fields masked or read-only per profile | Applicant income and PAN visible only to credit roles |

### What happens when a user has several roles

Dataverse **combines** the roles. The user gets the highest privilege from any of them. They see every app shared with any of their roles. And they get the first form, in form order, that any of their roles allows. So put the **richest form first** (Branch Manager), then the Loan Officer form, so a manager who is also an officer gets the manager's view.

### When a separate app is the right call

Split only when the audiences genuinely work differently, not just because their roles differ:

- **Different devices or offline needs:** field staff collecting documents at the customer's home on a phone.
- **Different process:** the collections team works overdue loans, not new applications.
- **Admin and configuration:** rate tables, product setup and integration logs go in an admin app for a few people.
- **Licensing:** some users are on licences that only allow specific apps.

**Rule of thumb:** one app per process, many roles inside it; a new app only when the work itself is different.

## Implementation 2: views that answer "what needs me today?"

Complaint 2 ("I keep an Excel sheet") disappears when the default view becomes a to-do list instead of "all active records".

| View name | Filter | Sort | Columns (max 7) |
| --- | --- | --- | --- |
| My loans waiting on documents | Owner = current user · Active stage = Verification · Documents complete = No | Created on, oldest first | Loan no., applicant, amount, days in stage, missing documents |
| My loans due for approval | Owner = current user · Active stage = Approval | Submitted on | Loan no., applicant, amount, approver |
| Branch loans over ₹1 crore | Owner's business unit = current user's · Amount ≥ ₹1,00,00,000 | Amount, highest first | Loan no., officer, amount, stage |
| Loans stuck more than 7 days | Days in current stage > 7 | Days in stage, highest first | Loan no., officer, stage, days |

**Steps:**

1. In the table's **Views**, create each view and use the "current user" and "current user's business unit" operators, so one view works for every officer.
2. In the app designer, include only the views the roles in this process actually use for that table. System views can't be secured by role, so keep their names clear ("My…", "Branch…") and let the "current user" filters do the tailoring.
3. Set **My loans waiting on documents** as the app's default view for loan applications.
4. Add a chart on top of the view (loans by stage) and pin it to the officer dashboard.

**Tip:** "Days in stage" is not a built-in column. Keep it as a calculated or formula column on the loan. Or read it from the BPF table's active stage start time, which we'll cover with the BPF.

## Implementation 3: forms that show what this role needs, in the order they collect it

Complaint 1 (60 fields, 4 tabs) is a form design problem.

| Form type | What it's for | Our loan design |
| --- | --- | --- |
| **Main form "Loan Officer"** | The full record | 2 tabs, about 20 fields: applicant, amount, tenure, purpose, co-applicant, then documents |
| **Main form "Branch Manager"** | The same record for a different role | Adds risk band, approval history, officer notes |
| **Quick create** | Create a record from anywhere without leaving the page | 6 fields: applicant, amount, tenure, purpose, branch, source |
| **Quick view** | Show a related record's details inside this form | The applicant's phone, PAN status and existing loans |
| **Card form** | Compact layout for lists, mobile and dashboards | Loan no., amount, stage |

**Steps:**

1. Create the **Loan Officer** main form. Put fields in the order the officer collects them on a call, not in the order they were created in the table.
2. Move documents and co-applicants to a second tab as **subgrids**, so they don't load until the tab is opened.
3. Add a **quick view** of the applicant contact, so the officer doesn't open a second record.
4. Under **Form settings > Security roles**, assign the form to the Loan Officer role. Assign the Branch Manager form to the manager role.
5. In the app designer, include both forms for the loan table, in the right **form order**.

**Why it matters beyond looks:** every field, subgrid and quick view adds requests when the form opens. A 60-field form with 6 subgrids is slower on every load, for 300 people, all day.

## Implementation 4: the business process flow, with a branch for big loans

Complaint 3 ("new joiners don't know what comes after Verification") is what a BPF is built for. It shows the stages as a bar on top of the form, collects the right fields at each stage, and blocks **Next stage** until the required steps are filled. Complaint 5 ("some officers can't see the progress bar") is the BPF's security, and we'll fix it in the security table and Day 2.

![Loan Approval Process: six stages, with a credit-committee branch for loans of ₹1 crore and above](/images/rw-part5-bpf.png)

Every loan follows the same top row. Only loans of ₹1 crore and above are routed through the credit committee before approval.

### The design, stage by stage

| Stage | Table | Steps (fields shown in the bar) | Required to move on |
| --- | --- | --- | --- |
| Application | Loan application | Applicant, amount, tenure, purpose | Applicant, amount |
| Verification | Loan application | PAN verified, address verified, documents complete | All three = Yes |
| Credit assessment | Loan application | Credit score, risk band, assessor notes | Risk band |
| Credit committee (branch) | Loan application | Committee date, committee decision | Committee decision |
| Approval | Loan application | Approver, approval date, approved amount | Approved amount |
| Disbursement | Loan application | Disbursement date, account verified | Disbursement date |

### Steps

1. In your solution, select **New > Automation > Process > Business process flow**, name it **Loan Approval Process**, and pick the **Loan application** table.
2. Add the first five stages and their data steps from the table above. Tick **Required** only on the fields that truly gate the next stage. Every required step is a click the officer must make.
3. After **Credit assessment**, add a **Condition**: *Amount is greater than or equal to 1,00,00,000*. Put the **Credit committee** stage on the *yes* branch, and connect both branches to **Approval**.
4. Under **Edit security roles**, give the BPF to the Loan Officer and Branch Manager roles.
5. **Validate**, **Save**, then **Activate**.
6. In the app designer, make sure the BPF is included in the app's components. Day 2 shows why: it's the #1 "BPF is missing" cause.

### Limits worth knowing before you design

- Up to **30 stages** per process and **30 steps** per stage.
- A BPF can span up to **5 tables**, and a table can have up to **10 active BPFs**.
- Branches can nest up to **5 levels** deep.
- If your design is hitting these limits, the process is too big for one bar. Split it, or move part of it into a flow.

### What a BPF does **not** do

A required step only stops the user from clicking **Next stage** in the bar. It does **not** stop someone from updating the record through an import, a flow, the API or a plugin. If verification is a compliance rule, not just guidance, enforce it on the server too. For example, use a synchronous plugin from Part 3: "don't allow status = Approved unless PAN verified = Yes". **The BPF guides; the server enforces.**

### Using the BPF table itself

Because each active BPF is its own table, every loan has a matching **Loan Approval Process** row holding the active stage and when it started. That makes it reportable:

- Build a view on the BPF table, "loans in Verification for more than 7 days", for the branch manager.
- Use it for the "Days in stage" column from Implementation 2.
- Trigger a Power Automate flow on that table when the active stage changes, instead of guessing from the loan's own fields.

## Implementation 5: JavaScript for the command bar and the BPF, and the security that ties it together

Complaint 4 was: "to send a loan for approval they change a Status field, and half the time pick the wrong status". That's a command bar job: one button that sets the right status every time. And the BPF needs to push back when an officer tries to skip Verification. Both are done here with **JavaScript web resources and the Dataverse Client API (`Xrm`)**, the way most CRM teams already work.

### Step 1: create the web resource

1. In your solution, select **New > More > Web resource**.
2. Name: `new_/js/loanapplication.js`, display name **Loan Application scripts**, type **Script (JScript)**.
3. Upload the file below, **Save**, then **Publish**.

One file, one namespace, so nothing leaks into the global scope and two scripts never clash on a function name.

```javascript
// Web resource: new_/js/loanapplication.js
// Table: Loan Application (new_loanapplication)
var LoanHub = window.LoanHub || {};

LoanHub.LoanApplication = (function () {
    "use strict";

    // Choice values of the "Loan Status" column (check yours in the column editor)
    var STATUS = {
        VERIFIED: 100000001,
        PENDING_APPROVAL: 100000002
    };

    // ---------- Form events ----------

    // Register on the form OnLoad, with "Pass execution context as first parameter" ticked
    function onLoad(executionContext) {
        var formContext = executionContext.getFormContext();
        if (formContext.data.process) {
            formContext.data.process.addOnPreStageChange(onPreStageChange);
            formContext.data.process.addOnStageChange(onStageChange);
        }
        toggleDocumentsTab(formContext);
    }

    // Runs BEFORE the stage moves: we can cancel it here
    function onPreStageChange(executionContext) {
        var formContext = executionContext.getFormContext();
        var args = executionContext.getEventArgs();
        var current = formContext.data.process.getActiveStage();

        if (args.getDirection() === "Next" && current && current.getName() === "Verification") {
            var docsComplete = formContext.getAttribute("new_documentscomplete").getValue();
            if (docsComplete !== true) {
                args.preventDefault();   // stays in Verification
                formContext.ui.setFormNotification(
                    "Upload and verify all documents before moving to Credit assessment.",
                    "WARNING", "docs-missing");
            }
        }
    }

    // Runs AFTER the stage moved
    function onStageChange(executionContext) {
        var formContext = executionContext.getFormContext();
        formContext.ui.clearFormNotification("docs-missing");
        toggleDocumentsTab(formContext);
    }

    function toggleDocumentsTab(formContext) {
        var stage = formContext.data.process && formContext.data.process.getActiveStage();
        var tab = formContext.ui.tabs.get("tab_documents");
        if (stage && tab) {
            tab.setVisible(stage.getName() === "Verification");
        }
    }

    // ---------- Command bar ----------

    // Form command. Parameter: PrimaryControl
    async function sendForApproval(primaryControl) {
        var formContext = primaryControl;
        var status = formContext.getAttribute("new_loanstatus");

        if (status.getValue() !== STATUS.VERIFIED) {
            await Xrm.Navigation.openAlertDialog({ text: "Only verified loans can be sent for approval." });
            return;
        }

        var answer = await Xrm.Navigation.openConfirmDialog({
            title: "Send for approval",
            text: "Send this loan for approval?"
        });
        if (!answer.confirmed) { return; }

        try {
            status.setValue(STATUS.PENDING_APPROVAL);
            await formContext.data.save();
            formContext.ui.setFormNotification("Sent for approval", "INFO", "sent");
        } catch (e) {
            status.setValue(STATUS.VERIFIED);   // undo on the form if the save failed
            Xrm.Navigation.openErrorDialog({ message: e.message });
        }
    }

    // Grid command. Parameters: SelectedControlSelectedItemIds, SelectedControl
    async function sendSelectedForApproval(selectedIds, selectedControl) {
        var answer = await Xrm.Navigation.openConfirmDialog({
            text: "Send " + selectedIds.length + " loan(s) for approval?"
        });
        if (!answer.confirmed) { return; }

        Xrm.Utility.showProgressIndicator("Sending for approval...");
        try {
            for (var i = 0; i < selectedIds.length; i++) {
                var id = selectedIds[i].replace(/[{}]/g, "");
                await Xrm.WebApi.updateRecord("new_loanapplication", id, {
                    new_loanstatus: STATUS.PENDING_APPROVAL
                });
            }
            selectedControl.refresh();
        } catch (e) {
            Xrm.Navigation.openErrorDialog({ message: e.message });
        } finally {
            Xrm.Utility.closeProgressIndicator();
        }
    }

    // Enable rule (classic ribbon). Parameter: PrimaryControl. Must return true/false
    function isVerified(primaryControl) {
        var attr = primaryControl.getAttribute("new_loanstatus");
        return !!attr && attr.getValue() === STATUS.VERIFIED;
    }

    return {
        onLoad: onLoad,
        sendForApproval: sendForApproval,
        sendSelectedForApproval: sendSelectedForApproval,
        isVerified: isVerified
    };
})();
```

### Step 2: wire the form events

1. Open the **Loan Officer** main form, select **Form libraries > Add library**, and add `new_/js/loanapplication.js`.
2. Under **Events > On Load**, add the handler: library `new_/js/loanapplication.js`, function `LoanHub.LoanApplication.onLoad`, and tick **Pass execution context as first parameter**.
3. Save and publish. You don't register the stage events on the form: `onLoad` attaches them with `addOnPreStageChange` and `addOnStageChange`.

Now an officer who clicks **Next stage** in Verification without documents stays where they are and sees a yellow warning. The Documents tab only appears during Verification.

### Step 3: wire the command buttons

1. In the app designer, open **Branch Lending Hub**, select the **Loan applications** page, then **… > Edit command bar > Main form**.
2. **New > Command**, label **Send for approval**.
3. **Action:** *Run JavaScript*. Library `new_/js/loanapplication.js`, function `LoanHub.LoanApplication.sendForApproval`, parameter **PrimaryControl**.
4. Repeat on the **Main grid** command bar with function `LoanHub.LoanApplication.sendSelectedForApproval` and parameters **SelectedControlSelectedItemIds** and **SelectedControl**.
5. Save and publish.

**Showing the button only for verified loans:** in the modern command designer, visibility is set with a one-line formula (`Self.Selected.Item.'Loan Status' = 'Loan Status (Loan Applications)'.Verified`). If your team keeps everything in JavaScript, add the button through the classic ribbon, for example with Ribbon Workbench. Then use `LoanHub.LoanApplication.isVerified` as a **custom enable rule**. Either way, the JavaScript action itself also checks the status, so a wrong click can never send an unverified loan.

### What the code does, and the CRM rules behind it

- `executionContext.getFormContext()` is the supported way to reach the form. `Xrm.Page` is deprecated, so new code shouldn't use it.
- `addOnPreStageChange` + `args.preventDefault()` cancels the stage move **before** it happens. `addOnStageChange` runs **after** the move, too late to cancel.
- `getDirection()` returns `"Next"` or `"Previous"`, so officers can still move **back** to fix data.
- `formContext.data.save()` and `Xrm.WebApi.updateRecord` return promises. `async`/`await` keeps the dialogs, save and refresh in the right order.
- The updates run **as the user**, so their security role still decides whether the change is allowed.
- Comparing the stage **name** is easy to read, but a renamed stage breaks it. In production, compare `getId()` with the stage's GUID kept in one constant.

### Good to know

- Commands are **per app**. If you later build a separate admin or collections app, the button doesn't appear there unless you add it. In this app, show **Approve** only to managers. Check the role in an enable rule, for example with `Xrm.Utility.getGlobalContext().userSettings.roles`. And still enforce it on the server.
- JavaScript runs only in the browser. A required step or a `preventDefault()` stops the click, not an import, a flow or the API. Real enforcement stays in the role and in server-side logic, such as a plugin.
- Keep heavy logic (calling external APIs, creating many related records) out of the browser. Let the button set a status and let a plugin or a flow do the work.

## The security that ties it all together

Each layer we built has its own security switch. When one is missing, users report "it's not there", and every one looks the same from the user's side.

| Layer | Where you set it | What happens if it's missing |
| --- | --- | --- |
| App access | App > Share, or app's security roles | User doesn't see the app tile at all |
| Table privileges | Security role, table tab | Page in the site map is hidden, or records don't load |
| Form access | Form > Form settings > Security roles | User gets a different (fallback) form |
| BPF access | BPF designer > Edit security roles | BPF doesn't show on the form |
| BPF table privileges | Security role > the BPF's own table (Custom entities tab) | BPF shows but can't be started or moved forward |
| Process (workflow) read | Security role > Customization tab > Process | BPF stages, steps or business rules fail or load partly |
| Column security | Column security profiles | Field shows as locked or masked |

**Rule of thumb:** when a new BPF or form works for admins but not for users, it's almost never a bug. It's one of these seven rows.

## Day 2: what actually goes wrong in production

These are the problems that come up again and again once real users start working in the app. For each one: what the user sees, why it happens, and how to handle it.

### 1. "The BPF works for me, but users don't see it"

**What the user sees:** the maker and other admins see the process bar on the loan form. Loan officers open the same record and there's no bar at all.

**Why it happens:** System Administrator and System Customizer get access to every new BPF automatically. Custom roles get nothing until you grant it. So the person who built it never sees the problem.

**How to handle it:**

1. Open the BPF, select **Edit security roles**, and enable it for Loan Officer and Branch Manager.
2. In the Loan Officer role, find the BPF's own table (**Custom entities** tab) and give Create, Read and Write.
3. On the **Customization** tab, give **Read** on **Process**.
4. Sign in as a test user with only the Loan Officer role and open a loan. Never sign off a BPF after testing as an admin.

### 2. "I activated the BPF, but it's not in the app"

**What the user sees:** the BPF works in another app or in the classic UI, but not in Branch Lending Hub. Sometimes it's the opposite: admins see the new process, others still see the old standard one.

**Why it happens:** an app only loads the components added to it. Activating a BPF doesn't add it to any app. After a deployment, the cause is often that the BPF or its table wasn't included in the solution.

**How to handle it:**

1. Open the app in the app designer, go to the BPF components, and tick the new BPF.
2. Save and **publish the app**.
3. Before every release, check the solution contains the BPF **and** its BPF table, and that the app in the solution includes it.

### 3. "Users can start the process, but the stages inside the branch are missing"

**What the user sees:** the bar shows Application to Credit assessment, then nothing. Admins see the Credit committee branch and everything after it.

**Why it happens:** the branch condition is evaluated at runtime from the process definition. If the role can't read Process records at **Organization** level, the branch can't be worked out for that user. The failed load can also be cached in the browser, so it seems to stay broken after you fix the role.

**How to handle it:**

1. In the role, set **Read** on **Process** to **Organization** level.
2. Ask the user to refresh hard or sign out and back in, so the cached state clears.
3. Retest the branch with a loan below and a loan above ₹1 crore.

### 4. "The Next Stage button is missing" or "Run Flow is greyed out"

**What the user sees:** on a new loan, the bar shows the first stage but there's no **Next stage**, and a flow step in the bar can't be clicked.

**Why it happens:** on a record that hasn't been saved yet, the BPF instance doesn't exist. Nothing can move or run until there's a saved record behind it.

**How to handle it:**

1. Train users to **save first**. Better: keep the Application stage to the few fields needed to create the record.
2. Put flow steps and gating steps in later stages, never in the first one.
3. If the button is still missing after saving, go back to problem 1: it's a privilege on the BPF table.

### 5. "After a role clean-up, users lost access to processes"

**What the user sees:** everything worked last month. After the security team "simplified" the roles, BPFs, on-demand workflows and flows stopped showing for a group of users.

**Why it happens:** the new minimal role was copied from a basic role. That role doesn't have the process privileges: Process read, the BPF tables and the related system tables.

**How to handle it:**

1. Build business roles from a role you've already proved works with your BPFs, not from the smallest built-in role.
2. Document which privileges each BPF needs (its table, Process read) next to the role design.
3. Keep **one test user per role**. After every security change, run a short test: open a loan, move a stage, run the command.

### 6. "The form is slow" or "a field doesn't show"

**What the user sees:** the loan form takes several seconds to open, or a field that should be there isn't.

**Why it happens:** there are three usual causes. Too many fields and subgrids on the first tab. A script or business rule hiding the field. Or the field isn't on this role's form at all.

**How to handle it:**

1. Add `&monitor=true` to the app URL, open **Monitor**, and replay the form. It shows why each control is hidden or visible, which scripts and rules ran, and how long each part of the load took.
2. Add `&flags=DisableFormHandlers=true` to the URL. If the problem disappears, it's your JavaScript or a business rule.
3. Check which form the user actually got: they see the first form their role allows, which may not be the one you edited.

### 7. "My command button isn't showing"

**What the user sees:** the **Send for approval** button appears for you, but not for an officer, or only on the grid and not on the form.

**Why it happens:** there are three usual causes. The button's visibility or enable rule returned false. The command was added to only one command bar (grid, form or subgrid). Or it was added to a different app.

**How to handle it:**

1. Add `&ribbondebug=true` to the app URL and open **Command checker**. It lists every button and shows which rule hid it, and with what value.
2. Check the button exists on each command bar you need: main grid, main form, subgrid.
3. Check the JavaScript library is published and the function name in the command matches exactly, including the namespace `LoanHub.LoanApplication`.

## Using AI with model-driven apps and BPFs

AI shows up in two places here: **inside the app**, helping the loan officer, and **beside you**, helping you build. Both are useful. Both need you to know the design above, or they'll produce something that looks right and isn't.

### AI inside the app, for the users

| Feature | What it does for a loan officer | Things to know before you promise it |
| --- | --- | --- |
| **Copilot form fill assistance** | Suggests values for form fields from context, which the user reviews and accepts | Generally available in Dynamics 365 apps, preview in Power Apps. An admin must enable it |
| **Smart paste** | Officer copies an applicant's email or a document image, pastes, and Copilot suggests the matching fields | Supports text and images. Fields protected by **column security aren't supported**, so PAN or income fields behind a profile won't fill |
| **Copilot chat in the app** | "Show my loans waiting on documents for more than a week" in plain language | **Read-only**: it answers questions, it doesn't update records. An admin turns it on per environment |

**Design tip:** Copilot answers better when your tables and columns have clear display names and descriptions. "Loan Status" with a description beats "new\_lnst". Copilot in Dataverse can also be given **synonyms** and glossary terms, so "sanctioned" maps to Approved.

### AI beside you, for building

- **Plan designer:** describe the business problem ("branch loan officers process applications through verification, credit check and approval") and it proposes tables, an app and flows as a starting point. Treat its output as a first draft for review, not as your design.
- **Generative pages:** describe a custom page in plain words and it generates one inside your model-driven app, such as a branch manager's approval queue. Useful for screens a standard form or view can't express.
- **Copilot or any assistant for JavaScript:** draft the web resource, then check every column logical name and choice value against your real table. AI often invents names like `loanstatus` when yours is `new_loanstatus`, uses the deprecated `Xrm.Page`, or forgets that `preventDefault()` must run in `OnPreStageChange`, not `OnStageChange`.

### Prompts that work (copy and adapt)

```
I have a Dataverse table new_loanapplication with a choice column
new_loanstatus (Verified = 100000001, Pending Approval = 100000002).
Write a JavaScript web resource in a namespace (no Xrm.Page) with:
1) a form command function taking PrimaryControl that confirms and
   sets the status to Pending Approval, then saves;
2) an OnPreStageChange handler that blocks moving Next out of the
   "Verification" stage unless new_documentscomplete is true.
```

```
Here is my BPF design (stages, steps, required fields, branch rule).
Act as a reviewer. List: steps that should not be required, missing
server-side enforcement, and which security role privileges each
stage needs, including the BPF table and Process read.
```

```
Users with role "Loan Officer" can't see the stages inside a BPF branch,
but System Customizers can. List the likely causes in order of
probability and how to verify each one.
```

### Where AI goes wrong here

- It will happily put **30 required steps** in a BPF. Your users then click through 30 fields to move one stage.
- It treats the BPF and the command bar as **security**. They aren't. Ask it about server-side enforcement explicitly.
- It doesn't know your environment. A Copilot feature that's GA in Dynamics 365 Sales may be preview in a plain Power Apps environment. Check the region and licence before you demo it to a client.

**The rule:** let AI write the first draft and the checklist; you own the design, the security and the test with a real user.

## Debugging playbook

When a user says "it's not there" or "it's not working", go top to bottom. Each step rules out one layer.

| # | Check | How | What it tells you |
| --- | --- | --- | --- |
| 1 | Is it published? | Solution > **Publish all customizations**; app designer > **Publish** | Most "I changed it but nothing happened" cases end here |
| 2 | Is it in **this** app? | App designer > components: forms, views, BPF, dashboards | Components not added to the app aren't downloaded |
| 3 | Does it work for an admin but not the user? | Test with the user's role on a test account | If yes, it's security: go to step 4. If no, it's configuration |
| 4 | Which security layer? | Walk the 7-row security table above | App, table, form, BPF, BPF table, Process read, column security |
| 5 | Is the record saved? | Look for "unsaved changes" in the footer | BPF can't advance and flow steps are greyed out on unsaved records |
| 6 | Is script or a rule interfering? | Add `&flags=DisableFormHandlers=true` to the URL | If the problem disappears, it's your JavaScript or a business rule |
| 7 | What does the form actually do? | Add `&monitor=true`, open Monitor | Shows why a control is hidden, what ran, and how long each part took |
| 8 | Why is a button hidden? | Add `&ribbondebug=true`, open Command checker | Shows each command's visibility rule result |
| 9 | Still cached? | Ask the user to refresh hard, or sign out and back in | A failed Process load can stay cached after you fix the role |

### Go-live checklist

- [ ] One app per business process, shared with every role in it; separate apps only for genuinely different work (admin, field, collections)
- [ ] Site map in the order of the role's day; no config or log tables
- [ ] Default view is a to-do list ("my loans waiting on documents"), max 7 columns
- [ ] Main form per role, assigned to roles, fields in collection order
- [ ] Subgrids on a second tab; quick create and quick view forms in place
- [ ] BPF added to the app and to the right roles
- [ ] Roles have privileges on the BPF table and Process read at organization level
- [ ] Only gate-keeping steps are marked required
- [ ] Compliance rules also enforced on the server (plugin or business rule)
- [ ] Command buttons have visibility rules and confirm before changing data
- [ ] Copilot features enabled only after checking availability and column security
- [ ] Tested with a real account for **every** role, not an admin
- [ ] BPF, its table, app, forms, views and command library all in the same solution

## Interview questions, with the answers that land

**1. A BPF works for you but not for a business user. What do you check?**

First, whether the BPF is added to the app and assigned to the user's role. Then the user's privileges on the BPF's own table, because each active BPF creates a table. Then Read on Process at organization level, especially if the BPF has branches. Admins and customizers get access by default, so I always test with a real user role.

**2. Is a BPF a security control?**

No. Required steps only stop a user from moving the stage in the UI. Imports, flows, the API and plugins can still update the record. If the rule is about compliance, I enforce it on the server too. For example, a synchronous plugin blocks Approved status unless verification is complete.

**3. One app per role, or one app for everyone?**

Neither, strictly. I build one app per business process and share it with all the roles in that process. Real users often hold several roles and shouldn't switch apps in the middle of a task. Inside the app I tailor by role: role-based forms and dashboards, "current user" views, privileges that hide site map pages, command visibility rules and column security. I split into a separate app only when the work is genuinely different: admin and configuration, field or offline users, or a different process like collections. When a user has several roles, Dataverse combines them, so I order forms with the richest one first.

**4. How do you report on how long loans sit in each stage?**

From the BPF's own table. Each instance row has the active stage and when it started. So I can build views, charts and flows on it, instead of adding tracking fields to the main table.

**5. How would you add a "Send for approval" button today?**

A JavaScript web resource in a namespace, called from a modern command with **Run JavaScript** and the **PrimaryControl** parameter (or **SelectedControlSelectedItemIds** on a grid). The function checks the status, confirms with `Xrm.Navigation.openConfirmDialog`, sets the value and saves with `formContext.data.save()`. Visibility comes from a simple rule on the status. The save runs as the user, so security still applies, and heavy logic goes to a plugin or flow triggered by the status change.

**6. What would you check before enabling Copilot form fill for a client?**

Three things: whether it's generally available or still in preview for their app type and region, whether an admin can turn it on, and which fields use column security, because smart paste doesn't support those. And that users still review every suggested value before saving.

**7. How do you stop a user moving a BPF stage forward from JavaScript?**

Register `addOnPreStageChange` in the form OnLoad, check `getDirection()` and the active stage, and call `executionContext.getEventArgs().preventDefault()`. It has to be the pre-stage event: `OnStageChange` fires after the move, too late to cancel. And it's still UI-only, so the same rule must exist on the server.

## Rule of thumb

**One app per process, shaped by role inside it. Guide with the BPF, enforce on the server, and test as the user, never as the admin.**

## Coming next: Dynamics 365 JavaScript, from Basics to Production

The JavaScript in this article was the easy version, written to work first time. Real CRM JavaScript work is mostly finding out why a script didn't run, ran twice, ran too early, or failed for one user only.

So the next series teaches debugging from the very first part. Every part builds the code, **breaks it on purpose** in the ways it really breaks in projects, then shows how to debug and fix it.

1. **Your first web resource:** and why it says "method does not exist"
2. **The CRM debugging toolkit:** DevTools, breakpoints, Network tab, URL flags, Monitor, caching
3. **formContext in depth:** and the classic `Cannot read properties of null`
4. **Form events and execution order:** handlers that run twice, too early, or not at all
5. **Notifications and validation:** messages that never clear, saves that never happen
6. **Xrm.WebApi, CRUD:** reading OData errors, lookups, privileges
7. **Xrm.WebApi, queries:** OData, FetchXML, paging and slow queries
8. **Async JavaScript in CRM:** promises, race conditions, async OnLoad and OnSave
9. **Navigation and UI:** forms, dialogs, side panes and custom pages
10. **Business process flow API:** stage events, blocking and moving stages
11. **Grids and subgrids:** events, timing and refresh
12. **Modern commanding with JavaScript:** parameters and Command checker
13. **Ribbon Workbench in depth:** enable and display rules, layering, lost buttons
14. **Production-ready JavaScript:** user-only bugs, performance, testing and releases
