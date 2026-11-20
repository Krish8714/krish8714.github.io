---
title: "Security Inside Plugins: Who the Plugin Acts As"
description: "UserId vs InitiatingUserId, when SYSTEM is right, how plugins leak data, and secure configuration."
series: dataverse-plugins
part: 9
pubDate: 2026-11-20
cover: /covers/plugins-part9.png
tags: [Dataverse, Plugins, Dynamics 365]
---

*Part 9 of my series, Dataverse Plugins: Built for Production. Your security roles, business units and field security took months to design. Today: how one line in a plugin can quietly walk around all of it, and how to make sure yours never does.*

## The plugin that knew too much

A support agent can only see loans in her own branch. That's how the business units and security roles were designed, audited and signed off.

Then a developer writes a plugin that, when a support case is opened, copies the customer's total exposure across all loans onto the case. To make sure the query "always works", he creates the organization service with `null`. The query runs as SYSTEM. It sees every loan in every branch. The total lands on a case the agent can read.

No security role was changed. No audit flagged anything. The plugin simply did what the platform allowed it to do: act as someone more powerful than the user who triggered it.

## Back at the bank

Priya is a loan officer in the Hyderabad branch. Her security role lets her read and update loans in her business unit. Three plugins run when she works:

- The **co-applicant rule** (Part 1): reads only the record she's saving.
- A **rate history** plugin (Part 3): creates a history record. Priya has no create permission on the history table, by design, so she can't fake history.
- An **exposure check**: needs the customer's total exposure across all branches, to enforce a group-wide limit.

Each needs a different identity. Choosing correctly is the whole topic.

## The thought shift

**A plugin doesn't have permissions. It borrows someone's. Decide whose, on purpose, for each call.**

Every request a plugin makes through `IOrganizationService` runs as some user, and that user's security roles decide what the request can see and do. The question isn't "will this work?" (almost anything works as SYSTEM). The question is "**whose authority should this action carry?**"

## The identities in the context

- **`context.InitiatingUserId`**: the person (or application user) who actually started the request. Priya.
- **`context.UserId`**: the user the plugin is running as. By default it's the same as the initiating user. It differs if the step is registered to run as a specific user ("Run in User's Context" in the Plugin Registration Tool), or if the caller used impersonation.

And the service you create decides who each call runs as:

```csharp
var factory = (IOrganizationServiceFactory)sp.GetService(typeof(IOrganizationServiceFactory));

var asUser    = factory.CreateOrganizationService(context.UserId);           // the plugin's run-as user
var asCaller  = factory.CreateOrganizationService(context.InitiatingUserId); // the human who clicked
var asSystem  = factory.CreateOrganizationService(null);                     // SYSTEM: bypasses security roles
```

That third line is the one to treat with respect. Calls made as SYSTEM aren't constrained by the caller's security roles. Use it only where you've decided the action must ignore the user's permissions, and keep it as narrow as possible.

## Applying it to Priya's three plugins

### Co-applicant rule: no service at all

It only reads the Target and the image. Nothing to choose. The cheapest and safest plugin is one that doesn't query.

### Rate history: elevated, but narrowly

Priya must not be able to create history records herself. But the plugin must create them when she changes a rate. So the creation must run with more authority than Priya has.

Two good options:

- **Register the step to run as a dedicated application user** with one custom role: create on rate history, read on loans. Then use `context.UserId`. The elevated authority is visible in the registration and limited by that role.
- **Use a SYSTEM service for that single Create call**, and nothing else. Document why.

Either way, record the human: `new_changedby = InitiatingUserId`. Elevation should never erase who actually did it.

### Exposure check: elevated read, minimal output

Here's the risky one. The group-wide limit genuinely needs loans from every branch. So the query must run with authority beyond Priya's. Fine. But then be careful about what leaves the plugin:

```csharp
// Elevated query: sum only, no record data
decimal totalExposure = SumExposure(asSystem, customerId);

if (totalExposure + newAmount > GroupLimit)
    throw new InvalidPluginExecutionException(
        "This loan would exceed the customer's group exposure limit. Refer to credit risk.");
// Never: "Customer already has ₹4.2 cr in Mumbai (LN-1882, LN-1990)..."
```

The elevated query returns a number. The plugin uses it for a decision. The message tells Priya what to do without telling her what she isn't allowed to see. That's the line between using elevated access and leaking through it.

## Where plugins leak data without meaning to

- **Error messages** that include values read with elevated access ("this customer has loans in branches X and Y").
- **Fields copied onto records** the user can read, like the exposure total on the case.
- **Field-level security:** a SYSTEM service reads secured columns. Copying a secured column's value to an unsecured one publishes it.
- **Trace logs** (Part 8) that print data read with elevated access, readable by anyone with access to the trace table.
- **Owner and sharing changes** done as SYSTEM, which can hand records to teams that shouldn't have them.

A useful review question for every plugin: **"If Priya could see everything this plugin outputs, would she learn anything her role doesn't allow?"**

## Configuration and secrets

Steps have two configuration strings, both passed to the plugin's constructor:

- **Unsecure configuration:** readable by anyone who can read the step registration, and it travels inside your solution. Good for thresholds, feature flags, URLs. Never for secrets.
- **Secure configuration:** readable only by system administrators, and it does **not** travel with solutions, so each environment sets its own value. Acceptable for secrets if you have nothing better.

Better than both for secrets: Azure Key Vault with Power Platform managed identity, as covered in Part 5. No secret stored in Dataverse at all.

## Impersonation from callers

Integrations can call Dataverse "on behalf of" another user (impersonation), if the calling account has the privilege to do so. In that case your plugin sees `UserId` as the impersonated user, and `InitiatingUserId` as the account that actually made the call.

Know which one your logic needs:

- Business rules about what someone may do usually follow the effective user (`UserId`).
- Audit and accountability usually want the real caller (`InitiatingUserId`), especially when the caller is an integration acting for many people.

## The sandbox protects the server, not your data

Plugins run in an isolated sandbox with partial trust. They can't touch the file system or the registry, call native code, or reach localhost. That isolation protects the platform and other tenants. It does nothing to stop your code from reading data as SYSTEM and writing it somewhere it shouldn't go, including an external API. Data security inside your environment is your design, in your code.

## Day-2 situations tutorials never show

### "It works for admins but fails for users"

Your plugin reads or writes a table the user's role doesn't cover. Developers test as system administrators, so they never see it. Always test critical plugins as a user with the real business role. Then decide: grant the role, or deliberately elevate that one call.

### "Someone changed the run-as user and things broke"

The step was registered to run as a named person who left the company and was disabled. Use application users (service principals) for run-as identities, never people.

### "The audit shows SYSTEM changed it"

Your plugin made the change as SYSTEM and didn't record the human. Store `InitiatingUserId` on records your plugin creates or changes for audit purposes.

### "A secret showed up in our solution export"

It was in unsecure configuration. Rotate it, move it to Key Vault or secure configuration, and add a pipeline check that fails if unsecure configuration contains anything that looks like a key.

## Checklist

- Every `CreateOrganizationService` call has a deliberate identity: UserId, InitiatingUserId or null (SYSTEM).
- SYSTEM is used only for specific, documented calls, never as the default service.
- Elevated reads produce decisions, not data. Messages, fields and traces don't reveal what the user can't see.
- Secured column values are never copied to unsecured columns.
- Audit-relevant records store InitiatingUserId.
- Run-as users are application users with minimal custom roles.
- No secrets in unsecure configuration or code; Key Vault preferred.
- Critical plugins are tested as a normal business user, not only as an admin.

## If this comes up in an interview

**Q: What's the difference between UserId and InitiatingUserId?**  
UserId is the user the plugin runs as (which can be a configured run-as user or an impersonated user). InitiatingUserId is who actually started the request.

**Q: What does CreateOrganizationService(null) do?**  
Creates a service that runs as SYSTEM, which isn't constrained by the caller's security roles. Powerful, so use it narrowly.

**Q: How can a plugin leak data even if security roles are correct?**  
By reading with elevated access and writing the results to places the user can see: error messages, fields, traces, or secured column values copied to unsecured columns.

**Q: Secure vs unsecure configuration?**  
Unsecure is visible to anyone who can read the step and travels with solutions. Secure is visible only to admins and doesn't travel with solutions. Secrets ideally go to Key Vault.

**Q: Why shouldn't a plugin step run as a named person?**  
When that person leaves and is disabled, the step fails. Use an application user with a minimal role.

## What's next

Everything so far assumed the plugin is correctly registered in every environment. Part 10 is about making that true: solutions, steps as components, dependent assemblies, versioning rules, and pipelines that deploy plugins without anyone touching the Plugin Registration Tool in production.
