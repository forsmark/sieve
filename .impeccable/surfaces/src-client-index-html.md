---
version: 1
slug: "src-client-index-html"
primary_target: "src/client/index.html"
related_targets: []
---

# Surface brief: Sieve application shell and all work screens

Scope: the whole single-page application (jobs list and detail, board, profile, settings, activity, login). Visitor mode: Operate.

Audience and job: one developer triages ranked job postings, reads why each got its score, writes a cover letter, and tracks applications.

Constraints: interface text in English. One theme on a dark grey ground. The jobs list is a grid of cards. Connected tiles are used in the posting detail and on the board. Controls stay standard web controls.

Unresolved: none.

## Direction contract

THESIS: The score explains itself as a diagram. The posting detail is a mosaic of flat tiles that touch, and a notch points from each tile to the tile that follows from it. It refuses the grey dashboard with rounded cards and one blue accent.

OWN-WORLD: Swiss poster discipline on a dark grey ground (not black). Four flat color fields with near-black text: yellow, pale blue-grey, pink, beige. White text on the ground. Zero corner radius everywhere. Hairline rules of 1px. No shadows, no gradients. One grotesk family in few weights, with tabular numerals and large numerals for scores. Color names the kind of content: yellow is the score and the primary action, blue-grey is facts and skills, pink is the cover letter and applications, beige is the posting text.

STORY: The user sees the ranked list, opens one posting, reads the score and its parts as one connected figure, and acts.

FIRST VIEWPORT: A top bar with the wordmark, five text links, and counts, closed by a hairline. Left: the grid of posting cards, each with a large score numeral. The open card turns yellow. Right: the detail mosaic. The yellow score tile sits top left with the largest numeral on the screen. A notch links it to one tile that holds the four parts with their weights, then to the blue-grey skill tile and the assessment. The actions Dismiss, Save, and Mark as applied sit in the detail header.

FORM: Direction pinned by the user with two reference images (palette on dark ground, connected tiles). A roll ran after the build for the record only, and the pinned direction stayed. seed:b1a7c0d0d96ef4ea

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
