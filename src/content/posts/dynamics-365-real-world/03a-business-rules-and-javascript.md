---
title: "Where Should Logic Live? Business Rules and JavaScript"
description: "Your validation works on the form, then an Excel import lets 2,000 bad records in. The form side of the logic question: business rules, JavaScript, and six situations worth knowing."
series: dynamics-365-real-world
part: 3
label: "Part 3A"
pubDate: 2026-11-13
cover: /covers/rw-part3a.png
tags: [Business Rules, JavaScript, Dynamics 365]
linkedin: "https://www.linkedin.com/feed/update/urn:li:share:7526867859302453248"
---

Your validation works perfectly on the form.
Then someone runs an Excel import, and 2,000 bad records walk straight in.

This is one of the most common mistakes in Dynamics 365 projects, and it comes from one question nobody asks early enough: where should this logic live?

Part 3A of my Dynamics 365 Real-World Series covers the form side: business rules and JavaScript.

A simple way to picture it is a bank branch. A business rule is the sign at the counter. JavaScript is the assistant at the counter. Both only help people who walk in through the front door, which is the form. Plugins and Power Automate work in the vault and the back office. That's Part 3B.

So before writing any logic, ask: does this rule have to hold however the data arrives? If yes, the form alone won't protect you.

## Business rules

If-then logic built in a designer, with no code. For example: if the amount is above ₹25 lakh, show the Co-applicant field and make it required.

They can show, hide or lock a field, set a value, make a field required and show an error. They can't hide sections or tabs, read other tables or call an API.

The setting most people miss is **scope**:

- With one form or **All Forms**, the rule runs only in the browser.
- With **Entity** scope, it also runs on the server, so imports and API calls hit its error messages and set values. Show and hide still only affect forms.

## JavaScript

Code that runs in the browser while the form is open, on OnLoad, OnChange and OnSave. For example, showing "Invalid PAN" the moment the user leaves the field.

It gives the best experience, but it only runs on the form. Imports, flows, integrations and the Web API never open one.

## 6 situations worth knowing

1. **"Also hide the Guarantor section."** Business rules can't do sections. You need JavaScript and `setVisible(false)`.
2. **Co-applicant is required on the form, but empty after an import.** Set required is a form behaviour. Use an error message with Entity scope, or a plugin.
3. **The form rejects bad PANs, but the table is full of them.** The integration used the Web API, so the script never ran. The same check needs to exist in a plugin.
4. **A field is removed from the form and every load throws an error.** `getAttribute()` now returns null. Check for it before using the field.
5. **Old scripts still use `Xrm.Page`.** It's deprecated. Use `executionContext.getFormContext()`.
6. **The form freezes for a few seconds on load.** Usually a synchronous request. `Xrm.WebApi` is async and won't block the user.

## Rule of thumb

Start with a business rule, move to JavaScript when you hit a limit, and never rely on either one alone for data that has to stay clean.

**Interview question:** what changes when a business rule's scope is Entity instead of All Forms?
