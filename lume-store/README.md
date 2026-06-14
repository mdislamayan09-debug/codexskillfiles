# LUMÉ™ — Lash & Brow Renewal Serum Store

A complete, conversion-optimized website for the product I researched as the
single strongest **women's cosmetics** opportunity to launch right now
(June 2026): a **private-label lash & brow growth/conditioning serum.**

---

## 1. Why THIS product (the best-of-best, not just *a* trend)

You're right that cosmetics is a top-selling category. Within it, the smartest
*niche* product balances five things — and the lash & brow serum wins on all of them:

| Factor | Why lash & brow serum wins |
|---|---|
| **Viral RIGHT NOW** | "Lash serum before/after" and "eyebrow growth serum before after" are exploding on TikTok in 2026. The dramatic before/after clip is the single most-shared beauty format — built-in free reach. |
| **Repeat purchase (the real money)** | It's applied nightly and reordered every 1–3 months. Unlike a one-time novelty, this builds **lifetime value** — the thing that actually makes a beauty store profitable and lets you afford paid ads. |
| **Fat margins + cheap shipping** | A 5–10ml bottle sources for a few dollars, ships for pennies, and sells for **$30–45**. Beauty consumables routinely run **50–70% margins**. |
| **Brandable (you own the customer)** | Beauty buyers buy *brands*, not commodities. Private-label means you're not competing on price against 500 identical AliExpress listings. |
| **Tight, cheap-to-target niche** | "Sparse brows," "short lashes," "ditching extensions" are precise ad audiences — easy to reach profitably on Meta/TikTok. |

**The 2026 angle that matters:** market it **"prostaglandin-free / peptide-powered."**
That's exactly the trend (shoppers actively search "prostaglandin free"), and it
keeps you on the safe side of claims — peptide/conditioning serums are sold as
**cosmetics** (improving the *appearance* of fullness), not drugs.

### ⚠️ Compliance — read this before you launch
- Sell it as a **cosmetic**: say "fuller-/longer-**looking**," "conditions,"
  "appearance of." Do **not** claim it medically "grows" hair or treats a
  condition — that crosses into drug claims (FDA).
- **Stay prostaglandin-free.** Prostaglandin-analog lash serums carry
  side-effect concerns (irritation, darkened lids, eye-color change) and
  regulatory risk. Peptide/biotin/castor-oil formulas avoid this.
- The placeholder reviews, the "97%", and "100,000+" stats on the site are
  **examples** — replace with your own verified data before going live.

---

## 2. The website

Premium, mobile-first beauty landing page. No build step, no dependencies.

```
lume-store/
├── index.html   # full landing page
├── styles.css   # warm, editorial beauty design system
├── script.js    # cart drawer, sticky bar, before/after slider
└── README.md     # this file
```

**Preview locally:**
```bash
cd lume-store
python3 -m http.server 8080
# open http://localhost:8080
```

Includes: announcement marquee, an **interactive drag-to-compare before/after
slider** (the exact viral format), a 97%/8-week trust strip, an 8-week results
timeline, clean-ingredient breakdown, a "vs. lash extensions" comparison,
**3 bundle tiers** (the 2-bottle kit is the hero — it matches the 8-week
routine *and* lifts average order value), reviews, FAQ, sticky buy bar, and a
working cart drawer structured to map onto Shopify line items.

### Getting it into Shopify
1. **Fastest:** rebuild this layout on a single-product theme (**Shrine**,
   **Booster**, or free **Dawn**) — paste the copy/sections from `index.html`.
2. **Custom:** port `index.html` into a Liquid product template and wire the
   `data-add` buttons to Shopify's `/cart/add.js`; route checkout to `/checkout`.

---

## 3. Your supplier (beauty needs a *different* supplier than general dropshipping)

For private-label cosmetics, you don't want a generic AliExpress agent — you
want a beauty white-label app that ships in **your branding**.

| Supplier | Best for | Shopify app | Notes |
|---|---|---|---|
| **Blanka** ⭐ *recommended* | Private-label beauty, beginners | `apps.shopify.com` → search **"Blanka"** | North-America-made, **cruelty-free, no MOQ**, your logo on the product, native Shopify sync. Built for exactly this — serums & lash-enhancing products with high repurchase potential. ~5–10 day shipping. |
| **Jubilee** | Branded cosmetics + samples | search **"Jubilee"** | Cosmetics specialist with branded packaging and wholesale sample orders. |
| **DR.HC Cosmetic Lab** | Clean-beauty, made in USA | direct | California lab; dropships your branded item from a single unit — great for a clean-beauty story. |
| **CJ Dropshipping** | Cheapest test / generic version | `apps.shopify.com/cucheng` | Lowest cost to validate demand fast; less branding control. Good as a backup. |

**Recommended path:** Start on **Blanka** — order a **sample first** (~$20–40)
to confirm quality, packaging, and your private-label branding before you sell
a single unit. A small sample order saves you thousands in refunds later.

### Sourcing & margin math (typical)
- **Product + private-label cost:** ~$4–9/bottle
- **Your price:** $34.95 (1 bottle), $55.90 (2-pack) — **~$26–30 gross profit** on a single before ads
- **LTV multiplier:** nightly use → reorders every 1–3 months. One happy
  customer is worth far more than one sale — budget ads against LTV, not first order.
- Aim for a **3x+ markup** so paid traffic stays profitable.

---

## 4. Launch checklist
1. Install **Blanka** → pick the lash/brow serum → add your logo/label →
   **order a sample**.
2. Deploy this landing page as your product page (rename brand, swap in real
   product photos + a before/after video).
3. Confirm copy is **cosmetic-compliant** (appearance claims only,
   prostaglandin-free) and replace placeholder reviews/stats.
4. Set up Shopify Payments / Shop Pay + a **Subscribe & Save** app — recurring
   orders are the whole point of a consumable.
5. Film **before/after + application** vertical videos for TikTok/Reels/Shorts.
   This is the growth engine; test small, scale the winning creative.
