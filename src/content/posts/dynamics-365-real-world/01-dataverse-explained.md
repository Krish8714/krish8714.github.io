---
title: "Dataverse Explained: From One Excel File to a Real Data Model"
description: "12 people, one Excel file, 3,000 loan applications. Part 1 turns that spreadsheet into a proper Dataverse data model."
series: dynamics-365-real-world
part: 1
pubDate: 2026-11-12
cover: /covers/rw-part1.png
tags: [Dataverse, Dynamics 365, Data Model]
linkedin: "https://www.linkedin.com/feed/update/urn:li:share:7526714683727376384"
---

12 people. One Excel file. 3,000 loan applications. Total chaos. 😵

Customer names spelled three ways. The same customer on five rows. Nobody knows who changed what.

This is where most Dynamics 365 projects start. So Part 1 of my Dynamics 365 Real-World Series starts here too: turning that spreadsheet into a proper Dataverse data model.

## The concept in simple words

Dataverse is Excel done properly:

- **Table** = a sheet (Standard, Custom, Activity, Virtual)
- **Column** = a heading with a fixed type, so nobody types "ten lakh" into an amount
- **Row** = a record with its own unique ID
- **Relationship** = one customer, many loans (1:N), or many guarantors, many loans (N:N)
- **Alternate key** = your business ID, guaranteed unique

## 5 hands-on implementations

1. Create the solution and the Loan Application table, the right way
2. Add the right columns: Currency, Choice, Date only, Yes/No
3. Link loans to customers and documents, with the right delete behaviour
4. Readable loan numbers with Autonumber, and an alternate key for migrations
5. Let the system do the maths: calculated and rollup columns

## The mistake I see most

Free-text columns for things that should be lookups. "Hyd" vs "Hyderabad" breaks every report.

## Interview question to test yourself

When would you use a 1:N relationship versus N:N? Give an example from lending.

**Next in the series:** why a branch manager sees only her branch (Dynamics 365 security explained).
