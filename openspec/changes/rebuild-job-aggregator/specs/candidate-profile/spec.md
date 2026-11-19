# Spec Delta

## Purpose

Holds what the system knows about the user: the CV, a structured profile derived from it, and the preferences that constrain and weight the match.

## ADDED Requirements

### Requirement: CV import
The system SHALL accept the user's CV as a PDF file, a Markdown file, or pasted text. The system SHALL keep the original text of the current CV.

#### Scenario: User uploads a PDF
- **WHEN** the user uploads a text-based PDF
- **THEN** the system extracts the text and stores it as the current CV

#### Scenario: File has no readable text
- **WHEN** the user uploads a file from which the system can extract no text
- **THEN** the system rejects the file and explains that it needs a text-based document

### Requirement: Structured profile
The system SHALL derive a structured profile from the CV with the Claude Code command line and Fable 5.2 at medium effort, whatever provider the user selected for matching. The profile SHALL contain skills with an experience level, past roles with dates, total years of experience, spoken languages, and education.

#### Scenario: Profile is derived
- **WHEN** the user imports a CV
- **THEN** the system produces a structured profile and shows it for review

#### Scenario: Derivation fails
- **WHEN** the system cannot derive a profile from the CV
- **THEN** the system keeps the CV text, reports the failure, and lets the user retry or fill the profile by hand

### Requirement: Profile review and edit
The system SHALL let the user edit every field of the structured profile. User edits SHALL take priority over derived values and SHALL survive a later derivation unless the user chooses to discard them.

#### Scenario: User corrects a skill
- **WHEN** the user changes the experience level of a skill
- **THEN** the system stores the change and uses it for later matches

#### Scenario: CV is imported again
- **WHEN** the user imports a new CV and the profile has manual edits
- **THEN** the system asks whether to keep or discard the manual edits

### Requirement: Job preferences
The system SHALL let the user state preferences: accepted locations, commutable locations, accepted work arrangements, target seniority, minimum salary with currency, wanted technologies, unwanted technologies, excluded companies, and free-text notes.

#### Scenario: User saves preferences
- **WHEN** the user saves valid preferences
- **THEN** the system stores them and reports which stored scores are now out of date

#### Scenario: Invalid preference value
- **WHEN** the user enters a negative minimum salary
- **THEN** the system rejects the value and keeps the earlier preferences

### Requirement: Hard and soft constraints
The system SHALL let the user mark each location, language, and work arrangement preference as hard or soft. Excluded companies SHALL always be hard. A hard constraint excludes a job. A soft constraint lowers its score.

#### Scenario: User makes location hard
- **WHEN** the user marks the location preference as hard
- **THEN** jobs outside the accepted and commutable locations that are not remote become excluded

### Requirement: Scoring weights
The system SHALL let the user set the relative weight of each score dimension. The default weights SHALL be 40 for skills, 25 for experience, 20 for preferences, and 15 for location.

#### Scenario: User raises one weight
- **WHEN** the user raises the weight of the skills dimension
- **THEN** the system recomputes total scores with the new weight

#### Scenario: User has set no weights
- **WHEN** the user has not changed the weights
- **THEN** the system uses 40, 25, 20, and 15 for skills, experience, preferences, and location

#### Scenario: User removes location from the score
- **WHEN** the user turns off "Count location in the score"
- **THEN** the system sets the location weight to 0 and computes each total from the other dimensions only
- **AND** the score breakdown marks location as not counted
- **AND** a hard location constraint still excludes postings

### Requirement: Profile versions
The system SHALL assign a version to the combination of structured profile and preferences. Only a change that can alter a match result SHALL create a new version.

#### Scenario: Match-relevant change
- **WHEN** the user adds a skill to the profile
- **THEN** the system creates a new profile version

#### Scenario: Unrelated setting changes
- **WHEN** the user changes the fetch interval
- **THEN** the profile version stays the same

### Requirement: Profile required for matching
The system SHALL NOT score postings while no structured profile exists. The system SHALL tell the user what is missing.

#### Scenario: First start
- **WHEN** the user opens the application before importing a CV
- **THEN** the system shows a setup step that asks for the CV
- **AND** collected postings stay unscored
