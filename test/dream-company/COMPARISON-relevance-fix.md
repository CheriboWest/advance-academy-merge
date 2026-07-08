# COMPARISON — Relevance fix (Cách A: title_only + filterByRoleRelevance)

BEFORE = raw Adzuna `what=<role>` (keywords anywhere). AFTER = live pipeline with the fix.
Off-topic = title fails the role head-token match.

| Search | BEFORE jobs | BEFORE off-topic | AFTER jobs | AFTER off-topic |
|--------|-------------|------------------|------------|-----------------|
| Data Analyst @ London | 15 | 4 | 16 | 0 |
| BI Developer @ London | 15 | 15 | 7 (sparse) | 0 |
| Marketing Manager @ London | 15 | 8 | 16 | 0 |
| Accountant @ Manchester | 15 | 15 | 12 | 0 |
| Software Engineer @ Leeds | 15 | 11 | 11 | 0 |

## Examples

**Data Analyst @ London**
- BEFORE off-topic examples: Digital Analytics Engineer · Insights Reporting Analyst - advertising · Senior Regulatory Business Analyst - COREP / Basel 3.1 - London | Investment Management - Strike IT · Tester / QA D365
- AFTER top 6: Technology Consultant - Data Analyst · Data Analyst - Insurance (Contract) · Data Analyst · MDM Data Business Analyst - SAP MDG & Informatica · Graduate Data Analyst - Remote - Data / Analytics - Must have a STEM degree - Strong Excel · Data Governance Analyst

**BI Developer @ London**
- BEFORE off-topic examples: Junior Manager, Business Intelligence · Senior Analyst · Senior Manager Data and Insights · Associate Director - Data Engineering
- AFTER top 6: BI Developer - 12 Month FTC · Power BI Developer · BI Developer / Analyst (All Levels) - UK Wide · Power BI Developer · Power BI Developer · Power BI Developer

**Marketing Manager @ London**
- BEFORE off-topic examples: Jr Client Services Manager - AdTech · Business Development Manager · Digital Marketing & Content Executive · Senior Category Manager Fashion & Living (FTC)
- AFTER top 6: Trainee Digital Marketing Manager | No experience needed (Ref: 6901) · Senior Sales Manager - Corporate - Sales & Marketing - The Landmark London · Owned & Operated (O&O) Marketing Manager, Prime Video · Client Service Account Manager- Digital Marketing · Sales Marketing and Front House Manager · Event Marketing Manager

**Accountant @ Manchester**
- BEFORE off-topic examples: Service Delivery Manager · Continuous Improvement Specialist · Transactional Accounts Assistant · PMO Project Director - Energy & Natural Resource
- AFTER top 6: Senior Accountant · Accountant · Capital Accountant · Management Accountant · Accountant · Accountant

**Software Engineer @ Leeds**
- BEFORE off-topic examples: Senior React Developer - SC Cleared · Graduate Structural Engineer · Civil Engineer / Civil Technician · Structural Engineer
- AFTER top 6: Software Engineer · Software Engineer · Lead Software Engineer · Software Engineer - Leeds · Android Software Engineer · Software Engineer Rust

## Acceptance (AC3/AC4)
- 0 off-topic jobs survive AFTER: **✅**
- AFTER never emptied by the filter (sparse flag instead): **✅ (see table)**

_All assertions passed._
