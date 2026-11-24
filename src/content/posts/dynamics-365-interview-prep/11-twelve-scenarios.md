---
title: "12 Dynamics 365 Scenarios That Catch People Out"
description: "Data model, security, form logic and server logic: 12 interview scenarios where the obvious answer is wrong. How to think about each one, why it happens, and the fix. Free revision deck included."
series: dynamics-365-interview-prep
part: 12
label: "Level 5 · Part 11"
pubDate: 2026-11-24
cover: /covers/ip-level5.png
tags: [Interview Preparation, Scenarios, Dataverse, Security, Plugins]
---

*Level 5 of Dynamics 365 Interview Prep: From Basics to Architect. These are the questions where the first answer that comes to mind is wrong. Try each one before you read the fix.*

**Download the revision deck (PDF, 14 slides):** [12 Dynamics 365 scenarios](/downloads/dynamics365-12-scenarios.pdf)

## Data model

### 1. You create an alternate key on Loan Number. It never becomes active.

**How to think:** an alternate key is a unique index. If it won't activate, is there existing data that breaks uniqueness?

**Why it happens:** Dataverse builds the index in a background job. If two rows already share a Loan Number, the job fails and the key's status shows **Failed**.

**The fix:**
- Check the key's status (Pending, Active or Failed) under the table's **Keys**.
- Find the duplicates with a view sorted by Loan Number, and clean them.
- Reactivate the key, or delete and recreate it.

### 2. A payment is saved, but "Total outstanding" on the loan doesn't change.

**How to think:** is this value needed instantly, or is "a little later" acceptable?

**Why it happens:** rollup columns aren't recalculated on save. A system job updates them on a schedule (hourly by default), and users can refresh the field by hand.

**The fix:**
- Waiting is fine: keep the rollup and tell users about the refresh.
- Needed now: call `CalculateRollupField` after the payment is saved.
- Must always be exact: maintain the total with a plugin on payment create, update and delete.

### 3. Reassigning one customer quietly moved 40 open loans to the new owner.

**How to think:** when a parent record changes, what should happen to its children? That's a relationship behaviour question.

**Why it happens:** the Customer-to-Loan relationship is **Parental**, which cascades Assign (and Share, Delete and more) to every child.

**The fix:**
- Change the relationship behaviour to **Custom**.
- Set Assign to **Cascade None**, so loans stay with their officers.
- Test a reassign in a sandbox before changing production.

### 4. The business wants "guarantor" or "co-applicant" stored on the link between Loan and Contact.

**How to think:** does the link itself carry data? If yes, it isn't a simple N:N.

**Why it happens:** a native N:N uses a hidden intersect table that holds only the two record IDs. You can't add a Role column to it.

**The fix:** create a custom table such as **Loan Party** with two lookups (Loan, Contact) and a Role choice (Guarantor, Co-applicant). You now get forms, views and security on the link.

## Security

### 5. A plugin works for your admin tester and fails for branch users.

**How to think:** works for admin, fails for users? Suspect permissions before you suspect code.

**Why it happens:** plugins run as the calling user by default. The admin can read everything; the branch role can't read a table the plugin queries, so the call fails with an access error.

**The fix:**
- Read the exact error in the plugin trace log.
- If users should have that access, add the privilege to their role.
- If they shouldn't, run only that query as SYSTEM: `CreateOrganizationService(null)`.
- Always test with a non-admin user.

### 6. A loan officer moves to another branch and can't open anything on Monday.

**How to think:** moving a user is a security change, not just an HR change.

**Why it happens:** when a user's business unit changes, Dataverse removes their security roles by default. They can sign in, but they see nothing.

**The fix:**
- Add "reassign roles" to the user-move checklist, or automate it.
- Admins can change the environment setting so roles are kept when the business unit changes.
- Check the user's team memberships too.

### 7. Salary is a secured column, yet salaries show up in an Excel export.

**How to think:** security protects a column, not the data. Where else can this value end up?

**Why it happens:** a flow runs under an admin connection, so it can read Salary. It copied the value into a Notes field with no column security. Anyone who can read Notes can now see the salary.

**The fix:**
- Never copy secured values into unsecured columns.
- Run flows under a service account with only the access it needs.
- Review every flow and plugin that touches secured columns.

### 8. A manager has Business Unit read, but must not see one VIP loan.

**How to think:** Dataverse security only adds access. So how do you take this record out of the manager's scope?

**Why it happens:** security roles grant access; they can't deny it. With BU read, the manager sees every record owned in that business unit.

**The fix:**
- Assign the VIP loan to a team in a separate, restricted business unit.
- Give access to that team only to the people who need it.
- If exceptions are common, redesign: User-level read plus sharing or access teams.

## Form logic

### 9. Your OnSave validation interrupts users every 30 seconds.

**How to think:** when an event fires "too often", what else triggers this event?

**Why it happens:** autosave saves the form about 30 seconds after a change, and every autosave fires OnSave. So the validation runs, and shows its message, again and again.

**The fix:**
- In OnSave, read `executionContext.getEventArgs().getSaveMode()`.
- If it returns **70** (AutoSave), skip the validation.
- Validate on manual saves: **1** (Save) and **2** (Save & Close).

### 10. OnChange logic works on the main form but not on Quick Create.

**How to think:** form scripts belong to a form, not to the table. Which forms can create this record?

**Why it happens:** event handlers are registered on each form separately. Quick Create is its own form, so the main form's OnChange never runs there.

**The fix:**
- Add the library and register the handler on Quick Create too.
- Remember the other entry points: other main forms, imports, the API.
- If the rule must always hold, move it server-side: a plugin, or a business rule with Entity scope.

## Server logic

### 11. A sync plugin charges a payment, then a later step fails. The save rolls back. The payment doesn't.

**How to think:** can everything this step touches be rolled back? If not, it doesn't belong inside the transaction.

**Why it happens:** a synchronous plugin runs inside the database transaction. On failure Dataverse rolls back its own data, but the payment gateway has already charged the customer.

**The fix:**
- Move the external call after the commit: an async plugin, or Service Bus with an Azure Function.
- Send an idempotency key (for example, the payment ID) so a retry never charges twice.
- Write the gateway's result back onto the record.

### 12. A flow updates a loan, a plugin rejects it, and nobody notices for a week.

**How to think:** who will notice when automation fails? If the answer is "nobody", design the monitoring.

**Why it happens:** the user's save succeeded. The flow ran later in the background, and its update was rejected. The error exists only in the flow's run history.

**The fix:**
- Add a failure branch (**Configure run after: has failed**) that alerts a team.
- Monitor failed runs in flow analytics or the admin center.
- Send alerts to a Teams channel, or raise a support ticket automatically.

## The pattern behind all 12

Every one of these is answered by the same four questions:

1. **What runs?**
2. **When does it run?**
3. **Who does it run as?**
4. **What can be rolled back?**

Ask them out loud in the interview. Even if your final answer differs from what the panel expected, they'll see how you reason.
