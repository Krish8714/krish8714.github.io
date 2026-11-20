---
title: "Custom APIs, and When a Plugin Is the Wrong Answer"
description: "Build a Custom API end to end, then decide when a plugin is the wrong tool altogether."
series: dataverse-plugins
part: 11
pubDate: 2026-11-20
cover: /covers/plugins-part11.png
tags: [Dataverse, Plugins, Dynamics 365]
---

*Part 11 of my series, Dataverse Plugins: Built for Production. Every plugin so far has reacted to someone else's Create, Update or Delete. Today we define our own operation with Custom APIs, and then ask the most senior question in this series: when is a plugin the wrong answer?*

## Business operations aren't CRUD

Real banks don't "update a loan". They **restructure** it, **disburse** it, **foreclose** it, **top it up**. Each of those is one business operation that touches several records, has its own rules, and either happens completely or not at all.

When the only tool you have is "plugin on Update", you end up modelling business operations as field changes. Set `new_action` to "Restructure", save, and let a plugin notice the change and do the real work. It works. It's also invisible (nobody can find where restructuring is implemented), hard to call from other systems, and easy to trigger by accident with a bulk edit.

Custom APIs fix that by letting you add your own message to Dataverse.

## Back at the bank

The restructuring requirement: given a loan, a new tenure and a reason, the system must recalculate the EMI, regenerate the remaining repayment schedule, close the old schedule rows, write an audit record, and return the new EMI. It must be callable from the loan form (a button), from Power Automate (an approval flow), and from the core banking integration. Only users with a specific restructuring privilege may run it.

That's not an Update. That's an operation. So we'll make it one: `fincorp_RestructureLoan`.

## The thought shift

**Model what the business does, not what the database changes.**

A Custom API is a named operation with typed inputs and outputs, its own security, and your plugin as its implementation. Callers say "restructure this loan with these inputs", not "set these five fields and hope a plugin understands".

## Anatomy of a Custom API

A Custom API is defined with data, in a few related tables, so it's a solution component and travels through your pipeline like everything in Part 10:

- **Custom API** record: the unique name (with your publisher prefix), whether it's **bound** to a table (runs against a specific loan) or **global**, whether it's a **function** (no side effects, called with GET) or an **action** (changes data, called with POST), whether it's **private** (hidden from metadata), which **privilege** is required to execute it, whether other plugins may register steps on it, and which **plugin type** implements it.
- **Request parameters**: name, type (string, integer, decimal, money, entity reference, entity, etc.), optional or required.
- **Response properties**: what it returns.

For ours: bound to `new_loan`, action, required parameters `NewTenureMonths` (integer) and `Reason` (string), response property `NewEmi` (money), execute privilege tied to a "restructure loans" privilege we grant only to credit managers.

## The implementation is just a plugin

The plugin linked to the Custom API runs as its main operation. Inputs arrive in `InputParameters`; you set outputs in `OutputParameters`.

```csharp
public void Execute(IServiceProvider sp)
{
    var context = (IPluginExecutionContext)sp.GetService(typeof(IPluginExecutionContext));
    var service = ((IOrganizationServiceFactory)sp.GetService(typeof(IOrganizationServiceFactory)))
                  .CreateOrganizationService(context.UserId);

    var loanRef = (EntityReference)context.InputParameters["Target"];       // bound API: the loan
    int tenure  = (int)context.InputParameters["NewTenureMonths"];
    string reason = (string)context.InputParameters["Reason"];

    if (tenure < 12 || tenure > 360)
        throw new InvalidPluginExecutionException("New tenure must be between 12 and 360 months.");

    var loan = service.Retrieve("new_loan", loanRef.Id,
        new ColumnSet("new_outstanding", "new_rate", "new_status"));
    EnsureRestructurable(loan);

    decimal emi = CalculateEmi(loan.GetAttributeValue<Money>("new_outstanding").Value,
                               loan.GetAttributeValue<decimal>("new_rate"), tenure);

    CloseFutureScheduleRows(service, loanRef.Id);
    CreateSchedule(service, loanRef.Id, emi, tenure);
    WriteAudit(service, loanRef.Id, reason, context.InitiatingUserId);

    service.Update(new Entity("new_loan", loanRef.Id)
    {
        ["new_tenuremonths"] = tenure,
        ["new_emi"] = new Money(emi)
    });

    context.OutputParameters["NewEmi"] = new Money(emi);
}
```

Everything from the earlier parts still applies: it's synchronous and transactional, so if any step throws, nothing is half-restructured. It should be tested (Part 7), traced (Part 8), and careful about identity (Part 9). Note that this time an `Update` of the loan from inside the plugin is fine: it's a different message, and the Update plugins with filtering attributes (Part 4) will react only to the columns they care about.

## Calling it

- **Web API:** a bound action appears as `POST /api/data/v9.2/new_loans(<id>)/Microsoft.Dynamics.CRM.fincorp_RestructureLoan` with a JSON body of parameters.
- **SDK:** an `OrganizationRequest("fincorp_RestructureLoan")` with the parameters.
- **Power Automate:** the Dataverse connector's bound/unbound action steps list your Custom API.
- **Model-driven app button:** a command (Power Fx or JavaScript) that calls it for the selected loan.

One operation, one implementation, many callers, same rules. That's the payoff.

## Custom API vs the alternatives

Custom APIs replaced older patterns:

- **Custom process actions** (actions defined in the classic workflow designer) still work, but Custom APIs are the recommended approach for new development: better control over binding, function vs action, privileges and whether others can extend them.
- **"Trigger field" plugins** (set a field to make a plugin do something) should be replaced by Custom APIs wherever the operation matters.

## When a plugin is the wrong answer

This series is about plugins, so let me be honest about where they don't belong. A senior developer's value is often in the plugin they *don't* write.

### A value derived from other columns on the same row

Use a **formula column** (Power Fx) or a calculated column. No code, no deployment, always consistent. Plugins for "full name = first + last" are maintenance for nothing.

### Simple field rules for one table

Business rules with Entity scope run on the server too. For "required if", "default value", "show error if", they can be enough, and they're maintained by makers. Avoid splitting one column's logic between a rule and a plugin (Part 2).

### Notifications, approvals and multi-step human processes

**Power Automate.** Emails, Teams messages, approvals and anything that waits for people are what flows are built for. A plugin should not send emails directly or wait on humans.

### Heavy, slow or high-volume background work

**Azure Functions** fed by a queue (Part 5). The sandbox has a 2-minute limit and shares capacity with everyone.

### Simple server logic owned by makers

**Low-code plugins** (Power Fx, in preview at the time of writing) let makers write instant or automated server-side logic without C#. Watch their status and limits before using them for critical rules.

### So when *is* a plugin right?

- The rule must hold for **every caller** (forms, APIs, imports, flows) and must be **enforced in the transaction**.
- You need **stage control**: before validation, before write, after write.
- The logic is too complex or too performance-sensitive for low-code.
- You're implementing a **Custom API**.

## Day-2 situations tutorials never show

### "The Custom API doesn't appear in Power Automate"

It's private, or the metadata cache hasn't refreshed, or the user lacks the execute privilege. Check those before suspecting the code.

### "We need to change a parameter's type"

Many Custom API definition properties can't be changed after creation. Plan parameters carefully; changing them often means creating a new Custom API (a v2) and moving callers.

### "Another team wants to run logic after our API"

Decide when you create the API whether to allow custom processing steps (none, async only, or sync and async). If you allow it, other plugins can register on your message like they do on Update.

### "Our trigger-field plugin fired during a bulk edit"

Exactly the risk of modelling operations as field changes. Move it to a Custom API with a privilege, and the bulk edit can't trigger it.

## Checklist

- Business operations that touch several records are Custom APIs, not trigger fields.
- Each Custom API has a clear name, binding, function/action type and an execute privilege.
- Parameters are designed carefully, because changes later are expensive.
- The implementing plugin follows all earlier rules: transactional, tested, traced, deliberate identity.
- Before writing a plugin, I checked formula columns, business rules, Power Automate, Azure Functions and low-code plugins.

## If this comes up in an interview

**Q: What is a Custom API?**  
A custom message you define in Dataverse with typed request parameters and response properties, optional binding to a table, its own execute privilege, and a plugin that implements the main operation.

**Q: Function vs action?**  
A function has no side effects and is called with GET; an action can change data and is called with POST.

**Q: Custom API or custom process action?**  
Custom API for new development: more control over binding, privileges, extensibility and type.

**Q: Give an example where you'd avoid a plugin.**  
A value derived from the same row (formula column), an approval process (Power Automate), or heavy background processing (Azure Functions via a queue).

**Q: How do you restrict who can call a Custom API?**  
Set its execute privilege and grant that privilege only through the appropriate security roles.

## What's next

The final part. Callers used to be people in forms and integrations we designed. Increasingly they're AI agents. Part 12 is about what that changes for plugins, and why the server-side rules we've built across this series matter more now, not less.
