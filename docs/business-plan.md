# "Counter" — Product Requirements & Design Document for an All-in-One POS and Small-Business Platform for Irish Shops and Coffee Shops

*A serious, buildable plan for a solo founder using IBM Design Thinking as the organising method. Primary market: Republic of Ireland.*

> **Sourcing note (read first):** I was unable to run live web verification in this environment, so every time-sensitive Irish fact (2026 hospitality VAT rate and its effective date, 2026 national minimum wage, Revenue eInvoicing/VAT-modernisation dates, PSD3/PSR timeline, SEPA Instant/Verification-of-Payee mandate dates, contactless limit, Revolut API token quirks) is marked **[VERIFY]**. Treat those as strong priors to confirm against primary sources (Revenue.ie, Central Bank of Ireland, EUR-Lex, official developer docs) before you rely on them commercially or legally. Everything not marked [VERIFY] is stable domain knowledge.

---

## TL;DR
- **Win the counter, then grow the suite.** Build a genuinely fast, **offline-first till** as the wedge and expand module-by-module (stock → finance → payments → marketing → multi-site) into an Odoo-like all-in-one that is *delightful at the counter* and *honest in the back office*. Differentiate on speed, no hidden fees, no lock-in, and Irish tax/compliance built in.
- **Payments: rent before you build.** Start with cash + **semi-integrated** third-party terminals (SumUp / Stripe Terminal / Revolut Reader), hide the acquirer behind a swappable `PaymentProvider` interface, then move to **SoftPOS / Tap-to-Pay (PCI MPoC)** before ever contemplating your own certified hardware — which is a multi-year, capital- and team-heavy endgame, not a solo milestone.
- **Be honest about solo limits.** A solo founder can realistically ship MVP till + basic stock + accounting *export* in ~9–15 months. Native double-entry finance, payroll, and social publishing need hires or integrations. **Over-scoping the all-in-one is your single biggest risk** — the plan below is deliberately staged to prevent it.

---

## Key Findings
1. **The "all POS suck" pain is specific and addressable.** It concentrates in nine places: order-entry speed, modifier IA ("modifier hell"), offline failure, split/merge bills, refund/void tracking, training time, reports that lie (gross vs net, voids/comps/discounts muddled), hardware lock-in, and contract lock-in + hidden fees. Each maps to a concrete design decision below.
2. **All-in-one beats point solutions for Irish micro-businesses because of the *seams*, not the features.** A typical Irish café runs a POS + a different card terminal + Surf/Big Red Cloud/spreadsheet accounts + Bizimply rostering + a loyalty app + Later/Buffer social — six silos and painful month-end reconciliation. Consolidation's value is auto-reconciliation and one truthful number. The risk is being mediocre at everything; the mitigation is being best-in-class at the till first and integration-friendly everywhere else.
3. **Odoo is the right ambition and the right cautionary tale.** Its strength is one data model with modular apps (POS, Inventory, Accounting, CRM, HR, Website, Marketing). Its weakness is exactly the user's complaint: powerful but not delightful, configuration-heavy, intimidating at the counter, with variable Irish localisation. Strategy: **Odoo-like modularity, Square-like counter simplicity.**
4. **Ireland has an unusually founder-friendly compliance quirk: no mandatory POS fiscalisation.** Unlike many EU states, Ireland does not require certified fiscal cash registers — a genuine design freedom. But you still need an immutable audit trail, ~6-year record retention **[VERIFY]**, correct mixed-rate VAT, and readiness for phased **B2B eInvoicing/real-time VAT reporting** **[VERIFY dates]** — so build to EN 16931 / PEPPOL BIS from day one.
5. **Payments certification is the trap.** Semi-integrated terminals keep card data off your devices (PCI scope minimised) and let you swap acquirers. Building your own terminal drags in EMV L1/L2/L3, PCI PTS POI, PCI DSS, and Visa/Mastercard scheme certification — years and serious capital. **SoftPOS (PCI MPoC) / Tap to Pay on iPhone & Android** is the realistic "own acceptance" step in between.
6. **Revolut is integrable but has operational sharp edges.** Business API (accounts, transactions, counterparties, payments, drafts, expenses), Merchant API (orders, webhooks, Revolut Pay, Apple/Google Pay), and Revolut Reader (SDK). Auth is OAuth 2.0 with JWT client assertion signed by an X.509 certificate; a widely reported quirk is short-lived tokens and periodic (~90-day) re-authorisation that complicates unattended server integrations **[VERIFY]**. Abstract it so it's replaceable.

---

## Details

## Part A — IBM Design Thinking, Applied

### The Principles
1. **A focus on user outcomes.** Success = "a new barista takes a correct order in under 60 seconds on day one" and "the owner closes the books in an hour, not a weekend," not "features shipped."
2. **Restless reinvention.** Ship small, watch real cafés, rip out what doesn't work. The all-in-one is built incrementally, never big-bang.
3. **Diverse empowered teams.** For a solo founder this means a *virtual* team: sponsor users (baristas, owners, an accountant) and early contract designers, with decision rights pushed to whoever is closest to the counter.

### The Loop (Observe → Reflect → Make, continuously)
- **Observe:** shadow shifts in Irish cafés/shops — order entry, queue build-up, cash-up, month-end. Record friction verbatim.
- **Reflect:** as-is journeys, empathy maps, pain-point and need statements.
- **Make:** wireframe → prototype → pilot in one café → measure → iterate. Each loop ends in a Playback.

### The Keys

**Hills (Who / What / Wow):**
- **H1 — Speed:** *A new barista, during a lunch rush, can take and modify a complex coffee order and take payment without ever asking for help — because the till never makes them hunt or wait.*
- **H2 — Truth:** *An owner-operator, on a Monday morning, can trust a single number for last week's real profit — including waste, discounts, voids and VAT — without exporting to a spreadsheet.*
- **H3 — Continuity:** *A shift manager, when the internet drops mid-rush, keeps taking orders and card-terminal payments as if nothing happened — because the till is offline-first and syncs later with zero data loss.*
- **H4 — Compliance-invisible:** *A bookkeeper, at VAT-return time, can produce a Revenue-ready VAT3 and a clean audit trail in minutes — because mixed-rate tickets, tips and card settlements were modelled correctly from the first tap.*

**Playbacks (solo → small team cadence):**
- Weekly: founder self-playback against the active Hill.
- Fortnightly: sponsor-user playback (demo to 2–3 café owners/baristas).
- Monthly: advisory playback (accountant + one retail operator).
- Per-phase: stakeholder playback at each roadmap gate with an explicit go/no-go.

**Sponsor Users — Irish recruitment plan:**
- Target **5–8 sites:** 3 independent coffee shops (one high-volume city-centre, one suburban, one with a kitchen/food), 2 small retailers (deli/convenience, boutique), 1 multi-site mini-chain (2–4 stores), and 1 external accountant/bookkeeper serving hospitality.
- Channels: Dublin/Cork independent café networks, Speciality Coffee Association Ireland contacts, local Chambers of Commerce, r/ireland and r/dublin small-business threads, and cold visits offering free/lifetime pilot terms in exchange for shadowing access.
- Commitment ask: shadowing during shifts, fortnightly feedback, willingness to run the pilot till alongside the incumbent system.

### As-Is Scenario Map — coffee shop morning rush
| Stage | Actor | Action | Pain |
|---|---|---|---|
| Pre-open | Owner | Count float, start POS, check stock | Slow boot; no reliable stock count |
| Rush | Barista | Take order, ring modifiers | Modifier hell: buried menus, too many taps |
| Rush | Barista | Split bill, apply loyalty | Clumsy split; loyalty a separate app |
| Rush | Customer | Wait, unsure order placed | No order-ready signal; counter crowding |
| Payment | Barista | Card terminal | Not integrated; manual re-key; mismatch |
| Mid-day | Manager | Void/refund | Hidden flow; manager PIN every time |
| Close | Manager | Z-report, cash-up | Numbers don't reconcile; unexplained variance |
| Month-end | Bookkeeper | VAT, reconciliation | Spreadsheet exports; mixed VAT a nightmare |

### Empathy Map — Barista "Aoife"
- **Says:** "Where's the oat-milk button?" **Thinks:** "Don't let the queue judge me." **Does:** taps fast, guesses. **Feels:** stressed, watched. **Pain:** hidden modifiers, PIN interruptions. **Gain:** muscle-memory layout, one-handed use.

### Personas
1. **Aoife — Barista/floor staff (22):** speed and clarity over power; minimal training; wet/gloved hands.
2. **Diarmuid — Owner-operator (41):** wants truthful profit, low fees, no lock-in; not technical.
3. **Sinéad — Shift manager (29):** rosters, cash-up, voids, handovers; needs control + audit.
4. **Brendan — External accountant/bookkeeper (50s):** VAT3, ROS, clean ledger, exports to Surf/Big Red Cloud/Xero.
5. **Cathal — Customer (35):** fast queue, order-ready notification, low-friction loyalty, GDPR respected.

### Pain-Point Analysis — the anatomy of "all POS suck"
Speed of order entry · modifier hell · offline failure · split/merge bills · refunds/voids/comps hidden or untracked · training time in days not minutes · reporting that lies · hardware lock-in · contract lock-in and hidden fees (multi-year terms, per-feature paywalls, PCI "non-compliance" charges, processing markups).

### To-Be Scenario Map
Fast fixed-grid ordering with smart modifiers → offline-first everything → one-tap split/merge → tracked voids/refunds → order queue with customer notification → cash-up that reconciles → month-end that is one clean export or a native VAT3.

### Big Ideas → Prioritisation Grid (Impact vs Effort)
| Idea | Impact | Effort | Verdict |
|---|---|---|---|
| Offline-first till | High | High | Do first (core moat) |
| Smart modifier engine | High | Med | Do first |
| Order queue + KDS + notify | High | Med | Phase 2 |
| Stock w/ recipes/wastage | High | Med | Phase 2 |
| Native double-entry ledger | High | High | Phase 3 (integrate first) |
| Own certified terminal | Med | Very High | Defer (2–4 yr) |
| Social/marketing module | Med | Med | Phase 4 |
| Multi-site/marketplace | Med | High | Phase 5 |

### Need Statements (POV format)
- Aoife needs to *place complex orders without hunting* because *queue pressure makes hesitation costly*.
- Diarmuid needs to *see true weekly profit* because *he cannot trust his current POS reports*.
- Brendan needs a *clean, mixed-VAT-rate audit trail* because *reconstructing it manually is error-prone*.

---

## Part B — Executive Summary & Product Thesis

**The wedge:** a genuinely fast, offline-first till for Irish coffee shops and small shops, priced transparently, that grows into an Odoo-like suite. Win the counter first; earn the right to run the whole business.

**Why all-in-one wins here:** the value is removing *seams*, not adding features. Auto-reconciling card settlements to sales, one truthful profit number, no double entry between six tools. **The trade-off we accept:** deliberately being *narrow-but-excellent* at launch (the till), integrating rather than building the rest, and only widening scope once each module earns its place. Positioning in three words: **fast, honest, Irish, open.**

---

## Part C — Competitive Analysis

### POS — Hospitality & Retail
| Product | Pros | Cons / complaints | Pricing model | Lock-in / offline |
|---|---|---|---|---|
| **Square (Restaurants/Retail)** | Fast setup, free base tier, good hardware, big ecosystem; live in Ireland | Processing fees accumulate; offline card handling risky; ecosystem lock-in; support gripes | Free–tiered SaaS + per-tx | Processing lock-in; partial offline |
| **Lightspeed (X-Series/K-Series)** | Deep retail inventory, strong reporting, restaurant features | Expensive; aggressive contracts/upsell; billing & lock-in complaints | SaaS tiers + payments | Contract lock-in; limited offline |
| **Toast** | Best-in-class restaurant KDS/coursing/handhelds | US-centric (no meaningful Irish presence); proprietary hardware lock-in; long contracts; fee complaints | Hardware + SaaS + payments | Heavy hardware lock-in |
| **Clover** | Flexible app market; many acquirers resell it | Fragmented by reseller; acquirer lock-in; app fees | Hardware + SaaS + payments | Acquirer lock-in |
| **SumUp** | Cheap readers, strong Ireland/EU presence, simple POS Lite/Pro | Shallow hospitality depth | Low/flat + per-tx | Low lock-in; reader-centric |
| **Zettle (PayPal)** | Cheap, simple, good for micro | Shallow features; PayPal ecosystem | Per-tx + optional SaaS | Low lock-in |
| **Shopify POS** | Excellent if e-commerce-led; unified inventory | Hospitality-weak; add-on costs | SaaS + payments | Ecosystem lock-in |
| **Epos Now** | Cheap hardware bundles; UK/IE presence | Recurring complaints re support, contracts, upsell, reliability | Hardware + SaaS | Contract complaints |
| **TouchBistro** | Strong iPad restaurant UX; offline-capable | Add-on pricing; hardware needs | SaaS + add-ons | Local-network reliance |
| **Revel** | Enterprise iPad POS; deep features | Expensive, complex; contract lock-in | SaaS + contract | Lock-in |
| **Loyverse** | Free, simple, loved by micro-retail | Limited depth; monetised add-ons | Free + add-ons | Low lock-in |
| **Odoo POS** | Part of full ERP; offline-capable POS; cheap | Usability/complexity; config burden; limited hospitality depth | Per-app SaaS or self-host | Self-host = no lock-in |
| **Erply / Nobly / Goodtill / Storekit** | Niche retail/hospo strengths (IE/UK) | Varying depth/support | SaaS | Varies |
| **Zonal / Comtrex / Tevalis** | Enterprise hospitality | Costly, integrator-led, not micro-friendly | Enterprise | Heavy |
| **Flipdish (Irish)** | Strong online ordering/branded apps | Ordering-led, not full POS | SaaS + commission | Ecosystem |
| **Bizimply (Irish)** | Rostering/T&A/HR depth | Not a POS; complements | SaaS | — |
| **Irish resellers (CBE, Retail Solutions, ACR)** | Local support, install/hardware | Legacy stacks, contracts, closed | Hardware + service | Heavy |

### All-in-one suites (scope benchmark)
| Product | Strength | Weakness (esp. usability) |
|---|---|---|
| **Odoo** (the benchmark) | Modular apps on one data model; self-host option; cheap | Steep learning curve; config burden; UI density; limited hospitality/Irish-localisation depth |
| **ERPNext** | Open-source full ERP | Technical to run; dated UX |
| **Zoho One** | Huge breadth; cheap per-user | Integration seams; uneven depth |
| **MS Dynamics 365 BC** | Deep finance/ERP; Irish partners | Enterprise cost/complexity |
| **NetSuite** | Enterprise ERP | Expensive; overkill for micro |
| **Katana / Cin7 / Unleashed** | Manufacturing/inventory depth | Not POS-led; add-ons |

**Odoo architecture note:** power comes from a single ORM/data model with layered apps and a strong studio/plugin story. For our target that same density is the enemy — it intimidates baristas and owners and needs setup expertise. We copy the modularity, reject the density.

### Accounting / finance (Ireland)
| Product | Notes | POS integration |
|---|---|---|
| **Xero** | Popular; strong bank feeds/API; big ecosystem | Rich API; common target |
| **QuickBooks Online** | Broad; good API | Common |
| **Sage Business Cloud** | Strong IE/UK; payroll | API |
| **FreeAgent** | Simple; micro/freelancer | API |
| **Bullet (Irish)** | Irish payroll/accounts; ROS-oriented | Limited API |
| **Big Red Cloud (Irish)** | Long-standing Irish SME accounts; Revenue-savvy | API/exports |
| **Surf Accounts (Irish)** | Irish cloud; accountant-friendly | API/exports |

**Strategy:** integrate to Xero/Sage/Surf/Big Red Cloud as an **escape hatch from day one** (data-portability principle); build native ledger later.

### Queue / order management & KDS
"Queueing orders" in practice = order-state pacing + kitchen display + customer notification: KDS ticket rails, coursing, prep-time estimation, buzzers/pagers, SMS/app "order ready," virtual queues, click-and-collect. Toast and Square KDS set the coursing/bump bar. The **delivery multi-tablet problem** (separate tablets for Deliveroo/Just Eat/Uber Eats) is solved by aggregation middleware — **Deliverect, Otter, Chowly, HubRise** — consolidating channels into one POS/KDS feed. **Ingest via one aggregator rather than integrating each platform directly at first.**

### Social / marketing
| Tool | Role | Constraint to respect |
|---|---|---|
| Later / Buffer / Hootsuite / Sprout | Scheduling | IG/TikTok publishing via official APIs only, with limits |
| Canva | Creative | — |
| Meta Business Suite | Native FB/IG | Best-supported publishing path |
| Mailchimp / Klaviyo | Email/SMS | Consent/GDPR |
| Birdeye / Podium | Reviews/messaging | Google Business Profile API limits |
| Google Business Profile | Reviews/posts/menu | Posting/review API limits |

**Platform API reality:** Instagram Graph API content publishing is rate-limited and requires a Business/Creator account plus Meta app review; TikTok Content Posting API requires audit/approval; auto-posting to personal accounts is restricted. Be honest: schedule where APIs allow; "compose + reminder to post in the native app" where they don't.

### "Pros we steal / cons we avoid" synthesis
| Steal (pro) | From | Avoid (con) | From |
|---|---|---|---|
| Fast fixed-grid order entry | Square | Weak offline | Cloud POS |
| Coursing/KDS bump | Toast | Hardware/contract lock-in | Toast/Clover |
| Cheap reader onboarding | SumUp | Shallow hospitality depth | SumUp/Zettle |
| Modular one-data-model | Odoo | Config burden / UX density | Odoo |
| Strong bank feeds/API | Xero | Per-feature paywall creep | Lightspeed/Epos Now |
| Online ordering/branded app | Flipdish | Commission dependence | Aggregators |
| Rostering/T&A depth | Bizimply | Siloed data | All point tools |

---

## Part D — Functional Requirements (by module)

### D1. Point of Sale
- *≤2 taps to add an item, ≤2 more to modify.* AC: fixed-grid menu; modifier sheet on tap/long-press; sensible default modifiers pre-selected; per-tap latency <100ms.
- *Split a bill by item or evenly.* AC: split by seat/item/amount/percentage; merge tabs; move items between tabs.
- *Void/refund with full audit.* AC: reason codes; role-gated; immutable audit entry; partial refunds; linked to original tender.
- *Offline-first.* AC: order entry, printing, KDS, and semi-integrated card payment all succeed with no internet; lossless sync with conflict resolution on reconnect.
- *Tips.* AC: card/cash tips captured; pooled or individual; compliant with the **Payment of Wages (Amendment) (Tips and Gratuities) Act 2022** — electronic tips distributed fairly and transparently, tips-and-gratuities policy displayed **[VERIFY commencement 1 Dec 2022]**.
- Cash management (float, paid-in/out, skims, safe drops, blind counts, variance); X/Z reports; shift handover; multi-till; age verification prompts; loyalty at till.

### D2. Order Queueing & Fulfilment (the user's specific ask)
- **Order-state model:** `NEW → ACCEPTED → IN_PREP → READY → HANDED_OVER → CLOSED` plus `VOID`, `REFUNDED`, `ON_HOLD`. **Event-sourced** so every transition is auditable and replayable offline.
- **KDS:** ticket rails, bump/recall, coursing, prep-time estimation, colour SLAs, all-day counts.
- **Pacing:** fire courses on demand; hold-and-fire; kitchen load balancing.
- **Customer notification:** buzzer/pager fallback + SMS/app "order ready"; queue-number screen.
- **Click-and-collect & delivery ingest:** order-ahead; slot management; aggregator ingest via Deliverect/Otter/HubRise.
- ACs: state transitions atomic and offline-safe; notification only after `READY`; aggregator orders inherit the same state model.

### D3. Payment Terminal Integration
- **Now:** semi-integrated — POS sends amount to terminal; terminal handles card data (PCI scope off the POS); result returns. Support SumUp, Stripe Terminal, Revolut Reader, Zettle.
- **Abstraction:** a `PaymentProvider` interface (authorize, capture, refund, void, tip-adjust, settlement-fetch, webhook-normalise) so acquirers are swappable and a future own-terminal drops in behind the same interface.

### D4. Inventory & Stock
- SKUs, variants, barcodes (GS1/EAN), recipes/BOM with yield and wastage (e.g., 1 kg beans → N shots), par levels, purchase orders, goods-in, supplier management, stocktakes, shrinkage.
- **Allergens** under **EU FIC Regulation (EU) No 1169/2011** and FSAI requirements (14 named allergens declared).
- Batch/expiry; multi-location transfers.
- ACs: recipe depletion updates stock on sale; wastage recorded with reason; negative-stock alerts; allergen data mandatory before an item goes live.

### D5. Financial Management
- **Double-entry ledger** — event-sourced, append-only, immutable audit trail.
- **Chart of accounts** template for Irish micro-business.
- **VAT:** mixed rates on one ticket (e.g., hot coffee eat-in at reduced rate + a standard-rated retail item + a zero-rated cold takeaway item); tips correctly excluded from VAT; **VAT3** preparation; **ROS** filing/export.
- **Irish VAT rates [VERIFY 2026]:** standard **23%**, reduced **13.5%**, second-reduced **9%**, zero **0%**. Food-service/hospitality history: 9% (COVID) → reverted to **13.5% on 1 Sept 2023** → Budget 2026 signalled a return to **9%** for food-service hospitality **[VERIFY effective date]**.
- **Hot/cold/eat-in distinction:** catering/restaurant services and hot takeaway food fall under the reduced rate; certain cold takeaway/basic foods are zero-rated; confectionery/soft drinks/ice cream are standard-rated — model per item **and** per fulfilment mode.
- Bank feeds & reconciliation; expenses; supplier invoices; payment runs; debtor management; fixed assets; period close; accountant-grade exports; integrations to Xero/Sage/Big Red Cloud/Surf.
- **eInvoicing/VAT modernisation [VERIFY]:** Ireland is moving toward phased real-time digital VAT reporting / B2B eInvoicing — emit structured invoices (EN 16931 / PEPPOL BIS) so the mandate is a config switch, not a rebuild.

### D6. Payroll & Scheduling — build vs integrate
- **Decision: integrate first** (Bright/Collsoft/Sage/Bizimply). Payroll + **PAYE Modernisation** real-time reporting to Revenue is high-risk to build solo.
- Provide native rostering, clock-in/out, labour-cost-vs-sales %, Sunday premium, minimum-wage bands **[VERIFY 2026 NMW]**, and tips-distribution compliance; push hours to the payroll partner.

### D7. CRM, Loyalty & Customer Engagement
- GDPR-compliant consent (Irish DPC), loyalty (points/stamps), gift cards, vouchers, marketing-consent tracking with audit. ACs: no marketing without recorded consent; right-to-erasure honoured; loyalty works offline at the till.

### D8. Social Media & Marketing
- Content calendar; scheduling within API limits; AI-assisted captions/photo suggestions; review management; Google Business Profile sync; menu publishing; email/SMS. Where APIs forbid auto-posting, provide "compose + reminder to post in the native app."

### D9. Reporting & Analytics — "reports that don't lie"
- **Semantic layer** with agreed definitions: gross vs net, discounts, voids, comps, COGS, margin by item, hourly sales heatmaps, staff performance, waste. ACs: every headline number drills to source events; VAT always separable; voids/comps never inflate sales.

### D10. Multi-site, franchise & back-office
- Central menu/price management; per-site overrides; consolidated reporting; inter-site transfers; franchise royalties.

### D11. Admin, roles, permissions, audit logging
- RBAC; PIN/biometric; granular permissions; full immutable audit log of sensitive actions.

---

## Part E — Non-Functional Requirements
- **Offline-first architecture:** local-first store; event sourcing / CRDT sync; deterministic conflict resolution. Must-work-offline set = order entry, print, KDS, semi-integrated card payment, cash, loyalty lookup. Sync is background and lossless.
- **Performance budgets:** cold-start time-to-first-tap ≤3s; per-tap UI latency ≤100ms; local order commit ≤200ms.
- **Reliability:** till app 99.9% local availability independent of cloud; graceful degradation.
- **Security:** PCI DSS scope minimisation via semi-integrated terminals (no PAN on our devices); tokenisation; PII encrypted at rest/in transit; least privilege.
- **Accessibility (WCAG 2.2 AA)** + café realities: high contrast for glare; large targets for wet/gloved hands; colour-blind-safe palette; dyslexia-friendly type; one-handed reach; visual (noise-independent) feedback.
- **i18n/multi-currency readiness; device support:** iPad, Android tablet, web back-office, mobile companion.
- **Data portability/no-lock-in** as a first-class principle: full export any time.

---

## Part F — System Architecture (opinionated, for a solo founder)
- **Modular monolith**, not microservices. One deployable; clean module boundaries mirroring the product modules. *Trade-off accepted:* less independent scaling in exchange for enormous solo velocity and simpler ops.
- **Stack:** TypeScript end-to-end for one-person velocity — React / React Native (Expo) for till + web back-office; Node/TypeScript backend; **PostgreSQL** as system of record.
- **Local-first sync engine:** evaluate **PowerSync** or **ElectricSQL** (Postgres-backed sync), **Replicache/Yjs** (CRDT), **RxDB/PouchDB**, **Turso/libSQL** embedded replicas. Recommendation: a Postgres-centric sync layer (PowerSync/Electric) to keep one source of truth while enabling offline. **Decide via a spike — this is the highest-risk technical choice.**
- **Event sourcing** for the ledger and order-state (immutability + audit + offline replay); CQRS read models for reporting.
- **Multi-tenancy:** row-level (tenant_id + Postgres RLS) initially; isolate noisy tenants later.
- **Integration/plugin architecture:** stable internal event bus + public API + webhooks so modules (and later third parties) plug in "Odoo-like."
- **API-first:** everything the UI does is a documented API — enabling integrations and the future marketplace.

---

## Part G — UX Design Phase (a distinct, gated stage — as requested)
**Entry criteria:** general layout + functional requirements for the module are agreed. **Exit criteria:** hi-fi screens validated with sponsor users, tokens handed to code, task-success benchmarks met.

**Information architecture / layout**
- **Till app:** persistent order pane + fixed-grid menu + modifier sheet + payment bar; minimal chrome; big targets.
- **Back-office (web):** left-nav by module — Dashboard, Sales, Stock, Finance, Team, Marketing, Settings.

**Screen inventory (grouped, prioritised — excerpt)**
- **Till (P0):** login/PIN, floor/tables, order entry, modifier sheet, tabs, split/merge, payment, refund/void, cash-up, X/Z, shift handover.
- **KDS (P1):** ticket rail, bump/recall, all-day.
- **Stock (P1):** items, recipes, POs, goods-in, stocktake, waste.
- **Finance (P2):** dashboard, VAT, reconciliation, expenses, exports.
- **Marketing/CRM (P3):** loyalty, campaigns, calendar, reviews.
- **Admin (P0–P2):** users/roles, devices, settings, audit log.

**Wireframe stage**
- Fidelity: low-fi first (Excalidraw/Penpot) → mid-fi (Figma).
- Per-screen brief format: purpose · primary user + Hill · entry points · key actions · states (empty/loading/error/**offline**) · edge cases · success metric.
- **Guerrilla testing in Irish cafés:** paper/click-through with real baristas during quiet hours; 5 users per round; task-based.

**Hi-fi stage**
- Design system/tokens (Figma variables → design tokens → code); colour/contrast strategy for bright café glare; typography (dyslexia-friendly, high legibility); **touch targets ≥ 9–10 mm (≈48 px) minimum, 12 mm for primary actions**; component library; motion; dark mode.
- **Training-time target:** a new barista takes their first correct order within **5 minutes** of first use, unaided.
- **Usability metrics:** task-success rate, time-on-task, error rate; **SUS ≥ 80** and **UMUX-Lite** benchmarked each round.

---

## Part H — In-Depth Phased Roadmap

### 0–3 months — Discovery & Sponsor Users
- **Goal:** validate pains; recruit 5–8 sponsor sites; agree first Hill (H1 Speed). **Serves:** H1.
- **In:** shadowing, as-is maps, wireframes, offline-sync tech spike. **Out:** any payments build.
- **Milestones:** signed sponsors; validated wireframes; sync spike proven.
- **Team:** solo (+ part-time contract designer). **Cost:** low (tools + travel).
- **Risk:** too few users → **mitigation:** minimum 5 sponsors. **Exit:** 5+ sponsors, wireframes tested.

### 3–9 months — MVP Till (H1)
- **Goal:** offline-first till: order entry, modifiers, split/merge, cash, semi-integrated card (SumUp/Stripe/Revolut Reader), X/Z, basic loyalty.
- **Milestones:** live in ≥1 café; time-to-first-order <5 min; zero data loss offline.
- **Team:** solo (+ designer). **Exit:** daily active use in ≥2 sites; SUS ≥80.

### 9–15 months — Paid Pilot + Stock (H1→H2)
- **Goal:** convert pilots to paid; add stock/recipes/wastage/allergens; KDS + queue/notify.
- **Team:** **first hire (full-stack)** likely here. **Exit:** ≥10 paying sites; low churn; stock accuracy validated.

### 15–24 months — Finance module (H2/H4)
- **Goal:** native ledger, mixed-VAT, VAT3 prep, bank feeds/reconciliation; keep Xero/Surf/Big Red Cloud export as escape hatch.
- **Team:** +1 backend; advisory accountant. **Exit:** an accountant signs off a real VAT3 produced by the system.

### 2–3 years — Payments own-terminal path + Marketing/Social
- **Goal:** deepen payments economics (PayFac/ISO exploration; **SoftPOS / Tap to Pay**); ship marketing/social within API limits.
- **Reality check:** building/certifying **own hardware** (EMV L1/L2/L3, PCI PTS POI, PCI DSS, Visa/Mastercard scheme cert, acquirer relationships) is **multi-year, capital- and team-heavy** — pursue **SoftPOS (PCI MPoC) / Tap to Pay on iPhone & Android** first.
- **Team:** payments engineer + compliance help. **Exit:** improved take-rate; SoftPOS live.

### 3–4 years — Multi-site / platform / app marketplace
- **Goal:** franchise/back-office; public API GA; plugin marketplace (the Odoo-like endgame).
- **Team:** small team (5–10). **Exit:** multi-site chains live; third-party plugins shipping.

---

## Part I — Payments Deep-Dive

**Semi-integrated vs fully-integrated**
- **Semi-integrated (recommended now):** card data never touches the POS; PCI scope minimised; terminal certified by the provider; acquirers swappable.
- **Fully-integrated / own terminal:** control + economics, but you inherit EMV L1 (hardware), L2 (kernel/software), L3 (terminal-to-acquirer), PCI PTS POI, PCI DSS and scheme certification — years and significant capital.

**SoftPOS path:** **PCI MPoC** (Mobile Payments on COTS, superseding CPoC/SPoC) plus **Tap to Pay on iPhone** and **Tap to Pay on Android** are the pragmatic "own acceptance" route before any bespoke hardware.

**Card acquiring options (integrated path)**
| Provider | Model | Solo-founder realism |
|---|---|---|
| **Stripe Terminal** | Terminal + API, developer-first | High — Irish-founded, great docs |
| **SumUp** | Readers + API, strong IE | High — cheap, simple |
| **Adyen** | Terminal API / Platforms, PayFac-grade | Med — enterprise onboarding |
| **Zettle SDK** | Reader + SDK | Med |
| **Revolut Reader** | Reader + SDK, Revolut ecosystem | Med–High |
| **Elavon (AIB MS), Global Payments, Worldline/Nexi, Barclaycard, Viva Wallet, Mollie** | Traditional/EU acquirers | Varies; ISO/reseller possible |

- **PayFac vs ISO:** full PayFac is capital/compliance heavy; a **PayFac-as-a-service** (Stripe/Adyen) or an ISO/referral model is realistic early.

**Revolut integration [VERIFY specifics]**
- **Business API:** accounts, transactions, counterparties, payments, payment drafts, expenses, cards.
- **Merchant API:** orders, payment acceptance, webhooks, Revolut Pay, Apple/Google Pay.
- **Revolut Reader:** card reader + SDK.
- **Auth:** OAuth 2.0 with JWT client assertion signed by an X.509 certificate; sandbox available.
- **Known pain point [VERIFY]:** short-lived tokens and periodic (~90-day) re-authorisation complicate unattended server integrations — abstract Revolut so it is replaceable.

**Open Banking (PSD2 → PSD3/PSR) [VERIFY timeline]**
- Doing AIS/PIS yourself needs **Central Bank of Ireland** authorisation as AISP/PISP (or operating as an agent of a regulated entity). Pragmatic path: **aggregators** — TrueLayer, Plaid, Tink, Yapily, **GoCardless Bank Account Data (formerly Nordigen)**, Salt Edge, Fintecture, Volt, Token.io — comparing Irish bank coverage (AIB, Bank of Ireland, PTSB, Revolut, N26, Bunq, credit unions), pricing and reliability.
- **PSD3/PSR:** Commission proposals (published 2023) tighten open-banking API quality and shift fraud liability; application expected later this decade — design to the direction of travel **[VERIFY]**.

**SEPA & A2A "Pay by Bank"**
- SCT, **SCT Inst**, SDD Core/B2B, **Verification of Payee [VERIFY mandate Oct 2025]**. **SEPA Instant Regulation (EU) 2024/886** mandates receive-then-send instant capability for euro-area PSPs on phased dates **[VERIFY: receive ~Jan 2025, send ~Oct 2025]**. A2A "Pay by Bank" could undercut card fees. European A2A schemes: **Wero/EPI**, iDEAL (NL), Bizum (ES), Swish (SE) — no dominant Irish-native A2A scheme yet; **Wero** is the emerging pan-EU candidate.

**Bank reconciliation mechanics**
- Card settlements arrive **net of fees**, T+1/T+2, batching many tickets → model **gross sales, fees, net settlement, chargebacks** as separate ledger entries; auto-match settlement batches to sales; handle cash declarations and variances. This mirrors how Xero/Sage model it and is exactly what the finance module must automate.

---

## Part J — Irish Regulatory & Market Context [VERIFY all dates/figures]
- **VAT:** standard 23%, reduced 13.5%, second-reduced 9%, zero 0%; hospitality food-service 9%→13.5% (1 Sept 2023)→Budget 2026 signal to return to 9% **[VERIFY effective date]**.
- **Revenue/ROS:** returns via ROS; **VAT3**; phased move to real-time digital VAT reporting / B2B eInvoicing — build to EN 16931 / PEPPOL.
- **PAYE Modernisation:** real-time payroll reporting to Revenue on/before payment — **integrate, don't build.**
- **No mandatory fiscalisation:** Ireland does **not** mandate certified fiscal POS — a design freedom; still keep an immutable audit trail and ~6-year record retention **[VERIFY]**.
- **CRO obligations** for companies (annual return/accounts).
- **GDPR / Irish DPC:** consent for loyalty/marketing; DSAR/erasure; data minimisation.
- **Payment landscape:** contactless limit **€50 [VERIFY]**; declining but still material cash use; **Access to Cash Act 2024** (Finance (Provision of Access to Cash Infrastructure) Act 2024) obliges maintaining cash infrastructure — cash handling stays a first-class POS feature.
- **Tips Act 2022:** electronic tips distributed fairly/transparently; policy displayed.
- **Allergens:** EU FIC Reg 1169/2011 + FSAI 14-allergen declaration.

---

## Recommendations (staged, with the thresholds that change them)

**Now (0–3 months): validate, don't build payments.**
1. Recruit **5+ Irish sponsor sites** and lock H1 (Speed) as the first Hill. *Threshold to proceed:* 5 signed sponsors + wireframes passing task tests.
2. Run the **offline-sync spike** (PowerSync vs ElectricSQL) before writing app code. *Threshold:* a demoable offline order-and-sync with zero loss decides your engine. If neither passes, fall back to RxDB/PouchDB.
3. Confirm the **[VERIFY]** facts (VAT 2026, NMW 2026, eInvoicing dates, contactless limit, Revolut token behaviour) directly from Revenue.ie, the Central Bank, EUR-Lex and Revolut's developer docs. Do this before quoting numbers to customers.

**3–15 months: ship the till, monetise, add stock.**
4. Launch MVP till with **semi-integrated payments** behind a `PaymentProvider` interface. Start with **Stripe Terminal or SumUp** (highest solo realism); add Revolut Reader once the abstraction is proven. *Threshold to add finance:* ≥10 paying sites and low churn.
5. Integrate accounting **exports to Surf/Big Red Cloud/Xero** before building any native ledger — this is your no-lock-in promise and your fastest path to accountant trust.
6. Ingest delivery via **one aggregator** (Deliverect or HubRise) rather than integrating Deliveroo/Just Eat/Uber Eats separately.

**15 months–2 years: finance and labour.**
7. Build the **event-sourced ledger + mixed-VAT + VAT3** only after the accountant sponsor user commits to validating it. *Threshold that changes the plan:* if an eInvoicing mandate date lands sooner than expected, prioritise EN 16931 output over UI polish.
8. **Integrate payroll (Bright/Collsoft/Sage), don't build it** — PAYE Modernisation risk is not worth solo hours.

**2–4 years: economics and platform.**
9. Pursue **SoftPOS / Tap to Pay (PCI MPoC)** before any bespoke terminal. *Threshold for own hardware:* only consider it once you have funding, a payments engineer, an acquirer relationship, and enough volume that a few basis points of take-rate justifies EMV/PCI certification cost — otherwise never.
10. Open the **public API + plugin marketplace** last, once the modules are stable, to realise the Odoo-like ambition without the Odoo-like complexity at launch.

**Pricing recommendation:** transparent modest monthly SaaS per till (+ optional module fees), pass-through or thin payment markup, and near-cost/BYO hardware. Make "no hidden fees, no long contract, export anytime" the headline — it directly attacks the incumbents' worst reviews. Irish cafés today juggle POS SaaS + card processing + separate rostering/accounting subscriptions **[VERIFY exact figures]**; aim to be cost-neutral-to-cheaper while removing the seams.

---

## Caveats
- **Live verification was not possible in this environment.** All **[VERIFY]** items — the 2026 hospitality VAT rate and effective date, 2026 national minimum wage, Revenue eInvoicing/VAT-modernisation dates, PSD3/PSR timeline, SEPA Instant / Verification-of-Payee mandate dates, the €50 contactless limit, and Revolut's token/re-auth behaviour — must be confirmed against primary sources before commercial or legal reliance. Regulations and API surfaces change frequently.
- **Pricing figures for competitors and "what Irish cafés pay today" are directional**, not quoted — verify current published pricing per vendor, as tiers and processing rates change often and vary by acquirer/reseller.
- **Effort/duration estimates assume a capable full-stack solo founder** and will stretch under real-life constraints; the roadmap dates are planning anchors, not commitments.
- **The single largest execution risk is over-scoping the all-in-one.** The staged plan exists precisely to resist that; if a phase's exit criteria aren't met, do not advance — narrow instead.
- **Own-terminal hardware is deliberately deprioritised.** If a future investor or partner pushes for it early, treat the EMV/PCI/scheme-certification cost and timeline as a serious diligence item, not a quick feature.