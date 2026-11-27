---
title: "Before Your First Plugin: C# for CRM People"
description: "Zero C# experience? Five simple Dynamics 365 plugins with every line explained, then six ways to break them on purpose, so you can read, write and debug the C# the rest of this series uses."
series: dataverse-plugins
part: 0
label: "Part 0"
pubDate: 2026-11-27
tags: [Dataverse, Plugins, Dynamics 365, C#]
---

*Part 0 of my series, Dataverse Plugins: Built for Production. It is for readers with zero C# experience, and it rebuilds my 2025 beginner tutorial. You get five working plugins with every line explained, then we break them on purpose, so that by the end you can read every line of Part 1, and know what to do when your own code fails.*

> **You don't need to be a C# developer to write plugins. You need to read about twenty pieces of C#, and know what each error is telling you.**

## The scenario: "can you just write a small plugin?"

Meera is a functional consultant on the bank's Dynamics 365 team. She knows the system inside out: tables, forms, business rules, flows. On Monday her lead asks for three small things before Friday:

1. New business accounts should get a default description.
2. Every new account needs a follow-up task for the relationship manager.
3. Users must not be able to delete accounts.

"Small plugin, should take an hour," he says. Meera has never written C#.

She finds a sample online, changes a few words, and asks a developer friend to build and register it. On Tuesday:

1. The project won't build. The error says *Cannot implicitly convert type 'string' to 'bool'*, which means nothing to her.
2. Once it builds, the plugin runs, but the description is never filled in. No error, nothing.
3. A colleague's contact plugin crashes for one user with *Object reference not set to an instance of an object*.
4. The "no delete" plugin is registered, but accounts still delete happily.

None of these is a hard problem. **Every one is a C# basic that nobody explained to her.** That is what this part is for.

By the end of this part you will be able to:

- Read a complete plugin and explain every line.
- Write the five plugins most beginners need: set a value, create a related record, change a value on update, validate, and block a delete.
- Tell the three kinds of failure apart, and know where to look for each.
- Use AI to learn C# faster, without copying its mistakes.

## The thought shift

Most beginners see one kind of problem: "my plugin doesn't work". In practice there are **three**, and each one has its own place to look:

1. **It won't build.** The C# compiler refused your code before it ever reached Dynamics 365. This is the *best* kind of failure: Visual Studio tells you the file, the line and the reason. Read the error list.
2. **It crashes.** The code built, ran, and hit an error, such as using an empty value. The user sees an error dialog. The details, including the exception type, are in the plug-in trace log.
3. **It silently does nothing.** The code ran, but an `if` was false, so it skipped your logic. There is no error anywhere. The only way to see this is to have the plugin write what it saw to the trace log.

When a plugin "doesn't work", ask first **which of the three** it is. That one question tells you where to look.

## The concepts in simple words

Every plugin is attached to three things:

| Term | In plain words | Example |
| --- | --- | --- |
| **Message** | The event that triggers the plugin | `Create`, `Update`, `Delete` |
| **Table** | Which table's event | `account`, `contact` |
| **Stage** | *When* in the save it runs | PreValidation, PreOperation, PostOperation |

- **PreValidation** runs first, before the main checks. The cheapest place to say no.
- **PreOperation** runs just before the record is written to the database. You can still change the record.
- **PostOperation** runs just after the write. The record exists and has an ID.

Every plugin class implements the `IPlugin` interface and has one method, `Execute`. Dynamics 365 calls `Execute(IServiceProvider serviceProvider)` every time the plugin is triggered. The `serviceProvider` is a toolbox: you ask it for the objects you need, such as the **execution context** (what is happening), the **organization service** (to read and write other records) and the **tracing service** (to write to the log).

### The C# words you will meet

Read this once, and come back whenever a word in the examples is new.

| C# | In plain words |
| --- | --- |
| `using` | "This file uses that library", so you can write `Entity` instead of `Microsoft.Xrm.Sdk.Entity` |
| `namespace` | The "address" of your code, like a folder name |
| `class` | A container for code. A plugin is one class |
| `interface` | A contract: a list of methods a class promises to have. `IPlugin` is Dynamics 365's contract |
| `: IPlugin` | "This class signs the `IPlugin` contract" |
| method | A named block of code, like `Execute` |
| `void` | The method returns nothing |
| variable | A named box that holds a value: `string email = ...;` |
| `string`, `bool`, `Guid` | Text; true/false; a record ID |
| `Entity` | A record: a row of a table, with its columns |
| `EntityReference` | A pointer to a record: its table name and ID, nothing else |
| `(Entity)x` | A **cast**: "I know `x` is an `Entity`, let me use it as one" |
| `x is Entity` | A **type check**: "is `x` an `Entity`?", true or false |
| `if (...) { }` | Run the code in the braces only when the condition is true |
| `&&` and `!` | "And", and "not" |
| `==` and `=` | `==` compares. `=` puts a value into something |
| `null` | "Nothing here." Using a `null` as if it were something is the most common crash |
| `throw` | Stop with an error |
| `new` | Create a new object: `new Entity("task")` |
| `;` | The end of one instruction |
| `// ...` | A comment: a note for humans. C# ignores it |

**C# is case-sensitive.** `Target` and `target` are two different words to C#. Keep that in mind; it comes back in Break 3.

### Your one debugging tool for this part: the trace log

Remember failure type 3, the plugin that silently does nothing. You catch it by making the plugin tell you what it saw. Ask the toolbox for the tracing service and write a line:

```csharp
ITracingService tracing = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
tracing.Trace("Message={0}, table={1}, stage={2}", context.MessageName, context.PrimaryEntityName, context.Stage);
```

`{0}`, `{1}` and `{2}` are placeholders, filled in order by the values after the text. The line appears in **Settings → Plug-in Trace Log**, once your administrator sets *Enable logging to plug-in trace log* to **All** in a dev environment. The stage is shown as a number: **10** PreValidation, **20** PreOperation, **40** PostOperation. The examples below leave tracing out to stay short. We add it back when we debug.

## Build it: five plugins, every line explained

To try these yourself, create a project with `pac plugin init`, paste in a class, build, and register it with the Plugin Registration Tool, using the message, table and stage given under each example. Part 1 shows the registration in detail.

The examples use standard tables (`account`, `contact`, `task`), so they work in any environment.

### Example 1: Set a default description on account create (PreOperation)

**What it does:** when a new account is created without a description, the plugin fills one in. This is Meera's first request.

**When it runs:** PreOperation, before the account is saved, so we can change the record before it is stored.

**Triggers on:** the `Create` message of the `account` table.

```csharp
using System;
using Microsoft.Xrm.Sdk;

namespace LoanHub.Plugins
{
    public class AccountCreatePrePlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            // Get the execution context
            IPluginExecutionContext context =
                (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));

            // Check that the input parameters contain a Target record
            if (context.InputParameters.Contains("Target") && context.InputParameters["Target"] is Entity)
            {
                // Get the account being created
                Entity account = (Entity)context.InputParameters["Target"];

                // Make sure this really is an account
                if (account.LogicalName == "account")
                {
                    // Only fill the description if the user left it empty
                    if (!account.Contains("description"))
                    {
                        account["description"] = "This account is newly created.";
                    }
                }
            }
        }
    }
}
```

**Line by line:**

- **`using System;` and `using Microsoft.Xrm.Sdk;`** bring in the libraries we need. `System` gives us `IServiceProvider`. `Microsoft.Xrm.Sdk` is the Dynamics 365 SDK: `IPlugin`, `IPluginExecutionContext`, `Entity` and everything else.
- **`namespace LoanHub.Plugins`** gives our code an address. Everything inside the outer braces lives there.
- **`public class AccountCreatePrePlugin : IPlugin`** creates a class called `AccountCreatePrePlugin` and signs the `IPlugin` contract. `public` means Dynamics 365 is allowed to see and use it.
- **`public void Execute(IServiceProvider serviceProvider)`** is the one method the contract requires. Dynamics 365 calls it when the plugin runs. `void` means it gives nothing back. `serviceProvider` is the toolbox.
- **`IPluginExecutionContext context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));`** is the line you will write in every plugin. Read it right to left: `typeof(IPluginExecutionContext)` names the tool we want, `GetService(...)` asks the toolbox for it, and because the toolbox returns a general `object`, the cast `(IPluginExecutionContext)` says "I know this is the execution context". The result goes into a variable called `context`, which tells us what is happening: which message, which table, which user, which stage.
- **`if (context.InputParameters.Contains("Target") && context.InputParameters["Target"] is Entity)`** checks that we have a record to work with. Dynamics 365 passes the data of the operation in `InputParameters`, a list of named values. On a Create, the new record is the value named `"Target"`. `Contains("Target")` asks "is there a value with that name?", `is Entity` asks "is it a record?", and `&&` means both must be true. If either is false, everything inside the braces is skipped.
- **`Entity account = (Entity)context.InputParameters["Target"];`** takes the Target and casts it to an `Entity`. The square brackets `["Target"]` read a value by its name. From now on, the variable `account` *is* the account being created.
- **`if (account.LogicalName == "account")`** double-checks the table. `LogicalName` is the table's system name. If someone registers the plugin on the wrong table by mistake, it does nothing instead of doing damage. Note the double `==`: it compares.
- **`if (!account.Contains("description"))`** asks "did the user leave the description out?" `Contains` checks whether the column is in the record, and `!` turns the answer around.
- **`account["description"] = "This account is newly created.";`** puts our text into the Description column. The single `=` puts a value in. Because this is PreOperation, the record hasn't been written yet, so our value is saved together with everything the user typed. No extra save is needed.

> **C# you just learned:** `using`, `namespace`, `class`, an interface, a method, a variable, casting, `is`, `if`, `&&`, `!`, `==` vs `=`, and reading or setting a column with square brackets.

### Example 2: Create a follow-up task on account create (PostOperation)

**What it does:** after a new account is created, the plugin creates a task to remind someone to follow up. Meera's second request.

**When it runs:** PostOperation, after the account has been saved, so it now has an ID that the task can point to.

**Triggers on:** the `Create` message of the `account` table.

```csharp
using System;
using Microsoft.Xrm.Sdk;

namespace LoanHub.Plugins
{
    public class AccountCreatePostPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            // Get the execution context and the organization service
            IPluginExecutionContext context =
                (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            IOrganizationServiceFactory serviceFactory =
                (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            IOrganizationService service = serviceFactory.CreateOrganizationService(context.UserId);

            if (context.InputParameters.Contains("Target") && context.InputParameters["Target"] is Entity)
            {
                Entity account = (Entity)context.InputParameters["Target"];

                if (account.LogicalName == "account" && context.OutputParameters.Contains("id"))
                {
                    // The ID of the account that was just created
                    Guid accountId = (Guid)context.OutputParameters["id"];

                    // Build a new task in memory
                    Entity task = new Entity("task");
                    task["subject"] = "Follow up with new account";
                    task["description"] = "Call or email the new account.";

                    // Link the task to the new account
                    task["regardingobjectid"] = new EntityReference("account", accountId);

                    // Save the task in Dynamics 365
                    service.Create(task);
                }
            }
        }
    }
}
```

**Line by line** (the lines from Example 1 work the same way):

- **`IOrganizationServiceFactory serviceFactory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));`** asks the toolbox for a *factory*, an object whose job is to make other objects. Same pattern as the context line: name the tool, ask for it, cast it.
- **`IOrganizationService service = serviceFactory.CreateOrganizationService(context.UserId);`** asks the factory for the **organization service**, the object that creates, reads, updates and deletes records. `context.UserId` is the user who saved the account, so everything the service does runs with that user's security roles. If the user may not create tasks, neither may the plugin.
- **`if (account.LogicalName == "account" && context.OutputParameters.Contains("id"))`** checks the table, and that Dynamics 365 has given us the new ID. After a record is created, Dynamics 365 puts its new ID into `OutputParameters`, under the name `"id"`. It is only there in PostOperation.
- **`Guid accountId = (Guid)context.OutputParameters["id"];`** reads that ID and casts it to a `Guid`, the type C# uses for record IDs (they look like `3f2504e0-4f89-11d3-9a0c-0305e82c3301`).
- **`Entity task = new Entity("task");`** creates a new, empty record *in memory*, for the `task` table. Nothing is saved yet. `new` is how C# creates an object.
- **`task["subject"] = "...";`** and **`task["description"] = "...";`** fill in two columns of the task.
- **`task["regardingobjectid"] = new EntityReference("account", accountId);`** fills the task's **Regarding** lookup. A lookup column holds an `EntityReference`: the table name and the ID. This is what links the task to the new account.
- **`service.Create(task);`** sends the task to Dynamics 365. This is the moment it is actually saved.

> **C# you just learned:** asking for more than one service, a `Guid`, creating an object with `new`, a lookup as an `EntityReference`, and calling a method on another object (`service.Create`).

### Example 3: Make a contact's first name uppercase on update (PreOperation)

**What it does:** whenever a contact is updated and the first name is part of the change, the plugin turns it into capital letters.

**When it runs:** PreOperation, before the change is saved.

**Triggers on:** the `Update` message of the `contact` table.

```csharp
using System;
using Microsoft.Xrm.Sdk;

namespace LoanHub.Plugins
{
    public class ContactUpdatePlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            IPluginExecutionContext context =
                (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));

            if (context.InputParameters.Contains("Target") && context.InputParameters["Target"] is Entity)
            {
                Entity contact = (Entity)context.InputParameters["Target"];

                // Only when the first name is part of this update
                if (contact.LogicalName == "contact" && contact.Contains("firstname"))
                {
                    // Read the first name as text
                    string firstname = contact.GetAttributeValue<string>("firstname");

                    // Only if there is a name (the user may have cleared it)
                    if (!string.IsNullOrEmpty(firstname))
                    {
                        contact["firstname"] = firstname.ToUpper();
                    }
                }
            }
        }
    }
}
```

**Line by line:**

- **`if (contact.LogicalName == "contact" && contact.Contains("firstname"))`** checks the table, then asks whether the first name is part of this update. This is the big idea of the example: **on an Update, the Target contains only the columns being changed**, not the whole record. If the user changed only the phone number, `firstname` is not in the Target at all.
- **`string firstname = contact.GetAttributeValue<string>("firstname");`** reads the first name the safe way. The `<string>` in angle brackets tells the method which type you want back. If the column is missing or empty, you get `null` instead of a crash.
- **`if (!string.IsNullOrEmpty(firstname))`** asks "is there actually a name?" `string.IsNullOrEmpty` is true when the text is `null` (nothing) or `""` (empty), and `!` turns it around. We need it because a user can *clear* the first name: then the column is in the Target, but its value is `null`.
- **`contact["firstname"] = firstname.ToUpper();`** turns the text into capitals and puts it back into the Target. `ToUpper()` is a method every `string` has. Because this is PreOperation, the uppercase name is what gets saved.

> **C# you just learned:** `GetAttributeValue<T>`, the angle brackets of a *generic* method, `null` vs empty text, `string.IsNullOrEmpty`, and a method that belongs to a value (`firstname.ToUpper()`).

### Example 4: Validate a contact's email (PreOperation)

**What it does:** when a contact is created or updated, the plugin checks that the email contains an `@`. If it doesn't, the plugin stops the save and shows a message.

**When it runs:** PreOperation, so the check happens before anything is saved.

**Triggers on:** the `Create` and `Update` messages of the `contact` table. You register the same plugin twice, once for each message.

```csharp
using System;
using Microsoft.Xrm.Sdk;

namespace LoanHub.Plugins
{
    public class ContactEmailValidationPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            IPluginExecutionContext context =
                (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));

            if (context.InputParameters.Contains("Target") && context.InputParameters["Target"] is Entity)
            {
                Entity contact = (Entity)context.InputParameters["Target"];

                // Only when the email is part of this save
                if (contact.LogicalName == "contact" && contact.Contains("emailaddress1"))
                {
                    string email = contact.GetAttributeValue<string>("emailaddress1");

                    // There is an email, and it has no '@'
                    if (!string.IsNullOrEmpty(email) && !email.Contains("@"))
                    {
                        // Stop the save and show this message to the user
                        throw new InvalidPluginExecutionException(
                            "The email address \"" + email + "\" is not valid. It must contain '@'. Correct it and save again.");
                    }
                }
            }
        }
    }
}
```

**Line by line:**

- **`contact.Contains("emailaddress1")`** checks whether the email is part of this save. `emailaddress1` is the system name of the contact's main Email column.
- **`string email = contact.GetAttributeValue<string>("emailaddress1");`** reads it safely, exactly like the first name in Example 3.
- **`if (!string.IsNullOrEmpty(email) && !email.Contains("@"))`** joins two conditions with `&&`. First, there is an email (an empty email is allowed here). Second, `email.Contains("@")` asks whether the text has an `@`, and `!` turns it into "does *not*". C# checks the conditions left to right and stops as soon as one is false, so `email.Contains` never runs on a `null` email.
- **`throw new InvalidPluginExecutionException("...");`** stops the plugin with an error. This exception type is special: in a synchronous plugin, Dynamics 365 cancels the whole save and shows *your* message to the user.
- **`"The email address \"" + email + "\" ..."`** builds the message. `+` joins pieces of text, and `\"` puts a quote mark inside text (a plain `"` would end it). We include the wrong email, so the message still makes sense in an import log, where nobody can see the form.

A real email check needs more than an `@`, but this is the pattern for every validation: read safely, check, throw a clear message.

> **C# you just learned:** `throw`, `InvalidPluginExecutionException`, joining text with `+`, `\"` inside text, and how `&&` stops early.

### Example 5: Prevent account deletion (PreValidation)

**What it does:** stops anyone deleting an account, with a message that says what to do instead. Meera's third request.

**When it runs:** PreValidation, the first stage of the delete and the cheapest place to say no, because nothing has started yet. (Part 2 explains when PreValidation and PreOperation differ.)

**Triggers on:** the `Delete` message of the `account` table.

```csharp
using System;
using Microsoft.Xrm.Sdk;

namespace LoanHub.Plugins
{
    public class AccountDeletePlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            IPluginExecutionContext context =
                (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));

            // On Delete, the Target is a reference, not a record
            if (context.InputParameters.Contains("Target") && context.InputParameters["Target"] is EntityReference)
            {
                EntityReference accountRef = (EntityReference)context.InputParameters["Target"];

                if (accountRef.LogicalName == "account")
                {
                    // Stop the delete
                    throw new InvalidPluginExecutionException(
                        "Accounts can't be deleted. Deactivate the account instead.");
                }
            }
        }
    }
}
```

**Line by line:**

- **`context.InputParameters["Target"] is EntityReference`** is the one big difference from the other examples. On a Delete there is no record to send, only a pointer to the record being deleted: an `EntityReference`, with its table name and ID.
- **`EntityReference accountRef = (EntityReference)context.InputParameters["Target"];`** casts the Target to an `EntityReference`.
- **`if (accountRef.LogicalName == "account")`** checks the table. An `EntityReference` has a `LogicalName` and an `Id`, but no other columns.
- **`throw new InvalidPluginExecutionException("Accounts can't be deleted. Deactivate the account instead.");`** cancels the delete and shows the message. A good message says what the user can do instead.

> **C# you just learned:** `EntityReference` as a Target, and why checking the type with `is` matters.

## Break it, debug it, fix it

Now we break the working plugins on purpose, six ways. Every one of them is a mistake that beginners make in their first week, and four of them are what went wrong for Meera on Tuesday. For each: what you see, how to find the cause, the fix, and the habit that prevents it.

| # | What you broke | What you see | Failure type |
| --- | --- | --- | --- |
| 1 | `=` instead of `==` | Build error CS0029 | 1. Won't build |
| 2 | A missing `;` | Build error CS1002 | 1. Won't build |
| 3 | `"target"` instead of `"Target"` | Nothing at all | 3. Silently does nothing |
| 4 | `.ToString()` on a cleared value | *Object reference not set to an instance of an object* | 2. Crashes |
| 5 | `is Entity` on a Delete | Nothing at all: the delete goes through | 3. Silently does nothing |
| 6 | `throw new Exception` | A generic error; your message is hidden | 2. Crashes, badly |

### Break 1: `=` instead of `==`

**Break it:** in Example 1, change the table check to a single `=`:

```csharp
if (account.LogicalName = "account")
```

**What you see:** the project won't build. The Error List says:

> error CS0029: Cannot implicitly convert type 'string' to 'bool'

**Debug it:** double-click the error and Visual Studio jumps to the line. Now read the message slowly. A single `=` *puts* `"account"` into `LogicalName`, and the result of that is a `string`. But `if` needs a `bool`, a true or false. C# can't turn text into true or false, so it refuses.

**Fix it:** `==` to compare.

**Prevent it:** read `=` as "becomes" and `==` as "equals". `if (x = y)` reads "if x becomes y", which makes no sense, and that is exactly what the compiler told you.

### Break 2: a missing `;`

**Break it:** delete the `;` at the end of `account["description"] = "This account is newly created."`.

**What you see:**

> error CS1002: ; expected

Often with more errors on the lines below, which look scary.

**Debug it:** always start with the **first** error in the list. One missing `;` can confuse the compiler about the next few lines too, so the later errors are often just echoes of the first. Fix it, rebuild, and most of the others disappear.

**Fix it:** put the `;` back.

**Prevent it:** every instruction ends with `;`. Lines that *open* a block (`if (...)`, `public class ...`) don't, because the block in braces `{ }` is the instruction.

### Break 3: `"target"` instead of `"Target"`

**Break it:** in Example 1, type `Contains("target")`, with a lowercase *t*.

**What you see:** it builds, it registers, it runs, and the description is never filled in. No error anywhere. This was Meera's second problem.

**Debug it:** this is failure type 3, so make the plugin tell you what it saw. Add the tracing service and a line just before the `if`:

```csharp
ITracingService tracing = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
tracing.Trace("Has target: {0}, has Target: {1}", context.InputParameters.Contains("target"), context.InputParameters.Contains("Target"));
```

The trace log shows `Has target: False, has Target: True`. C# is case-sensitive: to C#, `target` and `Target` are different names, and only one of them exists. So the `if` was false, and everything inside it was skipped.

If you had read it with square brackets instead, `context.InputParameters["target"]`, it would not be silent: it would crash with *The given key was not present in the dictionary.* That message always means "you asked for a name that isn't there". Check the spelling and the capital letters.

**Fix it:** `"Target"`, with a capital *T*. Column names are the opposite: they are always lowercase system names, such as `description` and `emailaddress1`.

**Prevent it:** copy names instead of typing them. And when a plugin "does nothing", trace the values your `if` statements depend on before you change any code.

### Break 4: `.ToString()` on a cleared value

**Break it:** in Example 3, read the first name the way my 2025 article did:

```csharp
string firstname = contact["firstname"].ToString();
```

**What you see:** most updates work. But when a user *clears* the first name and saves, they get an error, and the plug-in trace log shows:

> NullReferenceException: Object reference not set to an instance of an object.

This was Meera's colleague's crash.

**Debug it:** "Object reference not set to an instance of an object" always means **you used something that was `null`**. Look at the line for anything followed by a dot. Here, `contact["firstname"]` is `null`, because the user cleared it, and `.ToString()` is a dot on that `null`. You can't ask "nothing" to turn itself into text.

**Fix it:** read with `GetAttributeValue<string>("firstname")`, which gives `null` without crashing, then check `string.IsNullOrEmpty` before you use it, exactly as Example 3 does.

**Prevent it:** before every dot, ask "can the thing on the left be `null`?" In plugins the answer is usually yes: columns can be missing from the Target, or present but empty.

### Break 5: `is Entity` on a Delete

**Break it:** in Example 5, check for an `Entity`, like the other examples do:

```csharp
if (context.InputParameters.Contains("Target") && context.InputParameters["Target"] is Entity)
```

**What you see:** the plugin is registered on Delete and runs, and accounts still delete happily. Meera's fourth problem.

**Debug it:** trace what the Target really is:

```csharp
tracing.Trace("Target type: {0}", context.InputParameters["Target"].GetType().Name);
```

The log says `Target type: EntityReference`. On a Delete there is no record to send, so Dynamics 365 sends a reference. `is Entity` is false, the `if` is skipped, and nothing stops the delete.

If you had cast it directly, `(Entity)context.InputParameters["Target"]`, it would crash with an *InvalidCastException* instead: "this is not what you said it was".

**Fix it:** `is EntityReference` and `(EntityReference)`, as in Example 5.

**Prevent it:** remember the rule. Create and Update: the Target is an `Entity`. Delete: an `EntityReference`. Always check with `is` before you cast.

### Break 6: `throw new Exception`

**Break it:** in Example 4, throw a plain exception:

```csharp
throw new Exception("The email address is not valid.");
```

**What you see:** the save is blocked, but the user doesn't see your message. They get a generic error dialog with a **Download Log File** button, and your words are buried inside the log.

**Debug it:** compare it with the working Example 4. The only difference is the type of exception.

**Fix it:** `throw new InvalidPluginExecutionException("...")`. It is the one exception type that Dynamics 365 shows to the user, as you wrote it.

**Prevent it:** use `InvalidPluginExecutionException` for every message meant for a user. Any other exception means "a bug", and it should look like one.

## Day 2: what goes wrong after go-live

The six breaks happen on your own machine. These are the beginner questions that come up again and again on the Microsoft community forums once a first plugin meets real users.

### 1. "It works on create but crashes on update"

**What you see:** the plugin was tested by creating records, and it was perfect. In production, users who *edit* a record get *The given key was not present in the dictionary.*

**Why it happens:** on an Update, the Target holds only the columns being changed. The code reads `target["new_amount"]` with square brackets, and when the user changed only the phone number, that column isn't there.

**How to handle it:** read with `GetAttributeValue`, and check `Contains` when you need to know whether a column was sent, as Example 3 does. Then always test an Update that changes a *different* column. When the plugin needs a column the user didn't change, the answer is a pre-image, which is the first topic of Part 1.

### 2. "My plugin sets the value, but it isn't saved"

**What you see:** a developer moves Example 1 to PostOperation "to be safe". The trace log proves the line `account["description"] = ...` ran. The description is still empty.

**Why it happens:** in PostOperation the record has already been written. Changing the Target there changes a copy in memory that nobody saves.

**How to handle it:** if you change the record being saved, register on PreOperation and change the Target. If you must change it after the save, that needs a separate `service.Update` call, which has costs of its own. Part 2 is about exactly this choice.

### 3. "Object reference not set..." on a lookup

**What you see:** a plugin reads the account's primary contact and crashes for some accounts only.

**Why it happens:** the code is `((EntityReference)account["primarycontactid"]).Id`. For accounts without a primary contact, the lookup is empty, so `.Id` is a dot on `null` (Break 4 again). For an update that doesn't include the column, the square brackets fail with *The given key was not present in the dictionary* instead.

**How to handle it:** read lookups like every other column, then check for `null` before you use the ID:

```csharp
EntityReference primaryContact = account.GetAttributeValue<EntityReference>("primarycontactid");
if (primaryContact != null)
{
    Guid contactId = primaryContact.Id;
}
```

`!=` means "is not equal to". When the error appears "for some records only", look for an empty value in exactly those records.

## Using AI to learn C# for plugins

AI is a patient C# teacher, as long as you treat it like a fast junior developer whose work you check.

### Where it helps

- **Explaining code you didn't write:** paste a plugin and ask for a line-by-line explanation in plain words.
- **Explaining errors:** paste the compiler error or the trace log and the code, and ask what it means.
- **Testing your understanding:** ask it to quiz you on what a piece of code does when a value is empty.

### Prompts that work (copy and adapt)

```text
I know Dynamics 365 well but I have never written C#. Explain this
plugin line by line in simple words. For each line, say what it does
when a user saves a record, and name the C# concept it uses: <paste>.
```

```text
My Dynamics 365 plugin fails. Here is the code: <paste>. Here is the
error from Visual Studio or the plug-in trace log: <paste>. Is this a
build error, a crash or a "silently does nothing" problem? List the
likely causes in order, and how to confirm each one.
```

```text
Walk through this plugin step by step for three cases: a Create, an
Update that changes only the phone number, and an Update that clears
the first name. Which lines run, and where could it crash? <paste>
```

### Where AI goes wrong here

- It reads columns with `target["..."].ToString()`, which crashes on empty values (Break 4).
- It throws a plain `Exception`, so users see a generic error (Break 6).
- It treats the Delete Target as an `Entity` (Break 5).
- It suggests a .NET 8 class library. Plugins must target .NET Framework: 4.6.2, or 4.8 on recent Dataverse builds.
- It mixes in client-side JavaScript (`Xrm.Page`, `formContext`). Plugins are server-side C#.
- It invents column names. Check every logical name against your table.

Never paste real customer data, connection strings or passwords into an AI tool.

## The "my plugin didn't work" checklist

- [ ] **Which type is it?** Won't build, crashes, or silently does nothing?
- [ ] **Won't build:** fixed the **first** error in the list, then rebuilt?
- [ ] **Crashes:** read the exception type in the trace log? *Object reference...* = a `null` before a dot. *Given key not present* = a name that isn't there.
- [ ] **Silently does nothing:** traced the values your `if` statements depend on?
- [ ] **Names:** `"Target"` with a capital *T*; column names lowercase and spelled exactly?
- [ ] **Target type:** `Entity` on Create and Update, `EntityReference` on Delete?
- [ ] **Messages for users:** thrown as `InvalidPluginExecutionException`?

## Interview questions, with the answers that land

**1. What is `IPlugin`, and what does `Execute` receive?**

The interface every plugin implements. `Execute` receives an `IServiceProvider`, from which I get the execution context, the tracing service and the organization service factory.

**2. What is in the Target on Create, Update and Delete?**

On Create, an `Entity` with what the user filled in. On Update, an `Entity` with only the changed columns. On Delete, an `EntityReference`: just the table name and ID.

**3. Why use `GetAttributeValue` instead of square brackets to read a column?**

Square brackets throw "the given key was not present" when the column isn't in the Target, and calling a method on an empty value throws a null reference error. `GetAttributeValue` returns `null` or a default, and I check before I use it.

**4. How do you set a value on the record being saved without an extra update?**

Change the Target in PreOperation. The value is saved with the record. In PostOperation it is too late.

**5. How does a plugin stop a save, and what does the user see?**

It throws `InvalidPluginExecutionException` in a synchronous step. The save is cancelled and the user sees my message. Any other exception shows a generic error.

**6. A plugin "does nothing". How do you debug it?**

First I decide whether it didn't build, crashed or silently skipped its logic. If nothing failed, I add trace lines for the values my `if` statements depend on, and read the plug-in trace log, before I change any code.

## Rule of thumb

**When a plugin fails, first ask which kind of failure it is. The compiler, the trace log and your own trace lines will tell you the rest.**

## Next in the series

**Part 1: Your First Plugin, Not Just the Demo.** One real business rule, from the first line of code to the 11 PM support ticket. You will see the same C# from this part, used the production way.

## Sources

- [Write a plug-in](https://learn.microsoft.com/power-apps/developer/data-platform/write-plug-in) (Microsoft Learn)
- [Understand the execution context](https://learn.microsoft.com/power-apps/developer/data-platform/understand-the-data-context) (Microsoft Learn)
- [Event framework](https://learn.microsoft.com/power-apps/developer/data-platform/event-framework) (Microsoft Learn)
- [Supported customizations for Dataverse](https://learn.microsoft.com/power-apps/developer/data-platform/supported-customizations) (Microsoft Learn)
