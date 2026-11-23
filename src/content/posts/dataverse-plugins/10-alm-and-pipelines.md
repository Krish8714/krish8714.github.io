---
title: "ALM: Solutions, Dependent Assemblies, Versioning and Pipelines"
description: "What travels in a solution, plugin packages, the versioning rule, and a pipeline that deploys the same artefact everywhere."
series: dataverse-plugins
part: 10
pubDate: 2026-11-20
cover: /covers/plugins-part10.png
tags: [Dataverse, Plugins, Dynamics 365]
---

*Part 10 of my series, Dataverse Plugins: Built for Production. Nine parts about writing plugins well. Today: getting them into test and production the same way, every time, without anyone opening the Plugin Registration Tool against production.*

## "It works in dev"

Every Dataverse team has said it. The plugin works in dev. In UAT it doesn't fire. After an hour someone notices that the step in UAT has no filtering attributes, or the image alias is "Preimage" instead of "PreImage", or the step is still registered on the old assembly version. Somebody registered dev by hand, somebody else registered UAT by hand, and nobody registered them the same way.

Plugins are not just code. A plugin in production is code **plus** its registration: message, table, stage, mode, order, filtering attributes, images, configuration, run-as user. If any of that is set by hand in each environment, each environment is a slightly different system.

## Back at the bank

Priya's team has four environments: Dev, Test, UAT and Production. The co-applicant rule, the rate history, the credit check and the exposure check are all moving to production next sprint. The release manager asks one question: "How do we know Production will be configured exactly like UAT, where the business signed off?"

The only good answer is: "Because the same pipeline put the same solution in both."

## The thought shift

**The source of truth is the repository, not an environment.**

Dev is where you build and experiment. But what gets deployed is what's in source control: the plugin code and the solution that contains its registration. A pipeline builds it, tests it and imports it. Nobody "fixes it quickly" in UAT or production, because the next deployment would quietly undo the fix.

## What travels in a solution

When you add a plugin to a solution, these come with it:

- The **plugin assembly** (or plugin package, see below).
- The **plugin types** (your classes).
- The **SDK message processing steps**: message, table, stage, mode, execution order, filtering attributes, unsecure configuration, and the run-as setting.
- The **step images**: names, types and columns.

What doesn't travel:

- **Secure configuration.** By design. Each environment sets its own (or, better, uses Key Vault).
- **Environment-specific values** you put in unsecure configuration, like URLs. Those should move to **environment variables**, which are solution components with a value per environment, set during deployment.

Important habit: add the **steps** to the solution explicitly. Adding the assembly alone doesn't guarantee every step you created in dev comes along. Check the solution's component list before you export.

## Managed in every environment except dev

- **Dev:** unmanaged solution. You build here.
- **Test, UAT, Production:** managed solution, imported by the pipeline.

Managed solutions can be cleanly upgraded and removed, and they stop people editing components directly in the target environment. If someone does create an "unmanaged layer" on top (by editing a step in production), it will sit on top of your managed version and override future deployments. Check for unmanaged layers when something "won't update".

## Plugin packages and dependent assemblies

For years, using a third-party library in a plugin meant merging assemblies with ILMerge. Microsoft never supported that. The supported way now is **dependent assemblies**: you build a **plugin package** (a NuGet package) containing your plugin assembly and the libraries it depends on, and register the package. Dataverse stores it and makes the dependencies available at runtime.

- Microsoft recommends using it **from the start**, because converting a project later is harder.
- Assemblies registered without the package approach must be **strong-name signed**. With dependent assemblies, that requirement doesn't apply to the package in the same way.
- Don't include the Dataverse SDK assemblies themselves (`Microsoft.Xrm.Sdk` and so on). They already exist in the sandbox.
- Keep assemblies small. There's a size limit (16 MB for an assembly), and fewer, focused dependencies make troubleshooting easier.

The Power Platform CLI scaffolds this for you:

```bash
pac plugin init --outputDirectory src/Plugins   # creates a plugin project ready for packaging
dotnet build -c Release                         # produces the assembly and the .nupkg
```

## Versioning: the rule that surprises everyone once

An assembly version has four parts: major.minor.build.revision. Dataverse treats them differently:

- Change **build or revision** (1.0.**3**.0 → 1.0.**4**.0): the existing registered assembly is updated in place. Steps stay attached.
- Change **major or minor** (1.**0** → 1.**1**): Dataverse treats it as a **new, separate assembly** registered side by side. Your existing steps stay on the old one.

That second case is how teams end up with "my new code isn't running": the new version is registered, but the steps still point at the old. Keep plugin assembly major and minor stable, let the pipeline increment build or revision, and version the **solution** to reflect releases.

## The pipeline

A pipeline that has served many teams well, in outline:

1.  **Export from dev** (on demand or scheduled): export the unmanaged solution, unpack it with `pac solution unpack` into source control. Every change to a step, image or filtering attribute shows up as a readable diff in a pull request.
2.  **Build** on every pull request: build the plugin project, run the unit tests from Part 7, and pack the solution as managed with the freshly built assembly or package.
3.  **Deploy to Test** automatically: import the managed solution, set environment variables and connection references, then run the integration tests.
4.  **Deploy to UAT and Production** with approvals: the same artefact, not a rebuild.

```csharp
# Outline (Azure DevOps with Power Platform Build Tools, or GitHub Actions equivalents)
- Build plugin project and run unit tests
- pac solution pack  --zipfile out/LoanHub_managed.zip --folder solution/src --packagetype Managed
- Publish artefact
- Stage Test:  pac solution import --path LoanHub_managed.zip --settings-file test.settings.json
- Run integration tests
- Stage UAT / Prod (approval gate): import the same artefact with each environment's settings file
```

The settings file carries environment variable values and connection references per environment, so the solution itself stays identical.

If your organisation uses Power Platform Pipelines (the built-in, low-code deployment feature), the same principles apply: managed artefacts, one source, no manual edits in targets.

## Day-2 situations tutorials never show

### "The step is in dev but not in UAT"

It was never added to the solution. Add steps explicitly and review the component list in the pull request.

### "We deployed but the old code still runs"

Either the major/minor version changed and steps stayed on the old assembly, or an unmanaged layer in the target overrides the managed one. Check both.

### "Deployment failed: plugin type is in use"

You removed or renamed a plugin class that still has registered steps in the target. Remove or move the steps first (in the solution), deploy, then remove the class in a later release.

### "The URL is wrong in production"

It was in unsecure configuration, copied from dev. Use environment variables for anything that differs per environment.

### "Someone hotfixed production through the Plugin Registration Tool"

Now production differs from source control, and the next release will undo the fix. Any hotfix goes through dev and the pipeline, even if it's faster to click. Make production access for the tool an exception, logged and reviewed.

### "What .NET Framework should we target?"

Plugins target .NET Framework, not .NET (Core). Microsoft has published that support for .NET Framework 4.6.2 ends in January 2027 and announced plans for 4.8 support in the plugin runtime. Check the current guidance on Microsoft Learn and plan the retargeting as a deliberate, tested change across all your plugin projects.

## Checklist

- Plugin code and the unpacked solution live in source control.
- Steps and images are explicit solution components, reviewed in pull requests.
- Only dev has unmanaged solutions; all other environments get managed solutions from the pipeline.
- Dependent assemblies via a plugin package; no ILMerge.
- Assembly major/minor stay stable; build/revision increments automatically.
- Per-environment values in environment variables; secrets in Key Vault or secure configuration.
- The same artefact moves from Test to UAT to Production.
- No manual registration changes outside dev.

## If this comes up in an interview

**Q: What happens if you change the minor version of a plugin assembly?**  
Dataverse registers it as a new assembly alongside the old one, and existing steps stay on the old version. Build or revision changes update in place.

**Q: What is a plugin package?**  
A NuGet package containing the plugin assembly and its dependent assemblies, registered in Dataverse. It's the supported replacement for ILMerge.

**Q: Does secure configuration move with a solution?**  
No. Unsecure configuration does; secure configuration is set per environment.

**Q: Why managed solutions outside dev?**  
They can be cleanly upgraded and removed, and they prevent direct customisation in the target, keeping environments consistent.

**Q: Your change is deployed but doesn't take effect. What do you check?**  
Unmanaged layers on the component, whether the step points to the new assembly version, and whether the step was included in the solution.

## What's next

So far every plugin has reacted to a Create, Update or Delete. Part 11 flips it: Custom APIs, where you define your own message, and the honest question of when a plugin is the wrong tool altogether.
