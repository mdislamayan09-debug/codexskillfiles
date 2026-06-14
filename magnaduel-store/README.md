# MAGNADUEL™ — Viral Magnetic Strategy Game Store

A complete, conversion-optimized single-product website for the product I
researched as the strongest niche viral opportunity to launch **right now
(June 2026)**: the **magnetic strategy duel game** (the "magnet + string"
head-to-head game).

---

## 1. Why THIS product (the research)

You asked for *one* genuinely unique, currently-viral product with real
upside — quality over quantity. This is it, and here's the case:

| Signal | Evidence |
|---|---|
| **Currently viral** | The branded version ("Kollide" by Relatable) sold **100,000+ units on TikTok Shop** and has graduated into Target, Amazon, and Meijer — a textbook viral-to-retail trajectory still on its upswing. |
| **Perfectly demoable** | It goes viral *because* of the format: a 10–15s clip of two people sweating over an "almost snap" is exactly what `#tiktokmademebuyit` rewards. The product sells itself in video. |
| **Genuinely unique** | Not another phone case or LED strip. It's a novelty *mechanic* (magnetic tension) people haven't seen — high "what is that?!" stopping power. |
| **Broad audience** | Couples / date night, family game night, dorms, road trips, gift-givers (ages 8–80). Not a narrow niche → easy to scale ad audiences. |
| **High margin** | Sources for ~$3–6 landed; sells for **$29.95+**. Room for profitable paid traffic. |
| **Low-friction fulfillment** | Small, light, non-fragile, no sizes/variants → cheap shipping, low return rate. |

**Note on branding:** "Kollide" is a registered brand. Do **not** copy their
name, logo, or photos. Sell the **generic version** under your own brand
(this template uses "MAGNADUEL" as a placeholder — rename freely) with your
own creative. That's standard and keeps you clean.

---

## 2. The website

A fast, modern, mobile-first landing page built to convert paid social
traffic. No build step, no dependencies — just open it.

```
magnaduel-store/
├── index.html   # full landing page
├── styles.css   # design system (dark/electric "magnetic" theme)
├── script.js    # cart drawer, sticky buy bar, live counter, board demo
└── README.md    # this file
```

**Preview locally:**
```bash
cd magnaduel-store
python3 -m http.server 8080
# open http://localhost:8080
```

What's included: announcement marquee, sticky nav + cart, animated hero with
an interactive magnetic board, social-proof strip, "how to play," addiction
hooks, **3 bundle tiers** (single / duo / family — the duo is the margin
sweet spot), reviews, FAQ, sticky buy bar, and a working cart drawer.

### Getting it into Shopify
You have two clean paths:
1. **Fastest:** Recreate this layout in Shopify using a single-product theme
   like **Shrine**, **Booster**, or the free **Dawn** theme. Paste the copy
   and section structure from `index.html` into Shopify sections.
2. **Custom:** Port `index.html` into a custom Liquid template
   (`templates/product.viral.liquid`) and wire the `data-add` buttons to
   Shopify's `/cart/add` AJAX API. The `script.js` cart is structured to map
   1:1 onto Shopify line items — swap the `addToCart`/`checkout` functions to
   call `/cart/add.js` and route checkout to `/checkout`.

---

## 3. Suppliers to add to your Shopify (pick one)

All four integrate directly with Shopify via an app — install, search the
product, click "import to store," set your price.

| Supplier | Best for | Shopify app | Why |
|---|---|---|---|
| **CJ Dropshipping** ⭐ *recommended start* | Best balance of price + speed | `apps.shopify.com/cucheng` | US/EU warehouses for faster delivery, free sourcing requests (they'll find this exact game in 48h), built-in branding & video. |
| **DSers** | Sourcing straight from AliExpress | `apps.shopify.com/dsers` | Official AliExpress partner; cheapest unit cost; widest selection of this game. |
| **Zendrop** | Speed + simple UX | `apps.shopify.com/zendrop` | Fast US shipping options, auto-fulfillment, custom branding. |
| **Spocket** | Fastest US delivery | `apps.shopify.com/spocket` | US/EU-based sellers → 2–5 day shipping, which crushes return/chargeback rates on impulse buys. |

**Recommended play:** Start on **CJ Dropshipping** (submit a sourcing request
for the game so they stock it in a US warehouse), and keep **DSers/AliExpress**
as a backup source while you validate. Move to bulk/3PL once you hit ~20
orders/day.

### Exact search terms to find the product on these suppliers
- `magnetic chess game` / `magnetic strategy game`
- `magnet ball game with string`
- `magnetic attraction board game`
- `magnetic duel tabletop game`

### Sourcing & margin math (typical)
- **Product cost:** ~$2.50–$5.50/unit
- **Shipping:** ~$2–$5 (US warehouse) or free-ish on AliExpress (slower)
- **Landed cost:** ~$5–$9
- **Your price:** $29.95 (single) → **~$21–25 gross profit/unit** before ads
- Target a 3x+ markup minimum so paid traffic stays profitable.

---

## 4. Launch checklist
1. Install **CJ Dropshipping** app → import the magnetic game → set price $29.95.
2. Deploy this landing page as your product page (rename brand + add your own
   photos/video — do not use Kollide's assets).
3. Set up Shopify Payments / Shop Pay + the trust badges shown on the page.
4. Shoot **3–5 short vertical videos** of the "almost snap" tension moment.
   This is the entire growth engine — film it for TikTok, Reels, and Shorts.
5. Start with a small TikTok/Meta test budget; scale the winning creative.

> ⚠️ Quick disclaimers: trend timing matters — re-verify TikTok demand before
> spending big, and follow magnet-toy safety labeling (ages 8+). All review
> text, the "watching now" counter, and stats on the page are placeholders —
> replace with your real numbers before going live.
