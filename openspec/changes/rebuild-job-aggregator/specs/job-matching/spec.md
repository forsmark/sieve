# Spec Delta

## Purpose

Compares each job posting with the candidate profile and produces an explainable score that ranks the postings.

## ADDED Requirements

### Requirement: Posting fact extraction
The system SHALL extract structured facts from each primary posting once: required skills, optional skills, seniority, work arrangement, location, required spoken languages, salary range, and a short factual summary. These facts SHALL NOT depend on the candidate profile.

#### Scenario: Facts are extracted
- **WHEN** a primary posting with a description enters the match queue
- **THEN** the system stores the extracted facts with the posting

#### Scenario: Posting does not state a fact
- **WHEN** the posting does not state a salary or a work arrangement
- **THEN** the system stores that fact as unknown and does not guess

### Requirement: Hard constraint evaluation
The system SHALL evaluate hard constraints from the user's preferences against the extracted facts without a language model. A posting that violates a hard constraint SHALL be marked as excluded with the reason.

#### Scenario: Excluded company
- **WHEN** a posting's company is on the excluded list
- **THEN** the system marks the posting as excluded with the reason "excluded company"

#### Scenario: Required language is missing
- **WHEN** language is a hard constraint and the posting requires a spoken language that the profile lacks
- **THEN** the system marks the posting as excluded and names the language

#### Scenario: Fact is unknown
- **WHEN** a hard constraint depends on a fact that is unknown for the posting
- **THEN** the system does not exclude the posting

### Requirement: Dimension scores
The system SHALL score each non-excluded posting from 0 to 100 on separate dimensions: skills fit, experience and seniority fit, preference fit, and location fit.

#### Scenario: Posting is scored
- **WHEN** the system scores a posting
- **THEN** the system stores one score for each dimension

#### Scenario: Soft constraint is violated
- **WHEN** location is a soft constraint and the posting is outside the accepted locations
- **THEN** the location fit score is low and the posting is not excluded

#### Scenario: Soft language constraint is violated
- **WHEN** language is a soft constraint and the posting requires a spoken language that the profile lacks
- **THEN** the total score is lower by the penalty and the posting is not excluded

### Requirement: Total score
The system SHALL compute the total score from the dimension scores, the user's weights, and a penalty for each violated soft constraint on language or work arrangement. The same inputs SHALL always produce the same total.

#### Scenario: Weights change
- **WHEN** the user changes the scoring weights
- **THEN** the system recomputes every total score without extracting or judging postings again

### Requirement: Match explanation
The system SHALL store an explanation with each score: the profile skills that match, the required skills that the profile lacks, and a short assessment addressed to the user.

#### Scenario: User reads why a job ranks high
- **WHEN** the user opens a scored posting
- **THEN** the system shows the matched skills, the missing skills, and the assessment

### Requirement: Ranking order
The system SHALL rank primary postings by total score from high to low. Postings with equal scores SHALL rank by posted date, newest first. Excluded and unscored postings SHALL rank after scored postings.

#### Scenario: Two postings have the same score
- **WHEN** two postings have the same total score
- **THEN** the newer posting ranks first

### Requirement: Asynchronous matching
The system SHALL make a posting visible as soon as it is ingested and SHALL fill in its score later. The system SHALL show the match state of each posting: waiting, in progress, scored, excluded, or failed.

#### Scenario: New posting before scoring
- **WHEN** a new posting is ingested
- **THEN** the posting appears in the list with the state "waiting"

### Requirement: Durable match queue
The system SHALL keep the match queue across restarts. The system SHALL let the user pause and resume matching.

#### Scenario: Restart with queued postings
- **WHEN** the system restarts while postings wait for a score
- **THEN** the system continues to score them after startup

#### Scenario: Matching is paused
- **WHEN** the user pauses matching
- **THEN** the system finishes the posting in progress and starts no other until the user resumes

### Requirement: Language model provider selection
The system SHALL let the user select one language model provider: a local endpoint, which is the default, or the Claude Code command line that is installed on the same machine. For the Claude Code provider the system SHALL use the Haiku 5.5 model and SHALL let the user select low or medium effort.

#### Scenario: Default provider
- **WHEN** the user has selected no provider
- **THEN** the system uses the local endpoint

#### Scenario: User selects Claude Code
- **WHEN** the user selects the Claude Code provider with medium effort
- **THEN** later match work uses the Claude Code command line with Haiku 5.5 at medium effort

#### Scenario: Claude Code is not installed
- **WHEN** the user selects the Claude Code provider and the command is missing or not logged in
- **THEN** the system reports the cause and keeps the earlier provider

#### Scenario: Provider change keeps scores
- **WHEN** the user changes the provider
- **THEN** existing facts and scores stay valid and only later work uses the new provider

### Requirement: Language model outage handling
When the selected language model provider is unreachable, the system SHALL stop match work, keep the queue, show the outage to the user, and resume when the endpoint returns.

#### Scenario: Endpoint goes down
- **WHEN** the language model endpoint stops responding
- **THEN** queued postings stay in the state "waiting"
- **AND** the interface shows that matching is unavailable

#### Scenario: Endpoint returns
- **WHEN** the endpoint responds again
- **THEN** the system resumes the queue without user action

### Requirement: Invalid model output
The system SHALL validate every language model response against the expected structure. After a bounded number of failed attempts for one posting, the system SHALL mark that posting as failed and continue with the next.

#### Scenario: Response is malformed
- **WHEN** the model returns output that does not fit the expected structure
- **THEN** the system retries
- **AND** after the retry limit the posting has the state "failed" with the reason

### Requirement: Stale score detection
The system SHALL record the profile version with each score. A score from an older profile version SHALL be marked as stale and SHALL stay visible until the system replaces it.

#### Scenario: Profile changes
- **WHEN** a new profile version is created
- **THEN** existing scores are marked as stale and stay in the ranking

### Requirement: Selective rescoring
The system SHALL rescore stale postings with the least work that the change needs. A change to weights, to excluded companies, or to a location, language, or work arrangement preference SHALL NOT cause new language model calls. A change to the CV-derived profile SHALL cause new judgments but SHALL reuse the extracted posting facts.

#### Scenario: Only an excluded company is added
- **WHEN** the user adds a company to the excluded list
- **THEN** the system updates the affected postings without a language model call

#### Scenario: Skills change
- **WHEN** the user adds a skill to the profile
- **THEN** the system judges the postings again and does not extract their facts again

#### Scenario: User requests a rescore
- **WHEN** the user requests a rescore for selected postings
- **THEN** the system queues those postings for a full new judgment

### Requirement: Automatic dismissal of low scores
The system SHALL let the user enable automatic dismissal of postings that score below a threshold. Automatic dismissal SHALL apply only to postings that the user has not triaged. A manual rescore SHALL NOT trigger automatic dismissal.

#### Scenario: Low score with the option enabled
- **WHEN** the option is enabled and a new posting scores below the threshold
- **THEN** the system dismisses the posting and records that the dismissal was automatic

#### Scenario: Saved posting scores low after a rescore
- **WHEN** a saved posting scores below the threshold after a rescore
- **THEN** the posting stays saved
