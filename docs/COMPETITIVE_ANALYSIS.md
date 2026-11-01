# Tubify vs vidIQ vs Viewstats: competitive product audit

Research date: 6 October 2026.

## How to read this

Every competitor claim carries one of three labels:

- **Confirmed**: read on the company's own site or help centre.
- **Third-party**: reported by review sites, several of which sell competing tools. Treat as likely, not certain.
- **Not publicly verifiable**: behind a login, or I could not load it.

Two limits on this research. vidIQ's marketing site (`vidiq.com`) rate-limited every direct request, so vidIQ's consumer features and consumer prices come from its support centre, its enterprise site and third-party reviews. And I did not create accounts on either product, so their signed-in dashboards and onboarding screens are **not publicly verifiable**; where I describe them I say what the source is.

Tubify claims are from the codebase and from the end-to-end tests run on the live site this week.

---

## 1. The big picture

### vidIQ

- **Core product:** a YouTube growth toolkit: a Chrome extension that overlays stats on YouTube, plus a web app with keyword research, daily video ideas, competitor tracking, a channel audit and a large set of AI generators (titles, descriptions, thumbnails, scripts, clips, an "AI Coach"). (Third-party, consistent across sources.)
- **Primary customer:** individual creators, mostly small and mid-sized, with a separate enterprise product for brands and media companies. Its enterprise site lists Netflix, Red Bull, BBC, Nintendo and The New York Times and says "500+ enterprise clients". (Confirmed.)
- **Problem it solves:** "What should I make next, and how do I get it found?"
- **Category:** SEO and research first, AI generation second, analytics third.
- **What it optimises for:** daily habit and AI credit consumption. Plans are now defined mainly by monthly AI credits: 150 free, 2,000 on Boost, 6,000 on Max. (Third-party.)
- **Differentiation:** breadth, brand recognition, and distribution through the extension. It has also shipped an MCP connector so ChatGPT, Claude and Cursor can query vidIQ data directly. (Confirmed.)

### Viewstats

- **Core product:** competitive research on public YouTube data: outlier videos, a searchable thumbnail library, title and thumbnail change history, competitor tracking, idea alerts and research boards ("Collections"). (Confirmed on viewstats.com.)
- **Primary customer:** creators and creative teams who think in terms of packaging (idea, title, thumbnail). The Business plan targets "teams and agencies". (Confirmed.)
- **Problem it solves:** "What is working in my niche right now, and why?"
- **Value proposition:** its own headline is "Create video ideas, titles, and thumbnails that go viral" and "Know what will go viral before you hit record". (Confirmed.)
- **Differentiation:** MrBeast's name and data scale. The site says it "processes 2,500x more datapoints every day than other tools". (Confirmed as a claim; the number itself is unverified.)
- **What it optimises for:** time spent researching. It is read-only and deliberately narrow.

### Against Tubify

Neither competitor is a revenue product.

- **Viewstats works only with public data.** It cannot show a creator's own RPM, retention, watch time or demographics. (Third-party, and consistent with its own help article on why its numbers differ from YouTube Analytics.)
- **vidIQ's revenue figures are estimates** from public views and average rates, according to third-party reviews. Whether its signed-in dashboard shows real revenue from YouTube's API is not publicly verifiable.
- **Tubify connects to the creator's own channel** and reads real revenue (including the ad and Premium split), CPM, watch time, traffic sources, devices, geography and demographics. It then adds things neither competitor has at all: tracked links, a lead inbox, brand deals, lead magnets and team commission.

Tubify is weaker than both on everything that happens *before* a video is published: research, competitor intelligence, ideas and packaging.

---

## 2. Feature matrix

"Not verifiable" means not publicly verifiable. Tubify status is from the code.

### Own-channel analytics

| Feature | vidIQ | Viewstats | Tubify | Tubify status | Recommendation |
|---|---|---|---|---|---|
| Views, watch time, subscribers | Yes (third-party) | Public counts only | Yes | Built | Keep |
| Real revenue | Estimates (third-party) | No | Yes, with ad and Premium split | Built | Lead with this |
| RPM | Estimate | No | Partly | Partial | Compute and show per video |
| CPM | Not verifiable | No | Yes | Built | Keep |
| CTR and impressions | Yes (third-party) | No | No | Missing | Build (P0) |
| Average view duration, retention | Yes (third-party) | No | Fetched in places | Partial | Surface on video pages |
| Traffic sources, devices | Not verifiable | No | Yes | Built | Keep |
| Geography, age, gender | Not verifiable | No | Yes | Built | Keep |
| Returning vs new viewers | Not verifiable | No | No | Missing | P2 |
| Real-time stats | Yes, stats bar (confirmed feature page exists) | Near-real-time public views | No | Missing | Don't build |
| Comparison periods | Not verifiable | Yes, public trend lines | Partial | Partial | P1 with alerts |
| Video-level analytics | Yes | Public only | Yes | Built | Add revenue attribution |

### Competitive intelligence and research

| Feature | vidIQ | Viewstats | Tubify | Tubify status | Recommendation |
|---|---|---|---|---|---|
| Competitor tracking | Yes (confirmed tool) | Yes (confirmed) | No | Missing | Build a light version (P1) |
| Outlier videos | Signals in extension (third-party) | Core feature (confirmed) | No | Missing | Build inside competitor tracking |
| Views velocity | Views per hour (third-party) | Yes | No | Missing | Part of the same feature |
| Keyword research | Core feature | No | No | Missing | Don't build |
| Thumbnail search, A/B history | No (third-party) | Core feature (confirmed) | No | Missing | Don't build |
| Research boards | Not verifiable | Collections (confirmed) | Projects (different purpose) | Different | Don't copy |
| Trend or idea alerts | Trend Alerts by email (third-party) | Alerts (confirmed) | No | Missing | Build own-channel alerts first |

### AI

| Use | vidIQ | Viewstats | Tubify |
|---|---|---|---|
| Video analysis | Yes | No | Yes (published and pre-publish) |
| Title and description | Yes | Not verifiable | Description optimisation; title suggestions inside video analysis |
| Thumbnail generation | Yes, credit-heavy | AI thumbnails: text-to-image, recreate, face swap (third-party) | No |
| Ideas | Daily Ideas, personalised | Not verifiable | Content ideas inside video analysis |
| Scripts, clips, Shorts | Yes | No | No |
| Conversational assistant | AI Coach | No | Assistant chat, grounded in account data |
| Lead summaries, freebie writing | No | No | Yes |
| Automated reports | Not verifiable | No | No |

Tubify's AI is narrower but aimed at different jobs: turning viewers into leads and money. That is a strength as long as it isn't marketed as a vidIQ substitute.

---

## 3. UX teardown

### Landing pages

- **vidIQ (enterprise site, confirmed):** headline "Brand better on YouTube", outcome statistics ("2x average subscriber growth", "48% average impression increase"), a wall of famous logos, and "Book a Demo". It sells results and trust.
- **Viewstats (confirmed):** two outcome headlines, seven features each with a one-line benefit, founder credibility, a 17,000-member Discord, and two calls to action: "Sign up for Viewstats Pro" and "Continue to free site". Letting visitors into a free product without signing up is the strongest pattern on either site.
- **Tubify:** the headline "Stop guessing which videos make you money" is sharper and more specific than either competitor's. The weaknesses are the lack of proof (no numbers, logos or testimonials) and no free way in.

### Signup and onboarding

Both competitors' signed-in onboarding is not publicly verifiable. What is confirmed:

- vidIQ's first step is "Link your channel" through Google.
- Viewstats lets people use the product before any signup.
- Both have a permanent free tier; neither uses a time-limited trial. (Third-party for vidIQ.)

Tubify's onboarding, from this week's tests, has more friction than either:

- Email confirmation is required, and until this week an expired link was a dead end.
- Until this week, every login forced a Google consent screen.
- The Google OAuth app is unverified, so new users see a warning screen and connections may expire weekly.
- There is no free tier and no trial.

Time to first value is the gap. A new Tubify user must confirm an email, pass an unverified-app warning and wait for a sync before seeing anything.

### Dashboards

Not publicly verifiable for either competitor. Third-party descriptions agree on the character of each:

- **vidIQ:** "feature-dense... powerful but a lot on screen".
- **Viewstats:** "clean and read-only... very low friction".

**What to copy:** Viewstats' restraint (one question per screen) and vidIQ's habit loop (something new every day).

**What to avoid:** vidIQ's credit meter on every action. Review sites report it as the most common complaint, alongside billing and cancellation friction.

Tubify's dashboard today shows what happened. Its "Live Alerts" panel exists but is empty, because nothing generates alerts. That panel is where the product should be telling the user what to do.

---

## 4. Agency and multi-channel workflow

This is where the research is most useful, because vidIQ has the same Google permission problem Tubify hit.

### How vidIQ does it (confirmed, from its support centre)

To add a channel you manage but do not own:

1. The channel must be a Brand Account.
2. "The owner needs to opt out of YouTube Studio permissions and manage them through the brand account."
3. The owner assigns you as manager in the Brand Account settings.
4. You then authenticate in vidIQ.

So vidIQ asks the client to change how their channel's permissions work. For team members without manager rights, vidIQ sells a workaround: "Read-Only Access", available only on Enterprise.

Enterprise pricing (confirmed): **$799/month** for 3 users and 5 channels, **$2,500/month** for 8 users and 20 channels, plus $69 per extra user and $49 per extra channel.

### How Viewstats does it

It doesn't need to. It uses public data, so there is nothing to connect. Its Business plan ("starting at $249/mo", sales call only) offers unlimited credits, volume licensing, creator discovery and an API. (Confirmed.) Seat counts are not published.

### What this means for Tubify

Tubify's model (workspace, then YouTube connections, then channels, then team members with roles) is already better designed than vidIQ's, for one reason: **the person who owns the channel authorises it once, and everyone else gets access through Tubify, not through Google.** Nobody has to convert to a Brand Account or switch off Studio permissions.

Three things stop it being a real agency product today:

1. **One account can belong to only one workspace.** The invite code refuses anyone who already has a workspace. An agency employee cannot work across client workspaces. This is the single biggest agency blocker.
2. **There is no client-facing connect flow.** A client has to sign up for a full Tubify account to connect their channel.
3. **Plan channel limits are not enforced in code.** "1 channel", "3 channels" and "10+ channels" are text on the pricing page only.

### Recommended onboarding architecture

1. **Agency workspace with client spaces.** One agency account, many clients, each client's channels, deals and reports kept separate inside it.
2. **Connect link.** The agency sends the client a link. The client clicks it, signs in with Google, picks their channel and approves. No password sharing, no Tubify account to manage, no Brand Account changes. Tubify stores the authorisation against the agency's client space.
3. **Brand Account path kept as a second option.** Where the agency already has manager rights on a legacy Brand Account, the existing multi-channel discovery handles it.
4. **Studio-permissions case handled honestly.** When someone with only YouTube Studio access tries to connect and Google returns no channels, say so plainly and offer to send the owner a connect link. Google's API does not expose Studio-invited channels, so this is the correct workflow, not a workaround.
5. **Connection health.** Email the agency and the client when a connection needs renewing, with a one-click reconnect link.
6. **Client role.** A read-only role that sees only that client's dashboard and reports.

This turns Google's permission mess into a selling point: "Your clients connect in one click. No Brand Account conversion, no shared passwords."

---

## 5. Revenue and monetisation

| Capability | vidIQ | Viewstats | Tubify |
|---|---|---|---|
| Real ad revenue | Estimates (third-party) | No | Yes |
| Revenue by video | Not verifiable | No | Yes |
| Revenue by geography | Not verifiable | No | No |
| Forecasting | Not verifiable | No | No |
| Sponsorships and brand deals | No | No | Yes, pipeline board |
| Affiliate and link revenue | No | No | Tracked links with click counts |
| Leads | No | No | Lead inbox, comment-to-lead, lead magnets |
| Team commission | No | No | Lead share and commission per member |

Neither competitor touches money that doesn't come from AdSense. For most creators, sponsorships, affiliates and their own products matter more than ad revenue. That is Tubify's opening.

**What would make it a real revenue operating system:** one number per video that adds up everything that video earned. Ad revenue from YouTube, plus clicks and sales through tracked links, plus the deal it was part of, plus the leads it produced. Tubify already holds every one of those pieces in separate pages. Joining them is the product.

---

## 6. Alerts and "what to do next"

- **vidIQ:** email Trend Alerts for keywords and competitors with a views-per-hour threshold and a chosen frequency; Daily Ideas; AI Coach. (Third-party.) It tells users what to make.
- **Viewstats:** Alerts when videos matching an idea pass a view threshold. (Confirmed as a feature; mechanics third-party.) It tells users what is working for others.
- **Neither** tells a creator anything about their own money.

Tubify should own that. Examples of alerts only Tubify can produce:

- "This video has 4,200 views and no tracked link in its description."
- "RPM fell 30% this week. Your audience shifted towards a lower-paying country."
- "A lead from last week's video has not been answered in 3 days."
- "Your deal with X is due in 5 days and the video isn't scheduled."
- "This video is earning three times your average. Pin a comment with your offer."

Each alert should carry one button that does the fix.

---

## 7. Reporting

- **vidIQ:** email digests on competitors, CSV export of public channel data, and "portfolio performance" and a multi-channel admin dashboard on Enterprise. (Mixed confirmed and third-party.) White-label reports: none found.
- **Viewstats:** no reporting found. An API on the Business plan. (Confirmed.)
- **Tubify:** a summary page and CSV export. No PDF, no scheduling, no email, no client branding.

Agencies bill for reports. Neither competitor serves them well. A scheduled, branded monthly client report (PDF and a shareable link) that shows revenue, not just views, would be a reason to buy on its own. Workspace branding already exists in Tubify and can be reused.

---

## 8. Pricing

### Competitors

| Plan | Price | Notes | Confidence |
|---|---|---|---|
| vidIQ Free | $0 | 150 AI credits a month | Third-party |
| vidIQ Boost | $199/year; monthly price reported between $19 and $39 | 2,000 credits | Third-party, sources disagree on monthly |
| vidIQ Max | $468/year, annual only | 6,000 credits | Third-party |
| vidIQ Coaching | about $99/month | Boost plus 1-on-1 coaching | Third-party |
| vidIQ Enterprise | $799/month | 3 users, 5 channels | Confirmed |
| vidIQ Enterprise Pro | $2,500/month | 8 users, 20 channels | Confirmed |
| Viewstats Free | $0 | Public stats, extension | Confirmed |
| Viewstats Pro | $49.99/month, about $39.99 on annual | Site hides the price; 50%-off promotion running | Third-party |
| Viewstats Business | from $249/month | Sales call; unlimited credits, API | Confirmed |

### Tubify: $29, $79, $199

- **Starter at $29 is exposed.** A creator comparing on analytics alone gets far more research tooling from vidIQ Boost for less. Starter only makes sense if it sells revenue tracking and tracked links, not "YouTube analytics" and "basic video insights".
- **Scale at $199 is underpriced for agencies.** It promises 10+ channels and a team. vidIQ charges $799 for 5 channels and 3 seats.
- **The boundaries are not enforced.** Channel limits are marketing text only. AI limits in code are per day and per feature (10 a day free, up to 300 on Scale), which does not match "5 AI analyses/month" on the pricing page.
- **There is no free tier and no trial.** Both competitors have a permanent free tier.

### Recommended changes

1. Add a **free tier**: one channel, the revenue dashboard and a few tracked links. This is the top of the funnel both competitors have and Tubify lacks.
2. Keep **Starter $29** and **Pro $79**, but re-describe them around money: tracked links, lead inbox and brand deals on Starter; alerts, attribution and competitor tracking on Pro.
3. Reposition **Scale $199** as a small-team plan with a hard cap, for example 5 channels and 5 seats.
4. Add an **Agency tier at roughly $399 to $499** with 15 to 25 channels, client spaces, connect links, white-label scheduled reports and a client role, plus a per-channel add-on. That is still about half of vidIQ Enterprise. Treat the number as a starting point to test, not a finding.
5. **Don't sell AI by credits.** Include generous AI in each plan and cap it quietly. The credit meter is vidIQ's most-reported complaint.
6. Enforce limits in code before changing any prices.

---

## 9. What vidIQ does better

| What they do | Why it works | Copy it? | How Tubify could do it better |
|---|---|---|---|
| Daily Ideas: something new every day | Creates a daily reason to open the product | Yes, the habit, not the feature | A daily "money brief": yesterday's revenue, new leads, one action |
| Free tier with real value | Huge top of funnel, upgrades later | Yes | Free revenue dashboard |
| Extension inside YouTube | Meets creators where they work | No | Too costly to build and maintain; email and alerts reach them instead |
| AI Coach across the whole account | One place to ask anything | Partly | Tubify's assistant already reads account data; teach it to answer revenue questions well |
| Enterprise packaging with onboarding and proof | Sells to brands at $799 and up | Yes, the packaging | Agency tier with a setup call and case studies |
| MCP connector for AI assistants | Fits how teams now work | Later | P2 |
| Outcome statistics and logos | Trust | Yes | Collect real numbers from first customers |

## 10. What Viewstats does better

| What they do | Why it works | Copy it? | How Tubify could do it better |
|---|---|---|---|
| Outlier score: one number saying a video beat its channel's norm | Instantly understandable | Yes | Apply it to money: a revenue outlier score per video |
| "Continue to free site" | No signup wall | Yes | A public demo workspace with sample data (Tubify already has a demo mode) |
| Thumbnail library and A/B history | Unique data, very sticky | No | Needs a data operation Tubify doesn't have |
| Idea alerts with thresholds | Passive value while the user is away | Yes, for own-channel events | See section 6 |
| Collections | Keeps research in the product | No | Not Tubify's job |
| Narrow, clean scope | Easy to explain in one line | Yes, the discipline | Cut or hide pages that aren't about revenue |

---

## 11. What Tubify already does better

Only things that exist in the product today:

- **Real revenue from the creator's own channel**, with ad and Premium split and CPM. Viewstats cannot; vidIQ estimates.
- **Tracked links with click counting** and a public redirect, tied to destinations.
- **Lead inbox**, including leads created from YouTube comment replies, and AI lead summaries.
- **Brand deal pipeline.**
- **Lead magnets** with AI generation, uploads and opt-in pages.
- **Workspace with roles** (owner, manager, setter, editor), lead share and commission per member. vidIQ gates roles behind $799.
- **Channel connection that doesn't need Brand Account conversion**, with several channels per Google grant.
- **Pre-publish video analysis**, which neither competitor offers in this form.
- **Data isolation that has been tested.** A second account could not read or change another's data in 91 of 92 checks; the one exception was a wrong status code.

Things that look like advantages but are not yet real:

- **Email campaigns:** drafts only, nothing sends.
- **Integrations (Stripe Connect, Kit, Instagram, Google Analytics):** connection code exists, none are connected or proven.
- **Reports:** a summary and CSV only.
- **Affiliate:** this is Tubify's own referral programme, not affiliate revenue tracking for creators.

---

## 12. The product gap

**Why would a creator on vidIQ or Viewstats switch to Tubify?** Today, mostly they wouldn't, and they shouldn't have to. Those tools answer "what should I make?". Tubify answers "what did it earn and what do I do about it?". A creator can use both. The pitch is addition, not replacement. The weak point is that Tubify's answer is currently spread over eight pages and never stated as one number or one action.

**Why would an agency switch?** The honest answer today is "it's cheaper and has roles", which is weak, and the one-workspace limit means an agency can't actually run several clients. With client spaces, connect links and branded revenue reports, the answer becomes strong: vidIQ charges $799 for five channels and makes clients change their Google settings; Viewstats can't see client data at all.

**What must be built for the answer to be strong:** per-video revenue attribution, alerts with actions, multi-workspace membership, connect links and scheduled client reports.

---

## 13. Roadmap

Complexity: S is days, M is one to three weeks, L is a month or more.

### P0: fix now

| Feature | Inspired by | Problem solved | Business impact | Size |
|---|---|---|---|---|
| Google OAuth verification and a terms page | Both are verified apps | Warning screen and weekly disconnects | Removes the largest signup drop and churn cause | M, mostly waiting on Google |
| Enforce plan limits (channels, seats, AI) and align pricing text | vidIQ's clear limits | Plans can't be sold if they aren't enforced | Protects revenue | S |
| Custom email sending (SMTP) | n/a | Confirmation and invite emails are rate-limited | Signups complete | S |
| CTR and impressions | vidIQ | The two metrics every creator checks first are missing | Credibility as an analytics product | S to M |
| Fill the Live Alerts panel with real alerts | Viewstats Alerts, vidIQ Trend Alerts | Dashboard says what happened, not what to do | Retention | M |
| Remove or hide unfinished surfaces (email sending, Projects' "wireframes" output) | Viewstats' narrow scope | Broken promises in the product | Trust | S |

### P1: build next

| Feature | Inspired by | Problem solved | Business impact | Size |
|---|---|---|---|---|
| Revenue per video, all sources combined | Nobody has it | "Which videos make me money?" | The core differentiator | M |
| Multi-workspace membership and client spaces | vidIQ Enterprise | Agencies can't run several clients | Unlocks the agency market | L |
| Client connect link | vidIQ's painful Brand Account flow | Clients connect without accounts or setting changes | Agency onboarding in minutes | M |
| Scheduled branded client reports (PDF and link) | Gap in both | Agencies assemble reports by hand | Reason to buy on its own | M |
| Free tier or public demo | Both | No way to try the product | Top of funnel | S to M |
| Light competitor tracking with outlier detection | Viewstats | Context for own results | Parity on the most-requested research feature | M |
| Weekly email digest | vidIQ emails | Users forget to log in | Retention | S |
| Agency pricing tier | vidIQ Enterprise | Agencies pay creator prices | Revenue per account | S after limits |

### P2: later

| Feature | Inspired by | Size |
|---|---|---|
| Revenue forecasting and sponsor rate guidance | Gap in both | M |
| Revenue by geography | Gap in both | S |
| Stripe and Kit integrations proven end to end | n/a | M |
| MCP connector or public API | vidIQ MCP, Viewstats API | M |
| Returning vs new viewers | vidIQ | S |

### Don't build

| Feature | Who has it | Why not |
|---|---|---|
| Chrome extension | Both | Expensive to maintain, and it's their home ground |
| Keyword research and SEO scoring | vidIQ | A data business in itself; creators already have it |
| Thumbnail generator, thumbnail database | Both | Unrelated to revenue; costly AI |
| Script, clip and Shorts generators | vidIQ | Commodity AI, credit-meter trap |
| Public channel rankings | Viewstats | Needs data scale Tubify doesn't have |
| Paid coaching | vidIQ | A services business |
| Real-time stats bar | vidIQ | High effort, low link to money |

---

## 14. Positioning

**Recommendation:** position Tubify as the **revenue operating system for YouTube creators and the agencies that run their channels.** Not analytics, not AI, not growth. Those three are crowded and both competitors are stronger there.

- **One line:** Tubify shows what every video earns, from every source, and tells you what to do next.
- **Homepage headline:** Know what every video earns. Then earn more from the next one.
- **Supporting line:** Ad revenue, sponsorships, links and leads in one place, for creators and the teams who manage them.
- **Primary call to action:** See your channel's revenue free.
- **Value propositions:**
  1. Real revenue from your own channel, not estimates.
  2. One number per video across ads, links, deals and leads.
  3. Alerts that come with the fix.
  4. Clients connect in one click, with no shared passwords.
  5. Reports your clients will actually read.

**Is "operating system" defensible?** Partly. Tubify cannot defend research or AI generation: both competitors have years of data and distribution. It can defend the layer they don't touch at all, which is money beyond AdSense and the agency workflow around it. So the claim should be "operating system for YouTube *revenue*", not for YouTube in general. The broader "Analytics + AI + Revenue + Strategy + Client Management + Monetisation + Automation" framing invites a feature-by-feature comparison that Tubify loses.

---

## 15. Recommended dashboard

The rule: what happened, why, and what to do.

- **Top:** one sentence. "You earned $1,240 this month, up 12%. Two things need you." Then the two things, each with a button.
- **KPIs (five, not more):** total revenue from all sources, RPM, views, CTR, new leads. Each with change against the previous period.
- **Main chart:** revenue over time, stacked by source (ads, links, deals, other).
- **AI insight:** one paragraph explaining the biggest change, in plain words, with its evidence.
- **Opportunities:** three at most, each naming a video and an action (add a link, pin a comment, follow up a lead, pitch a sponsor).
- **Revenue:** a table of videos ranked by total earnings, with a revenue outlier marker.
- **Content:** recent videos with views, CTR, retention and earnings side by side.
- **Competitors:** a small strip showing how three tracked channels did this week, and any outlier video.
- **Alerts:** connection problems first, then money, then deadlines. Never an empty panel; show "nothing needs you today".

---

## 16. Executive summary

1. **Biggest lessons from vidIQ.** A daily reason to return and a free tier build the business. Its enterprise plan proves teams will pay $799 or more for multi-channel access with roles. Its credit meter and billing are what users dislike most.
2. **Biggest lessons from Viewstats.** A narrow product with one clear idea (the outlier) is easy to sell. Letting people in without signup lowers every barrier.
3. **Biggest weaknesses of both.** Neither knows what a video earned beyond a guess. Neither touches sponsorships, links or leads. vidIQ's agency flow makes clients change Google settings; Viewstats can't see private data at all. Neither produces client reports.
4. **Tubify's strongest existing advantages.** Real revenue data, tracked links, lead inbox, brand deals, roles and commission, and a connection model that needs no Brand Account conversion.
5. **Top 10 priorities.** Google verification; enforce plan limits; CTR and impressions; real alerts with actions; revenue per video across sources; multi-workspace and client spaces; client connect link; scheduled branded reports; free tier or public demo; light competitor tracking.
6. **Top 5 UX improvements.** A one-sentence summary at the top of the dashboard; five KPIs instead of many; every alert with a button; a way to try the product without signing up; hide unfinished features.
7. **Pricing changes.** Add a free tier, re-describe Starter and Pro around money, cap Scale, add an Agency tier around $399 to $499 with per-channel add-ons, and don't meter AI by credits.
8. **Agency workflow.** Agency workspace with client spaces; clients authorise through a connect link; Brand Account discovery as a second path; an honest message plus an owner link for Studio-permission cases; connection health emails; a read-only client role.
9. **Homepage positioning.** "Know what every video earns. Then earn more from the next one."
10. **The single biggest strategic change.** Stop presenting Tubify as analytics with extras. Make one number, total revenue per video, the centre of the product, and build everything else to explain or increase it.

**What Tubify becomes that vidIQ and Viewstats are not:** the place a creator or agency goes to see what YouTube is actually paying them and to act on it. vidIQ and Viewstats help decide what to make. Tubify is where the result is counted, explained and turned into the next sale. They are tools for the video; Tubify is the system for the business.

---

## Sources

Company sources:

- [Viewstats home](https://www.viewstats.com)
- [Viewstats pricing](https://www.viewstats.com/pricing)
- [Viewstats info page](https://www.viewstats.com/info)
- [vidIQ Enterprise](https://enterprise.vidiq.com/)
- [vidIQ Enterprise packages](https://enterprise.vidiq.com/packages)
- [vidIQ Enterprise: Introduction](https://support.vidiq.com/en/articles/8058473-vidiq-enterprise-introduction)
- [vidIQ: adding a managed channel](https://support.vidiq.com/en/articles/8701197-how-to-add-your-managed-youtube-channel-to-vidiq-a-guide-for-account-managers)
- [vidIQ: adding additional channels](https://support.vidiq.com/en/articles/9472168-how-to-add-additional-channels-to-vidiq)
- [vidIQ MCP](https://support.vidiq.com/en/articles/15082430-vidiq-mcp)
- [vidIQ: authenticating your channel](https://support.vidiq.com/en/articles/7988664-authenticating-your-channel-with-vidiq)
- [Viewstats help: why views differ from YouTube Analytics](https://viewstats.zendesk.com/hc/en-us/articles/22966792795547-Why-do-my-views-on-Viewstats-differ-from-Youtube-analytics)
- [Viewstats help: getting started with AI Thumbnails](https://viewstats.zendesk.com/hc/en-us/articles/38051543383067-Getting-Started-with-AI-Thumbnails)

Third-party sources (several are competitors of vidIQ or Viewstats):

- [1of10: vidIQ pricing](https://1of10.com/blog/vidiq-pricing/)
- [1of10: vidIQ review](https://1of10.com/blog/vidiq-review/)
- [OutlierKit: Viewstats pricing](https://outlierkit.com/resources/viewstats-pricing/)
- [OutlierKit: vidIQ vs Viewstats](https://outlierkit.com/resources/vidiq-vs-viewstats/)
- [OutlierKit: vidIQ review](https://outlierkit.com/resources/vidiq-review/)
- [OutlierKit: vidIQ pricing](https://outlierkit.com/resources/vidiq-pricing/)
- [onetube: vidIQ pricing 2026](https://onetube.io/blog/vidiq-pricing-2026)
- [coldiq: Viewstats review](https://coldiq.com/tools/viewstats)
- [TubeAnalytics: vidIQ revenue blind spots](https://www.tubeanalytics.net/blog/vidiq-revenue-blind-spots)
- [TubeAnalytics vs Viewstats](https://www.tubeanalytics.net/compare/tubeanalytics-vs-viewstats)
- [SaaS Flags: vidIQ complaints](https://saasflags.com/products/vidiq)
- [toolsforhumans: vidIQ review](https://www.toolsforhumans.ai/ai-tools/vidiq)
- [Creator Handbook: Viewstats Pro launch](https://www.creatorhandbook.net/mrbeast-launches-pro-version-of-viewstats/)
