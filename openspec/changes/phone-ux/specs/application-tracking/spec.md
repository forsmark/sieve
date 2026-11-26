# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
