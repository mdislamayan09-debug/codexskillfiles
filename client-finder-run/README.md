# Client Finder Run

Working directory for a client-finder research run (US small e-commerce brands,
strict published-email-only contact bar).

- `research/` — raw verified candidate batches from research agents (JSON)
- qualified/rejected outputs and CSV/XLSX exports are written here once the
  candidate batches are compiled and passed through the deterministic
  `campaign_tools.py qualify` gate.

No lead is counted unless it clears every qualification gate: verified US small
e-commerce store, published official email, a second independent dated source
within 90 days, and a total score >= 75.
