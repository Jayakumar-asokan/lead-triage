# Lead Triage

Know which leads are worth an enrichment credit and a call before you spend either.

**Live demo:** https://lead-triage-893m.vercel.app (click **Try the sample data**)

Built for the Caprae Capital Full Stack Developer pre-work challenge, as an add-on to
[SaaSquatch Leads](https://www.saasquatchleads.com/).

## The problem it solves

SaaSquatch charges one credit to enrich a lead and advises users to "only enrich the leads
you want". It does not help them decide which ones those are. A searcher looking for a
business to acquire can scrape 500 companies in a morning, but many of them are duplicates,
have a dead website or an email that will bounce, or are simply the wrong size to buy.

Lead Triage sits between scraping and enrichment. Upload a lead export and it answers one
question per lead: **enrich and contact first, review, or skip**, with the reasons shown.

On the bundled sample, 30 rows become 25 unique leads: 10 to contact first, 8 to review and
7 to skip. Those 7 are credits and calls not wasted.

## What it does

1. **Clean.** Reads any CSV with a company, website or email column. Column names are
   matched flexibly ("Company Name", "URL", "Work Email"). Duplicate rows are merged by
   website domain, then by company name, and the fullest data from each row is kept.
2. **Verify.** For every lead it checks that the email is well formed and its domain has a
   mail server, and that the website responds. While visiting the homepage it reads the
   page title and description, which gives a free "what this company does" line. It also
   picks up the company's published phone number and LinkedIn page, looking at the contact
   page if the homepage has no phone, and uses them to fill gaps in the uploaded row.
3. **Rank.** Each lead gets a score out of 100 against a target profile the user can edit:

   | Group | Points | Rules |
   |---|---|---|
   | Fit | 60 | Revenue 25, company size 15, industry 20 |
   | Reachability | 30 | Email 15, website 10, phone 5 |
   | Contact | 10 | Is the named person an owner, founder or CEO? |

   70 and above is tier A (contact first), 45 to 69 is tier B (review), below 45 is tier C
   (skip). A lead with no working email, website or phone is skipped whatever its fit.
4. **Explain.** Click a lead to see every rule, its points and a plain reason. Unknown
   values are listed, so the user knows exactly what an enrichment credit would settle.
5. **Act.** For tier A leads, one click asks Gemini for a one-line "why this lead" note
   and a suggested opening line, grounded in what the company's own website says.
6. **Export.** The filtered list downloads as a CSV with the score, tier, reasons and any
   AI notes attached, ready for a CRM or for SaaSquatch.

### Design decisions

- **Visible rules for the score, AI for the wording.** A salesperson has to trust the
  ranking and be able to change it, so every point comes from a rule they can read and
  every rule has a test. AI is used where it is strong and a mistake is cheap: drafting a
  note the user reads before sending. Removing the AI key changes nothing about the ranking.
- **Unknown is not zero.** A lead with unknown revenue gets a small neutral score and a
  flag. It is not thrown away for missing data.
- **Scoring runs in the browser.** Changing the target profile re-ranks the list instantly,
  with no server call.
- **One screen.** Upload, summary, profile, table and detail are all on one page, so there
  is nothing to learn.

## Run it locally

Requires Node.js 20 or newer.

```bash
git clone https://github.com/Jayakumar-asokan/lead-triage.git
cd lead-triage
npm install
npm run dev
```

Open http://localhost:3000 and click **Try the sample data**.

Nothing else is required. Two optional settings go in `.env.local` (copy `.env.example`):

| Variable | Without it | With it |
|---|---|---|
| `DATABASE_URL` | Domain checks are cached in memory | Cached in Neon Postgres; the table is created on first use |
| `GEMINI_API_KEY` | The AI notes button is hidden | Tier A leads can get AI notes (free key from Google AI Studio) |

Other commands:

```bash
npm test                  # 58 unit tests (Node's built-in test runner)
node scripts/triage.js    # run the whole pipeline in the terminal
npm run lint
npm run build
```

## Dataset

`public/sample-leads.csv` has 30 rows. It was written by hand for this demo; it is not
scraped and contains no personal data.

- The software companies are real, so the live website and mail-server checks have
  something to verify. Their email addresses are public shared inboxes such as `support@`.
- **The revenue and headcount figures are illustrative placeholders, not real data.**
- Northwind, Contoso, Fabrikam and Adventure Works are fictional. They carry the planted
  problems: duplicate rows, a malformed email, dead domains and a phone-only lead.

## Architecture

```
Browser (React)                      Vercel serverless function            Outside
---------------                      --------------------------            -------
upload CSV  ── POST /api/triage ──▶  clean + de-duplicate
                                     read cache  ───────────────────────▶  Neon Postgres
                                     verify uncached domains  ──────────▶  DNS (MX), company websites
                                     write cache ───────────────────────▶  Neon Postgres
score + rank  ◀── leads + checks ──  respond
filter, explain, export
tier A leads ── POST /api/insights ▶ strip contact details, ask for notes ▶  Google Gemini API
```

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, plain JavaScript |
| Styling | Tailwind CSS 4 |
| CSV parsing and export | Papa Parse |
| Database | Neon serverless Postgres, through `@neondatabase/serverless` (SQL over HTTPS) |
| AI | Google Gemini (`gemini-flash-latest`, falling back to `gemini-flash-lite-latest` when overloaded) over its REST API, with a JSON response schema |
| Hosting | Vercel. The page is prerendered static HTML; `/api/triage` and `/api/insights` are Node.js serverless functions |
| Deployment | Push to `main` on GitHub; Vercel builds and deploys automatically |
| Tests | `node --test`, no extra test framework |

### Code layout

| File | Responsibility |
|---|---|
| `lib/clean.js` | Parse CSV, map headers, normalise domains and names, merge duplicates |
| `lib/validate.js` | Email format and MX check, website check, homepage title and description |
| `lib/score.js` | The scoring rules, tiers and ranking |
| `lib/cache.js` | Postgres and in-memory cache behind one interface |
| `lib/insight.js` | Builds the AI request without contact details, validates the reply |
| `lib/export.js` | Ranked leads back to CSV |
| `app/api/triage/route.js` | Upload endpoint: clean, verify, cache |
| `app/api/insights/route.js` | AI notes endpoint |
| `components/` | The screen: upload, profile panel, table, detail panel |

The `lib` files have no dependency on Next.js, which is why they can be unit
tested and run from the command line.

### Data storage

One table, created automatically:

```sql
CREATE TABLE check_cache (
  key        text PRIMARY KEY,          -- "web:acme.com" or "mx:acme.com"
  result     jsonb NOT NULL,            -- the check result
  checked_at timestamptz NOT NULL DEFAULT now()
);
```

Only public facts about a domain are stored: whether the site is live, its title and
description, and whether it accepts mail. **Uploaded lead lists, names and email addresses
are never stored.** They exist in memory for the length of one request.

### Caching and performance

- Results are reused for 7 days. On the live site the sample takes about 1.8 seconds cold
  (45 domain checks) and about 0.5 seconds when repeated (0 checks).
- The cache costs one read and one write per upload, however many leads the file has.
- Each domain is checked once per upload even if several leads share it, and 8 leads are
  verified at a time.
- Timeouts and DNS failures are not cached, so they are retried on the next upload.
- If the database is unavailable the upload still succeeds; it just runs every check live.
- Checking stops starting new leads after 40 seconds, well inside the 60 second function
  limit. Leads it did not reach are returned marked "unchecked" and still scored, so a slow
  list degrades instead of failing. Uploading again finishes them from the cache.
- Website fetches time out after 8 seconds and read at most 200 KB of HTML.

### Safety and data ethics

- **No requests to private networks.** The server fetches addresses that come from an
  uploaded file, so it refuses any host that resolves to localhost or an internal range,
  and re-checks after every redirect (SSRF protection).
- **Light footprint.** At most two requests per company (homepage, then contact page),
  with a user agent that identifies the tool. No login pages, no CAPTCHA bypass. A site
  that blocks bots is reported as "blocks bots" and still counted as existing.
- **Company data only.** From websites it takes the phone number the company publishes as
  a call link and its LinkedIn company page. It does not collect staff names, personal
  profiles or email addresses.
- **AI sees less than the user does.** Only the company name, what its website says, size
  and score go to Gemini. Contact names, emails and phone numbers are stripped first, and a
  test proves it. Website text is treated as data, not instructions, and the reply is
  validated and length-capped before it is shown. AI notes are labelled "check before
  sending".
- **Limits.** 1 MB and 500 unique leads per upload, with a clear message when exceeded.

## Known limits

- A mail server on the domain does not prove that a specific mailbox exists.
- Revenue and headcount come from the uploaded file; the tool does not estimate them.
- The scoring weights are my judgement of what matters to an acquirer, not a trained model.
- The API endpoint has no login or rate limit, which a production version would need.
- `robots.txt` is not consulted before the homepage and contact page requests.
- Phone numbers are only found when a site publishes them as a call link; many software
  companies do not, so this helps most with local service businesses.
- AI notes are drafts. They can be bland or wrong and must be read before use. On Gemini's
  free tier, Google may use submitted text to improve its products.
- The largest file tested end to end is the 30-row sample. Bigger files are covered by
  unit tests of the time budget, not by a live run.

## What I would build next

- Read leads straight from the SaaSquatch API and write the tier back, so skipped leads
  are never enriched by mistake.
- Saved target profiles per user or per search thesis.
- Mailbox-level verification for tier A leads only, where the extra cost is justified.

## How it was built

I built this with Claude Code as a pair programmer, which is how I build ERP screens in my
current job. I chose the feature, the scoring rules and the trade-offs, and reviewed and
ran every part. As a QA engineer my rule for AI-written code is the same as for any other
code: it is not done until tests prove it, which is why the pipeline has 58 of them.

## Author

Jayakumar A · [LinkedIn](https://www.linkedin.com/in/jayakumar-qa) · [GitHub](https://github.com/Jayakumar-asokan)
