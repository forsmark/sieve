# Spec Delta

## Purpose

Gives the user one interface to read the ranked postings, understand each score, and decide quickly which jobs to keep.

## ADDED Requirements

### Requirement: Ranked job list
The system SHALL show primary postings as a list in ranking order. Each row SHALL show the posting's title, company, and location as *Posting normalization* in `job-ingestion` stores them, and the source, work arrangement, total score, age, and match state.

#### Scenario: User opens the application
- **WHEN** the user opens the job list
- **THEN** the new and saved postings appear in the order that *Ranking order* in `job-matching` defines, highest score first

#### Scenario: Long list
- **WHEN** the list has more postings than fit on the screen
- **THEN** the system loads further postings as the user scrolls and the interface stays responsive

### Requirement: Score presentation
The system SHALL show the total score as a number with a color band for high, medium, and low. The system SHALL NOT use color as the only signal. A stale score SHALL carry a visible marker.

#### Scenario: Stale score
- **WHEN** a posting's score comes from an older profile version
- **THEN** the row shows the score with a stale marker

#### Scenario: Score in its color band
- **WHEN** a row shows a total score
- **THEN** the score appears as a number in the color of its band: high, medium, or low

#### Scenario: Band named in text
- **WHEN** a row shows a total score
- **THEN** the row also names the band in text, so the band reads without its color

### Requirement: Job detail view
The system SHALL show a detail view for a selected posting next to the list on wide screens and as a full screen on narrow screens. The detail view SHALL show the score breakdown by dimension, matched skills, missing skills, the assessment, the extracted facts, the full description, and links to every source.

#### Scenario: User selects a posting
- **WHEN** the user selects a row
- **THEN** the detail view shows that posting and the list keeps its scroll position

#### Scenario: Posting is expired
- **WHEN** the selected posting's link is marked as expired
- **THEN** the detail view states that the posting may no longer be available

### Requirement: Shareable view state
The system SHALL keep the selected posting, the active filters, and the sort order in the address of the page.

#### Scenario: User reloads the page
- **WHEN** the user reloads the page with filters and a selected posting
- **THEN** the same filters and the same posting are shown

### Requirement: Triage actions
The system SHALL let the user save, dismiss, or mark a posting as applied, and undo each action. A posting's triage status SHALL be one of new, saved, dismissed, or applied.

#### Scenario: User dismisses a posting
- **WHEN** the user dismisses a posting
- **THEN** the posting leaves the default list
- **AND** the system offers an undo action

#### Scenario: User marks a posting as applied
- **WHEN** the user marks a posting as applied
- **THEN** the system creates an application for it in the first stage of the application board

### Requirement: Filters and search
The system SHALL let the user filter the list by triage status, source, work arrangement, minimum score, tag, and age, and search by text in title, company, and description. The system SHALL show how many postings match.

#### Scenario: User combines filters
- **WHEN** the user selects remote work and a minimum score of 70
- **THEN** the list shows only postings that meet both conditions

#### Scenario: No posting matches
- **WHEN** no posting matches the filters
- **THEN** the system shows an empty state with an action that clears the filters

### Requirement: Default visibility
By default the list SHALL hide dismissed postings, excluded postings, and duplicates. The system SHALL let the user show each hidden group. An excluded posting SHALL show its exclusion reason.

#### Scenario: User shows excluded postings
- **WHEN** the user enables the excluded group
- **THEN** excluded postings appear with the reason for each

#### Scenario: Default list
- **WHEN** the user opens the job list without filters
- **THEN** dismissed postings, excluded postings, and duplicates do not appear

#### Scenario: User shows a hidden group
- **WHEN** the user enables the dismissed status, the excluded group, or the duplicate group
- **THEN** the postings of that group appear in the list

### Requirement: Unread tracking
The system SHALL mark a posting as unread until the user opens it. The system SHALL let the user filter by unread.

#### Scenario: New postings since the last visit
- **WHEN** a fetch run adds postings
- **THEN** the new postings appear as unread

#### Scenario: User opens an unread posting
- **WHEN** the user opens a posting that is marked as unread
- **THEN** the posting is no longer marked as unread

#### Scenario: User filters by unread
- **WHEN** the user enables the unread filter
- **THEN** the list shows only unread postings

### Requirement: Bulk actions
The system SHALL let the user select several postings and apply one triage action or one rescore request to all of them.

#### Scenario: User dismisses a selection
- **WHEN** the user selects five postings and chooses dismiss
- **THEN** the system dismisses all five and offers one undo action for the group

### Requirement: Keyboard operation
The system SHALL let the user move through the list and apply every triage action with the keyboard. The system SHALL list the shortcuts in the interface.

#### Scenario: User triages with the keyboard
- **WHEN** the user moves to the next posting and presses the save shortcut
- **THEN** the system saves that posting and keeps focus in the list

#### Scenario: Every triage action has a key
- **WHEN** the user presses the dismiss, applied, restore, or undo shortcut on a posting
- **THEN** the system applies that action to the posting

#### Scenario: User reads the shortcut list
- **WHEN** the user opens the shortcut list from the job list
- **THEN** the interface lists the keys that move through the list and the key of each triage action

### Requirement: Live progress
The system SHALL update the list and the status display without a page reload when a fetch run changes state, when a score arrives, or when the language model endpoint changes availability.

#### Scenario: Score arrives
- **WHEN** the system scores a posting that is visible in the list
- **THEN** the row shows the score without a reload
- **AND** the row moves to its new place in the ranking order with a visible motion
- **AND** the keyboard cursor stays on the same posting

#### Scenario: Fetch run is active
- **WHEN** a fetch run is active
- **THEN** the interface shows the run and the progress of each source

### Requirement: Settings screens
The system SHALL provide screens to manage the CV and profile, the preferences and weights, the sources and search terms, the schedule, the language model provider, and the notifications.

#### Scenario: User tests the language model provider
- **WHEN** the user selects a provider, enters its settings, and requests a test
- **THEN** the system reports whether the provider responds and whether the selected model is available

#### Scenario: Provider sends data off the machine
- **WHEN** the user selects the Claude Code provider
- **THEN** the settings screen states that posting text and profile data leave the machine

### Requirement: Activity view
The system SHALL provide a view that shows the fetch run history, the background work that failed with its error, and the system log. The system SHALL let the user retry failed work.

#### Scenario: User inspects a failure
- **WHEN** background work for a posting failed
- **THEN** the activity view shows the posting, the kind of work, and the error

#### Scenario: User retries failed work
- **WHEN** the user retries a failed item
- **THEN** the system queues that work again

### Requirement: Database backups
The system SHALL create a backup of all data on a schedule and SHALL keep a configured number of recent backups. The system SHALL let the user create a backup on request and download any stored backup.

#### Scenario: Scheduled backup
- **WHEN** the backup interval passes
- **THEN** the system stores a new backup and deletes the oldest one beyond the retention count

#### Scenario: User downloads a backup
- **WHEN** the user requests a stored backup
- **THEN** the system delivers a file that holds a complete copy of the data

### Requirement: Access control
When the user configures a password, the system SHALL require it before it shows any data or accepts any change. A session SHALL survive a restart of the system.

#### Scenario: Password is configured
- **WHEN** a visitor without a valid session opens any page
- **THEN** the system shows only the login screen

#### Scenario: Restart
- **WHEN** the system restarts while the user has a valid session
- **THEN** the user stays logged in
