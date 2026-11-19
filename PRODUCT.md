# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One user: the developer who owns and runs the installation. The user is a software developer who looks for a job, mainly in Denmark and in remote roles. The user knows how the system works and does not need an explanation of its concepts.

The usage pattern is undecided. The user has not used the product enough to know whether triage happens in short daily visits or long sessions, or on a desktop or a phone. Future work must not assume one pattern.

## Product Purpose

The product fetches job postings from public job boards, compares each posting with the user's CV, ranks the postings, and tracks the user's applications. It exists so the user reads the few postings that fit and not the hundreds that do not. Success means that the user finds each relevant posting quickly, understands why it got its score, and does not lose track of an application.

## Positioning

A private tool for one person, on the user's own machine, with one SQLite file. It is not a product for other people. It has no marketing surface, no accounts, and no onboarding for strangers.

Each score is explained. A language model extracts the facts of a posting and judges skills, experience, and preferences. Code checks location, spoken language, work arrangement, and excluded companies, and computes the total from the user's weights. The user can see each part.

## Operating Context

- The user imports a CV as a file or as text. The system derives a structured profile, and the user corrects it by hand.
- The system fetches on a schedule from Jobindex, LinkedIn guest search, Remotive, Arbeitnow, and Remote OK.
- Postings arrive in a ranked list. The user triages each one: save, dismiss, or mark as applied.
- Applications move through stages on a board, with notes and interview dates.
- The user can generate a cover letter for a posting, edit it, copy it, and download it as a PDF file.
- The user can start an expanded match analysis for one posting or for selected postings. It gives a verdict, strengths, gaps, questions to ask, and points to emphasize. It does not change the score.
- A push notification through ntfy reports a new posting with a high score. This is optional.
- Scoring is slow. One posting needs two model calls of several seconds each, so the interface often shows postings that wait for a score.
- The user reaches the interface on the local machine or over a private Tailscale network.

## Capabilities and Constraints

- Views: jobs list with detail, application board, profile, settings, activity.
- Posting states in the interface: waiting, scoring, scored, stale, failed. Triage states: new, saved, dismissed, applied.
- Score bands have a text label as well as a color.
- Postings and letters can be in Danish or English. Interface text is English.
- Live updates arrive over server-sent events.
- Two model providers exist for matching: a local endpoint, and Claude Code with Haiku 5.5. The CV digest, cover letters, and the expanded match analysis always use Fable 5.2 through Claude Code.
- Stack: React 19, Vite, Tailwind 4, framer-motion, TanStack Query, Router, and Virtual. The server is Hono with SQLite.
- Undecided: whether keyboard-first triage is a binding requirement. Keyboard shortcuts exist today.
- The interface has one theme, on a dark grey ground. The user decided this on 2026-11-11.

## Brand Commitments

- Interface text stays in English.
- The name is "Sieve". The interface shows it in lower case as "sieve". The project directory still has the earlier working name.
- No logo, no brand assets, and no voice guide exist.

## Evidence on Hand

- Real postings come from the live boards. A test database with 84 real postings and a synthetic CV exists outside the repository.
- `docs/matching-eval.md` holds measured scoring times and results for 18 real postings.
- No testimonials, customers, usage numbers, or brand assets exist. Future work must not invent them.

## Product Principles

1. The score must explain itself. The user sees why a posting ranks where it does.
2. The user decides. The system ranks and drafts, and the user triages, edits, and sends.
3. Nothing is lost. A triage action can be undone, and an application keeps its copy of the posting.
4. State is always visible. The user can see what waits, what runs, what failed, and what is stale.
5. Private by default. The data stays on the user's machine, and the interface says so when data leaves it.
