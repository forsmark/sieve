# application-tracking Specification

## Purpose
Tracks the jobs that the user applied to, from the first application to the final outcome.

## Requirements

### Requirement: Application record
The system SHALL keep one application for each posting that the user marks as applied. The application SHALL hold a stage, notes, an applied date, and an optional interview date.

#### Scenario: Application is created
- **WHEN** the user marks a posting as applied
- **THEN** the system creates an application in the stage "applied" with the current date

#### Scenario: Posting already has an application
- **WHEN** the user marks a posting as applied a second time
- **THEN** the system keeps the existing application and creates no second one

### Requirement: Application stages
An application SHALL be in exactly one stage: applied, interview, offer, rejected, or withdrawn. The system SHALL let the user move an application to any other stage.

#### Scenario: User moves an application
- **WHEN** the user moves an application from "applied" to "interview"
- **THEN** the application shows in the "interview" stage

#### Scenario: Unknown stage
- **WHEN** the user moves an application to a stage that is not applied, interview, offer, rejected, or withdrawn
- **THEN** the system refuses the change
- **AND** the application keeps its earlier stage

### Requirement: Application board
The system SHALL show applications on a board with one column for each stage. The system SHALL let the user move a card between columns by drag and by keyboard.

#### Scenario: User drags a card
- **WHEN** the user drags a card to another column
- **THEN** the application takes the stage of that column
- **AND** the change persists after a reload

#### Scenario: Move fails
- **WHEN** the system cannot store a stage change
- **THEN** the card returns to its earlier column and the system reports the error

### Requirement: Notes and dates
The system SHALL let the user edit the notes and the interview date of an application. The system SHALL store a change to the notes or the interview date without a separate save step, at the latest when the application closes. When a change cannot be stored, the system SHALL keep the typed notes for the next time the user opens the application. The board SHALL show upcoming interview dates on the cards.

#### Scenario: User sets an interview date
- **WHEN** the user sets an interview date
- **THEN** the card shows the date

#### Scenario: User edits the notes
- **WHEN** the user changes the notes of an application and leaves the notes field
- **THEN** the system stores the notes
- **AND** the application shows the new notes when the user opens it again

#### Scenario: User closes the application while typing
- **WHEN** the user types in the notes and closes the application without leaving the field first
- **THEN** the system stores the notes

#### Scenario: Notes cannot be stored
- **WHEN** the system cannot store a change to the notes
- **THEN** the system reports the error
- **AND** the application shows the typed notes when the user opens it again

### Requirement: Stage history
The system SHALL record every stage change with the earlier stage, the new stage, and the time. The system SHALL show this history on the application.

#### Scenario: User reviews an application
- **WHEN** the user opens an application that changed stage twice
- **THEN** the system shows both changes in time order

#### Scenario: Stage change is recorded
- **WHEN** the user moves an application from "applied" to "interview"
- **THEN** the history holds an entry with the earlier stage "applied", the new stage "interview", and the time of the change

### Requirement: Stage change feedback
When the user moves an application to another stage, the system SHALL name the new stage and offer an undo action. The undo SHALL move the application back to its earlier stage, and the stage history records that move as any other.

#### Scenario: User moves an application
- **WHEN** the user moves an application from "applied" to "offer"
- **THEN** the system states that the application moved to "offer"
- **AND** the system offers an undo action

#### Scenario: User undoes a stage change
- **WHEN** the user moves an application from "applied" to "offer" and then undoes the move
- **THEN** the application is in the stage "applied"
- **AND** the stage history holds both changes

### Requirement: Posting snapshot
When an application is created, the system SHALL keep a copy of the posting's title, company, description, and extracted facts. The copy SHALL stay readable after the original posting expires or is deleted.

#### Scenario: Original posting expires
- **WHEN** the link of an applied posting expires
- **THEN** the application still shows the full description from the copy

#### Scenario: Application keeps a copy
- **WHEN** the user marks a posting as applied
- **THEN** the application holds a copy of the posting's title, company, description, and extracted facts

#### Scenario: Original posting is deleted
- **WHEN** the original posting of an application is deleted
- **THEN** the application stays and still shows the title, the company, and the description from the copy

### Requirement: Remove an application
The system SHALL let the user remove an application. The posting SHALL return to the triage status "saved".

#### Scenario: User removes an application
- **WHEN** the user removes an application and confirms
- **THEN** the application and its history are deleted
- **AND** the posting appears in the job list as saved

#### Scenario: Posting was new before
- **WHEN** the user removes an application of a posting that had the triage status "new" before the user applied
- **THEN** the posting has the triage status "saved", not "new"
