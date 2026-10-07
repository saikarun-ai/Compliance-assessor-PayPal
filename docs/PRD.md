# PRD — Compliance Assessor

## One-Line Pitch

An airgapped AI agent that classifies cross-border payments for RBI Purpose
Codes, creates PayPal invoices, and generates real-time social media trend
reports for influencers — all running on a 4GB laptop with no cloud dependency.

## Target Users

**Primary: Indian Freelancers**
- Developers, designers, consultants billing US/EU/UK clients $500–$10,000.
- Pain: don't know RBI Purpose Codes; fear EDF deadlines.
- Current tools: PayPal (high fees), Payoneer (partial compliance).

**Secondary: Indian Startups (SaaS)**
- 1–20 person teams billing international customers.
- Pain: Purpose Code errors cause delays; no EDF visibility.

**Tertiary: Indian Influencers**
- 10K–500K followers; foreign brand deals $200–$5,000.
- Pain: don't know what to charge; don't know how to classify sponsorship.

## Core Features (MVP)

| Feature | Priority | Description |
|---------|----------|-------------|
| Purpose Code Classifier | P0 | Natural language → RBI code |
| EDF Deadline Calculator | P0 | 30-day (software) or on-receipt |
| PayPal Invoice Creator | P0 | Sandbox, code in `invoice_number` |
| Influencer Trend Report | P1 | YouTube + Exa → LLM → pricing band |
| Local Web UI | P0 | Single page, localhost:3000 |
| Demo Video | P0 | 5-minute walkthrough |

## Out of Scope

- ❌ Real EDF filing
- ❌ Real money movement
- ❌ Authentication
- ❌ Mobile app
- ❌ Cloud deployment
- ❌ Reddit / Xiaohongshu / Facebook

## Success Metrics

- Demo runs on a 4GB laptop.
- Classifier ≥ 90% on the 6 verification cases.
- PayPal Sandbox invoice succeeds.
- Trend report generated in < 60 seconds.
- Judges understand the value in < 2 minutes.

## Prize Targets

- Best Use of PayPal + AI ($5,000)
- Most Impactful ($5,000)
- Best Demo Delivery ($5,000)
