# Spec Delta

## Purpose

Gives the user a deeper comparison of selected postings with the CV than the score gives, so that the user can decide whether to apply.

## ADDED Requirements

### Requirement: Expanded match analysis
The system SHALL write an expanded match analysis for a posting when the user asks for one. The system SHALL use the Claude Code command line with Fable 5.2 at medium effort, whatever provider the user selected for matching. The analysis SHALL NOT change the score of the posting.

#### Scenario: User analyzes one posting
- **WHEN** the user asks for an expanded analysis of a posting and a CV exists
- **THEN** the system writes the analysis from the posting, the CV, the profile, the preferences, and the earlier score, and shows it with the posting

#### Scenario: User analyzes selected postings
- **WHEN** the user selects postings in the list and starts the analysis
- **THEN** the system queues one analysis for each selected posting
- **AND** each card shows that the analysis runs, and then its verdict

#### Scenario: Too many postings are selected
- **WHEN** the user starts the analysis for more than 20 postings in one request
- **THEN** the system refuses and states the limit

#### Scenario: No CV and no profile exist
- **WHEN** the user asks for an analysis and the system holds neither a CV text nor a profile
- **THEN** the system refuses and tells the user to import a CV

#### Scenario: Matching is paused
- **WHEN** matching is paused or the match queue holds work
- **THEN** an analysis request still runs at once

#### Scenario: Analysis fails
- **WHEN** the model call fails
- **THEN** the system reports the cause and keeps an earlier analysis for that posting

### Requirement: Analysis content
The analysis SHALL hold a verdict of "apply", "consider", or "skip", a summary, strengths, gaps, questions to ask the employer, and points to emphasize in an application. The analysis SHALL use only facts from the posting, the CV, the profile, and the preferences.

#### Scenario: Analysis is ready
- **WHEN** the model returns the analysis
- **THEN** the posting shows the verdict and the summary
- **AND** each strength shows its evidence from the CV, and each gap shows a severity and a mitigation

#### Scenario: Model returns another form
- **WHEN** the answer of the model does not hold the required parts
- **THEN** the system stores no analysis from that answer and reports a failure

### Requirement: Analysis storage
The system SHALL store one expanded analysis for each posting, with the model and the date. The user SHALL be able to run the analysis again and remove it. The interface SHALL state that the CV text and the posting text go to Anthropic.

#### Scenario: User runs the analysis again
- **WHEN** the user runs the analysis again for a posting that has one
- **THEN** the earlier analysis stays readable until the new one is ready

#### Scenario: User removes the analysis
- **WHEN** the user removes the analysis of a posting
- **THEN** the posting and its card show no analysis

#### Scenario: Analysis is stored with model and date
- **WHEN** the analysis of a posting is ready
- **THEN** the system stores it with the model and the date it was written
- **AND** a new analysis of the same posting replaces it, so the posting holds one analysis

#### Scenario: Data notice
- **WHEN** the user views the analysis section of a posting
- **THEN** the interface states that the CV text and the posting text are sent to Anthropic
