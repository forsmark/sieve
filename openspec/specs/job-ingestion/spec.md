# job-ingestion Specification

## Purpose
Turns raw postings from the sources into one clean record for each real job, with a usable description and a known link state.

## Requirements

### Requirement: Posting normalization
The system SHALL store every accepted posting in one common shape: source, source identifier, title, company, location, link, description, and posted date. The system SHALL store descriptions as plain text without markup.

#### Scenario: Posting has markup
- **WHEN** a source returns a description that contains HTML
- **THEN** the system stores the text without tags and keeps paragraph breaks

#### Scenario: Posting lacks a required field
- **WHEN** a raw posting has no title, no company, or no valid link
- **THEN** the system discards the posting and counts it as invalid in the run history

### Requirement: Idempotent ingestion
The system SHALL identify a posting by its source and source identifier. When a source returns a posting that the system already stores, the system SHALL NOT create a second record and SHALL NOT change the user's triage status or score.

#### Scenario: Same posting appears again
- **WHEN** a fetch run returns a posting that an earlier run stored
- **THEN** the system keeps one record
- **AND** the record keeps its status, score, and first-seen time

#### Scenario: Posting gains a description
- **WHEN** a stored posting has no description and a later fetch returns one
- **THEN** the system adds the description to the stored record

### Requirement: Cross-source duplicate detection
The system SHALL detect when two postings from any sources describe the same job at the same company. The system SHALL keep the first posting as the primary record and link the later posting to it as a duplicate.

#### Scenario: Same job on two boards
- **WHEN** two sources return postings with the same company and the same title after normalization
- **THEN** the system marks the later posting as a duplicate of the first

#### Scenario: Titles differ only by seniority or legal suffix
- **WHEN** two postings differ only by a seniority word in the title or a legal suffix in the company name
- **THEN** the system treats them as the same job

#### Scenario: Different roles at one company
- **WHEN** two postings share a company and their titles describe different roles
- **THEN** the system keeps both as primary records

### Requirement: Duplicates stay out of ranking
The system SHALL NOT score a duplicate posting and SHALL NOT show it as a separate row in the ranked list. The primary record SHALL list every source that carries the job.

#### Scenario: Duplicate arrives
- **WHEN** the system marks a posting as a duplicate
- **THEN** the posting does not enter the match queue
- **AND** the primary record shows the extra source and its link

#### Scenario: Job on two boards in the ranked list
- **WHEN** the user views the ranked list and a job has a primary record and a duplicate
- **THEN** the list shows the job as one row, the primary record

### Requirement: Manual duplicate correction
The system SHALL let the user separate a posting that was wrongly marked as a duplicate. A separated posting SHALL become a primary record and enter the match queue.

#### Scenario: User separates a duplicate
- **WHEN** the user separates a duplicate from its primary record
- **THEN** the posting appears as its own row and the system scores it

#### Scenario: Separated posting stays separate
- **WHEN** a later fetch run returns the separated posting and its former primary record again
- **THEN** the system keeps both as primary records

### Requirement: Description enrichment
When a posting has no description or a very short one, the system SHALL try to fetch the full text from the posting's page before it scores the posting. When a source gives only a teaser of the job text, the system SHALL fetch the full text for each posting of that source, whatever the length of the teaser.

#### Scenario: Missing description is fetched
- **WHEN** a posting without a description enters the pipeline
- **THEN** the system fetches the posting page and stores the extracted job text

#### Scenario: Source gives only a teaser
- **WHEN** a Jobindex posting enters the pipeline with the teaser of the search result
- **THEN** the system follows the "Se jobbet" link of the job page to the advertisement on Jobindex or to the page of the employer
- **AND** the system stores the teaser followed by the full job text

#### Scenario: Full text of a teaser source is not reachable
- **WHEN** the system cannot fetch or extract the full text and the teaser is long enough to score
- **THEN** the system keeps the teaser, scores the posting from it, and does not try again by itself

#### Scenario: User rescores a posting that has only a teaser
- **WHEN** the user rescores a posting of a teaser source whose full text was never fetched
- **THEN** the system fetches the full text first

#### Scenario: Enrichment fails
- **WHEN** the system cannot fetch or extract the description and the posting has no usable text
- **THEN** the system marks the posting as lacking a description
- **AND** the system still scores it from the title, company, and location with a low-confidence flag

### Requirement: Link liveness
The system SHALL check from time to time whether the links of untriaged and saved postings still work. The system SHALL record each link as active, expired, or unknown.

#### Scenario: Posting was removed
- **WHEN** a posting's link reports that the page no longer exists
- **THEN** the system marks the posting as expired

#### Scenario: Check is inconclusive
- **WHEN** the link check fails for a reason that does not prove removal
- **THEN** the system marks the link as unknown and checks it again later

### Requirement: Durable pipeline work
The system SHALL keep pending ingestion work across restarts. Work that was pending or in progress at shutdown SHALL resume after startup.

#### Scenario: Restart with pending work
- **WHEN** the system restarts while postings wait for enrichment
- **THEN** the system resumes enrichment for those postings without user action

#### Scenario: Restart while enrichment runs
- **WHEN** the system restarts while it fetches the description of a posting
- **THEN** the system runs the enrichment of that posting again after startup
