# Spec Delta

## Purpose

Tracks the jobs that the user applied to, from the first application to the final outcome.

## ADDED Requirements

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
The system SHALL let the user edit the notes and the interview date of an application. The board SHALL show upcoming interview dates on the cards.

#### Scenario: User sets an interview date
- **WHEN** the user sets an interview date
- **THEN** the card shows the date

### Requirement: Stage history
The system SHALL record every stage change with the earlier stage, the new stage, and the time. The system SHALL show this history on the application.

#### Scenario: User reviews an application
- **WHEN** the user opens an application that changed stage twice
- **THEN** the system shows both changes in time order

### Requirement: Posting snapshot
When an application is created, the system SHALL keep a copy of the posting's title, company, description, and extracted facts. The copy SHALL stay readable after the original posting expires or is deleted.

#### Scenario: Original posting expires
- **WHEN** the link of an applied posting expires
- **THEN** the application still shows the full description from the copy

### Requirement: Remove an application
The system SHALL let the user remove an application. The posting SHALL return to the triage status "saved".

#### Scenario: User removes an application
- **WHEN** the user removes an application and confirms
- **THEN** the application and its history are deleted
- **AND** the posting appears in the job list as saved
