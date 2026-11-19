# Spec Delta

## Purpose

Collects job postings from external job boards on a schedule and on request, and records what each fetch run did.

## ADDED Requirements

### Requirement: Source catalog
The system SHALL expose a catalog of supported job sources. Each source SHALL have a stable identifier, a display name, an enabled flag, and a statement of which search inputs it supports.

#### Scenario: User views the sources
- **WHEN** the user opens the source settings
- **THEN** the system lists every supported source with its name, enabled state, and the result of its last fetch

#### Scenario: Source does not support keywords
- **WHEN** a source cannot search by keyword
- **THEN** the system shows that the source ignores the search terms

### Requirement: Enable and disable sources
The system SHALL let the user enable or disable each source. A fetch run SHALL skip disabled sources. Postings already collected from a disabled source SHALL remain stored.

#### Scenario: Disabled source is skipped
- **WHEN** a fetch run starts and one source is disabled
- **THEN** the run makes no request to that source
- **AND** the run history shows the source as skipped

### Requirement: Search configuration
The system SHALL let the user define search terms and a target region. The system SHALL pass these inputs to every enabled source that supports them.

#### Scenario: Search terms change
- **WHEN** the user saves new search terms
- **THEN** the next fetch run uses the new terms for every source that supports keywords

#### Scenario: No search terms
- **WHEN** the user has saved no search terms
- **THEN** the system warns the user and fetches only from sources that need no keywords

### Requirement: Scheduled fetch runs
The system SHALL start a fetch run at an interval that the user sets in hours. The schedule SHALL continue after a restart without user action.

#### Scenario: Interval passes
- **WHEN** the configured interval passes after the last completed run
- **THEN** the system starts a new fetch run

#### Scenario: Restart with an overdue run
- **WHEN** the system starts and the last completed run is older than the interval
- **THEN** the system starts a fetch run immediately

### Requirement: Manual fetch runs
The system SHALL let the user start a fetch run on request. The system SHALL run at most one fetch run at a time.

#### Scenario: User starts a run
- **WHEN** the user requests a fetch and no run is active
- **THEN** the system starts a run and shows it as active

#### Scenario: Run already active
- **WHEN** the user requests a fetch while a run is active
- **THEN** the system starts no second run and tells the user that a run is active

### Requirement: Pause fetching
The system SHALL let the user pause and resume scheduled fetching. The paused state SHALL persist across restarts.

#### Scenario: Schedule is paused
- **WHEN** fetching is paused and the interval passes
- **THEN** the system starts no fetch run

### Requirement: Source failure isolation
A failure in one source SHALL NOT stop or delay the other sources in the same run. The system SHALL record the failure with its cause.

#### Scenario: One source fails
- **WHEN** one source returns an error during a run
- **THEN** the other sources complete normally
- **AND** the run history shows the failed source with the error message

#### Scenario: Source times out
- **WHEN** a source does not respond within its time limit
- **THEN** the system marks that source as failed for the run and keeps the postings it already returned

### Requirement: Polite request rate
The system SHALL limit the request rate for each source separately. When a source signals rate limiting, the system SHALL wait before it sends the next request to that source.

#### Scenario: Source signals rate limiting
- **WHEN** a source responds with a rate limit signal
- **THEN** the system delays later requests to that source
- **AND** requests to other sources continue at their own rate

### Requirement: Fetch run history
The system SHALL record each fetch run with its start time, end time, and trigger. For each source in the run, the system SHALL record the outcome, the number of postings found, and the number of new postings.

#### Scenario: Run completes
- **WHEN** a fetch run completes
- **THEN** the user can see the run with per-source counts of found and new postings

#### Scenario: Restart during a run
- **WHEN** the system restarts while a run is active
- **THEN** the run history shows that run as interrupted
