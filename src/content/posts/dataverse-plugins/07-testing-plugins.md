---
title: "Testing Plugins: Unit Tests and CI"
description: "Unit testing plugins without an environment, the cases that catch real bugs, and running tests in CI."
series: dataverse-plugins
part: 7
pubDate: 2026-11-20
cover: /covers/plugins-part7.png
tags: [Dataverse, Plugins, Dynamics 365]
---

*Part 7 of my series, Dataverse Plugins: Built for Production. Six parts of rules and patterns. Today: how to prove your plugin follows them, every time you change it, without clicking through a form.*

## "I tested it" usually means "I clicked Save once"

The typical plugin test looks like this. Build. Open the Plugin Registration Tool. Update the assembly. Open the app. Create a record. See the error message. Done.

That's one path, one caller, one shape of data. It doesn't test the Update where only the phone changed. It doesn't test the record where the co-applicant was cleared. It doesn't test the integration that sends every column. And next month, when someone changes the threshold logic, nobody repeats even that one click.

Plugins are code that guards business rules. They deserve the same automated tests as any other code. And because a plugin is just a class with an `Execute(IServiceProvider)` method, that's easier than most people think.

## Back at the bank

Priya's co-applicant rule from Part 1 has a regulator behind it: loans of ₹1 crore or more must have a co-applicant. If the plugin quietly stops enforcing it, the bank finds out in an audit, not in a bug report.

So the team agrees: every rule plugin ships with tests that run on every commit, and a pull request can't merge if they fail.

## The thought shift

**Test the decisions, not the platform.**

You don't need to prove that Dataverse saves records or runs plugins. Microsoft tests that. You need to prove that, given a certain context (message, Target, image, configuration), your plugin makes the right decision: block or allow, set this value or not, create this record or not.

A decision is just a function of its inputs. Give it inputs, check the output. No environment needed.

## What a plugin actually depends on

Look at the plugin from Part 1. It asks the service provider for two things:

- `IPluginExecutionContext`: message name, depth, InputParameters (Target), PreEntityImages.
- `ITracingService`: somewhere to write trace lines.

Plugins that read or write data also ask for `IOrganizationServiceFactory` to get an `IOrganizationService`. All of these are interfaces. In a test you hand the plugin your own fake implementations, and it can't tell the difference.

## Two ways to fake the platform

### Option 1: a testing framework

**FakeXrmEasy** is the best-known option. It gives you an in-memory "organization": you seed records, execute the plugin with a context it builds for you, and query the results. Recent versions even simulate the pipeline, including the merged single/multiple message behaviour from Part 6. Check its current licence terms for commercial use before you adopt it, since newer versions are licensed differently from the old ones.

### Option 2: your own small fakes

For rule plugins that mainly read the context, a few dozen lines of fakes are enough, and you control every detail. This is what I used to test the Part 1 plugin:

```csharp
class FakeContext : IPluginExecutionContext
{
    public string MessageName { get; set; }
    public int Depth { get; set; } = 1;
    public ParameterCollection InputParameters { get; } = new ParameterCollection();
    public EntityImageCollection PreEntityImages { get; } = new EntityImageCollection();
    // ... remaining interface members return defaults
}

class FakeTracer : ITracingService
{
    public List<string> Lines = new List<string>();
    public void Trace(string format, params object[] args) => Lines.Add(string.Format(format, args));
}

class FakeProvider : IServiceProvider
{
    public FakeContext Context = new FakeContext();
    public FakeTracer Tracer = new FakeTracer();
    public object GetService(Type t) =>
        t == typeof(IPluginExecutionContext) ? Context :
        t == typeof(ITracingService) ? (object)Tracer : null;
}
```

Either option is fine. What matters is which cases you test.

## The cases that actually catch bugs

Here's the list I wrote for the co-applicant plugin. Each one maps to a lesson from earlier parts:

1.  **Create, 1.2 crore, no co-applicant** → blocked. The happy path for the rule.
2.  **Create, 1.2 crore, with co-applicant** → allowed.
3.  **Update, only the phone changed, loan already has a co-applicant** → allowed. Proves we read the image, not just the Target (Part 3).
4.  **Update, amount raised from 50 lakh to 1.5 crore, no co-applicant in the database** → blocked. And the image doesn't contain the empty co-applicant column at all, exactly like the real platform. This is the case most tests miss.
5.  **Update, user clears the co-applicant on a 2 crore loan** → blocked. Proves "in Target with null" is treated as cleared, not as "not supplied".
6.  **Update, amount lowered below the threshold and co-applicant cleared** → allowed.
7.  **Configuration says 5,000,000** → a 60 lakh loan without co-applicant is blocked. Proves configuration is read.
8.  **Configuration is garbage ("abc")** → falls back to the default, doesn't crash.
9.  **No Target at all** (wrong registration) → returns quietly.

A test looks like this:

```csharp
[Fact]
public void Clearing_coapplicant_on_large_loan_is_blocked()
{
    var sp = new FakeProvider();
    sp.Context.MessageName = "Update";
    sp.Context.InputParameters["Target"] = Loan(("new_coapplicantid", null));       // cleared
    sp.Context.PreEntityImages["PreImage"] = Loan(
        ("new_amount", new Money(20000000m)),
        ("new_coapplicantid", new EntityReference("contact", Guid.NewGuid())),
        ("new_name", "LN-3"));

    var ex = Assert.Throws<InvalidPluginExecutionException>(
        () => new ValidateCoApplicant(null, null).Execute(sp));

    Assert.Contains("LN-3", ex.Message);
    Assert.Contains("co-applicant", ex.Message);
}
```

All nine run in under a second. Writing case 4 properly (empty column absent from the image) is exactly the kind of test that catches a plugin reading the wrong source.

## Make the code testable in the first place

Some plugins are hard to test because everything lives in one 200-line Execute method. A few habits help:

- **Keep Execute thin.** It gets services from the provider, extracts inputs, and calls a method that makes the decision. That method takes plain values (amount, co-applicant, threshold) and returns a result. You can test it with no fakes at all.
- **Constructor configuration** (Part 1) makes thresholds testable without changing code.
- **No static mutable state** (Part 6). It leaks between tests, just as it leaks between executions.
- **Time and IDs as inputs.** If a rule depends on "today", pass the date in, so a test can say "today is 31 March".

## What unit tests can't tell you

Unit tests prove your decisions. They don't prove your registration. A perfect plugin registered on the wrong stage, with a typo in the image alias, or without filtering attributes, will still misbehave. So add a thin layer of integration testing:

- A **dev or test environment** where the solution is deployed by the pipeline, not by hand.
- A **small set of integration tests** (a console app or test project using the Dataverse SDK client) that create and update real records for the critical rules and assert the outcome: the save is blocked, the field is set, the task exists.
- **Cleanup**: tests create their own data with a recognisable prefix and delete it afterwards.

Keep this layer small. Ten good integration tests for critical paths beat two hundred that nobody maintains.

## Running it on every commit

A test that runs only when someone remembers is a test that stops running. Put it in the pipeline:

```yaml
# Azure DevOps (outline)
trigger: [ main ]
pool: { vmImage: 'windows-latest' }
steps:
- task: DotNetCoreCLI@2
  displayName: Build plugins
  inputs: { command: build, projects: 'src/Plugins/*.csproj', arguments: '-c Release' }
- task: DotNetCoreCLI@2
  displayName: Unit tests
  inputs: { command: test, projects: 'tests/**/*.csproj', arguments: '-c Release --logger trx' }
- task: PublishTestResults@2
  inputs: { testResultsFormat: VSTest, testResultsFiles: '**/*.trx' }
# Next stages: pack the solution, deploy to test, run integration tests (Part 10)
```

Then protect the branch: pull requests must pass the build and tests. The co-applicant rule now can't be broken by accident, by anyone, without the pipeline going red first.

## Day-2 situations tutorials never show

### "The test passes but production fails"

The fake context doesn't behave like the real one. Most often: your test puts a null value in an image, but the real platform leaves the column out. Make your fakes match platform behaviour, and when production surprises you, turn the surprise into a new test case first.

### "We can't test it, it calls the bureau API"

Put the external call behind a small interface (`ICreditBureau`) that the plugin creates through a factory. In tests, provide a fake that returns 640, 700, a timeout. Now you can test the decision and the error messages without the network.

### "Tests got deleted because they were slow"

That happens when unit tests hit a real environment. Keep the two layers apart: hundreds of fast unit tests on every commit, a handful of integration tests after deployment.

### "Nobody knows what the plugin is supposed to do"

Good test names fix this. "Clearing coapplicant on large loan is blocked" is documentation that can't go out of date, because the build fails if it does.

## Using AI with this part

AI is very good at writing tests. It is less good at choosing the right cases.

**Good prompts:**

- *"Write unit tests for this plugin [paste] with a fake Dataverse context. Cover: create, update with a missing column, update that clears a column, wrong record state, and a second run of the same message."*
- *"Here are three production bugs we had [describe]. Write a test that would have caught each one."*

**Where AI gets it wrong:**

- It tests only the happy path.
- It mocks so much that the test checks the mock, not the plugin.
- It writes tests that need a real environment, so they are slow and get deleted, exactly as in the Day-2 section.

## Checklist

- Every rule plugin has unit tests that run without an environment.
- Tests cover Create, Update with only unrelated columns, Update with cleared values, empty columns missing from images, and configuration.
- Fakes behave like the platform (absent columns, not null values).
- Execute is thin; decisions live in testable methods.
- External calls sit behind interfaces with fakes.
- A small integration test set runs against a test environment after deployment.
- Tests run in CI on every pull request, and failing tests block the merge.

## If this comes up in an interview

**Q: How do you unit test a plugin without Dataverse?**  
Pass the plugin a fake IServiceProvider that returns fake context, tracing and organization service objects, either your own or from a framework like FakeXrmEasy, then assert on the outcome.

**Q: What's a case people usually forget to test?**  
An Update where the column in the image is absent because it's empty in the database, and an Update where the user clears a value (in Target with null).

**Q: What do unit tests not cover?**  
Registration: stage, mode, filtering attributes, image aliases and security context. That needs integration tests in a real environment.

**Q: How do you test a plugin that calls an external API?**  
Abstract the call behind an interface and inject a fake that simulates success, failure and timeout.

**Q: How do you make sure tests keep running?**  
Run them in the CI pipeline on every pull request and block merges on failure.

## What's next

Tests tell you the code is right before it ships. Part 8 is about knowing what it does after it ships: the plugin trace log, the Plugin Profiler for replaying production problems, and Application Insights for seeing everything over time.
