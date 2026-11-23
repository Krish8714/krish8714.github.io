---
title: "Where Should Logic Live? Plugins and Power Automate"
description: "Can a flow stop loans without a co-applicant? No. The server side of the logic question: plugin stages, what Power Automate can and can't do, and eight situations worth knowing."
series: dynamics-365-real-world
part: 4
label: "Part 3B"
pubDate: 2026-11-13
cover: /covers/rw-part3b.png
tags: [Plugins, Power Automate, Dynamics 365]
linkedin: "https://www.linkedin.com/feed/update/urn:li:share:7526867897298698240"
---

"Can we use a flow to stop loans without a co-applicant?"
The answer is no. By the time the flow runs, the loan is already saved.

Part 3B of my Dynamics 365 Real-World Series covers the server side: plugins and Power Automate.

Part 3A handled the form. But imports and integrations never open a form, so rules that must always hold belong on the server.

## Plugins

C# code that runs on the Dataverse server. Every save passes through it, whether it comes from the form, an import, the API or a flow. You register it on a message (Create, Update), a table, a stage, and sync or async.

The stages are easier to remember like this:

- **PreValidation** asks "should I allow this at all?" It's the cheapest place to reject.
- **PreOperation** says "let me fix this before it's saved." Values you change here are saved without an extra update.
- **PostOperation** says "it's saved, now follow up." It's still in the same transaction, so an error here rolls everything back.

Example: loans of ₹1 crore or more must always have a co-applicant. A PreValidation plugin throws an error, and the form, the Excel import and the API all get the same message.

## Power Automate

A low-code flow that triggers when a row is added, modified or deleted. It runs a few seconds after the save is committed.

It's ideal for things like emailing the customer, posting in Teams and creating a SharePoint folder when a loan is approved. What it can't do is block or undo a save, and users never see its errors on the form.

## 8 situations worth knowing

1. **Plugin fails with "The given key was not present."** On Update, Target only has the fields that changed. Read the others from a pre-image.
2. **One save, and the plugin runs ten times.** There are no filtering attributes, so it fires on every change. Limit it to the fields you care about.
3. **The plugin updates its own record and keeps looping.** Set the value in PreOperation instead, or check `context.Depth`.
4. **Saving a loan takes 40 seconds.** A synchronous plugin is calling a slow external API, and there's a 2-minute timeout. Move it to async or hand it off to Azure.
5. **A flow is used to block bad data.** It runs after the commit, so it can only clean up. Blocking needs a plugin.
6. **"I saved, refreshed, and the flow didn't work."** It probably did, just a few seconds later. If the user needs the value immediately, use a sync plugin.
7. **Every flow fails on Monday morning.** The connection owner left and their account was disabled. Run production flows under a service account or service principal.
8. **Two flows keep triggering each other.** Use Select columns and trigger conditions on every Dataverse trigger.

## The test I'd recommend

Try every rule through the form, an Excel import and a Web API call. If it only holds on the form, it's a suggestion, not a rule.

**Interview question:** when would you choose PreValidation over PreOperation?

The deep dive on plugins became its own series: [Dataverse Plugins, Built for Production](/series/dataverse-plugins/).
