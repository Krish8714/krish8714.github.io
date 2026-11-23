---
title: "Dynamics 365 Security, Explained with Real Scenarios"
description: "25 branches, 300 users, and one question from compliance. Business units, roles, column security, teams, and six scenarios that trip teams up."
series: dynamics-365-real-world
part: 2
pubDate: 2026-11-13
cover: /covers/rw-part2.png
tags: [Security, Dataverse, Dynamics 365]
linkedin: "https://www.linkedin.com/feed/update/urn:li:share:7526721812592824320"
---

25 branches. 300 users. One question from compliance:

"Why can a loan officer in Hyderabad see a customer's credit score in Chennai?" 😬

Part 2 of my Dynamics 365 Real-World Series: security, explained with real scenarios.

## In simple words, think of a bank building

- **Business units** = floors and rooms (Region → Branch)
- **Security role** = a key card: which doors, and how far (own records, branch, region, whole company)
- **Column security** = a locked drawer for sensitive fields like the credit score

## 5 implementations

1. Business units: Head Office → Regions → Branches
2. Roles with the right reach: User (officer), Business Unit (manager), Parent: Child BU (regional head), Organization read-only (auditor)
3. Column security on the credit score
4. Owner teams for cross-branch work
5. Roles on teams, not on individuals

## 6 tricky scenarios I've seen trip teams up

**1. "I can't attach a document to my loan."**
Attaching needs Append on Document AND Append To on Loan. Most roles miss one.

**2. "The customer isn't in the lookup."**
Read on Contact is at User level, so officers create duplicates. Too little access creates bad data.

**3. Loan reassigned, documents missing.**
Loan → Document is Referential, so documents stay with the old owner. Make it Parental.

**4. One duplicate customer deleted, 12 loans gone.**
Contact → Loan was Parental, which cascades delete. Use Referential, Restrict Delete.

**5. Officer moves branch, his loans vanish from the old manager's view.**
A user's records move with him to the new business unit. Reassign before moving.

**6. "Dashboard" role with Organization read.**
Now she can open every loan. Roles only add; there is no deny.

## Biggest myth

Hiding a field on the form is security. It still shows in views, exports and the API. Use column security.

## Interview question

A regional head with Parent: Child BU read can't see loans owned by Central Underwriting. Why?

**Next:** business rule, JavaScript, plugin or Power Automate? Where should your logic live?
