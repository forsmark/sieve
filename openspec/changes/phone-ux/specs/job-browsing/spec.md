# Spec Delta

## MODIFIED Requirements

### Requirement: Unread tracking
The system SHALL mark a posting as unread until the user opens it. A posting that the detail view opens by itself after a triage action SHALL count as opened only after it stays open for 1.5 seconds. The system SHALL let the user filter by unread.

#### Scenario: New postings since the last visit
- **WHEN** a fetch run adds postings
- **THEN** the new postings appear as unread

#### Scenario: User opens an unread posting
- **WHEN** the user opens a posting that is marked as unread
- **THEN** the posting is no longer marked as unread

#### Scenario: User filters by unread
- **WHEN** the user enables the unread filter
- **THEN** the list shows only unread postings

#### Scenario: Next posting opens after a triage action
- **WHEN** the user triages the posting in the detail view, the detail view opens the next posting by itself, and that posting is unread
- **THEN** the next posting stays unread while it is open for less than 1.5 seconds
- **AND** it is no longer marked as unread once it has been open for 1.5 seconds

### Requirement: Bulk actions
The system SHALL let the user select several postings and apply one triage action or one rescore request to all of them. When part of the list is selected, the select-all control SHALL show a mixed state. Using the select-all control in the mixed state SHALL clear the selection.

#### Scenario: User dismisses a selection
- **WHEN** the user selects five postings and chooses dismiss
- **THEN** the system dismisses all five and offers one undo action for the group

#### Scenario: Part of the list is selected
- **WHEN** the user selects some but not all of the postings in the list
- **THEN** the select-all control shows a mixed state, distinct from both checked and unchecked

#### Scenario: User clears a partial selection
- **WHEN** part of the list is selected and the user uses the select-all control
- **THEN** no posting is selected

### Requirement: Keyboard operation
The system SHALL let the user move through the list and apply every triage action with the keyboard. The system SHALL list the shortcuts in the interface. When the user closes the detail view, the system SHALL move focus to the card of the posting that the detail view showed.

#### Scenario: User triages with the keyboard
- **WHEN** the user moves to the next posting and presses the save shortcut
- **THEN** the system saves that posting and keeps focus in the list

#### Scenario: Every triage action has a key
- **WHEN** the user presses the dismiss, applied, restore, or undo shortcut on a posting
- **THEN** the system applies that action to the posting

#### Scenario: User reads the shortcut list
- **WHEN** the user opens the shortcut list from the job list
- **THEN** the interface lists the keys that move through the list and the key of each triage action

#### Scenario: User closes the detail view
- **WHEN** the user opens a posting, moves focus into the detail view, and closes it
- **THEN** focus is on the card of that posting in the list

## ADDED Requirements

### Requirement: Undo after the message
The system SHALL keep the latest triage action undoable after its undo message closes, until the user takes another undoable action. While that action can be undone and its message is closed, the job list SHALL show an undo control.

#### Scenario: Message has closed
- **WHEN** the undo message of a triage action has closed and the user uses the undo control in the job list
- **THEN** the system undoes that triage action

#### Scenario: Undo control in the job list
- **WHEN** the undo message of a triage action closes
- **THEN** the job list shows an undo control that names the action it undoes

### Requirement: Undo returns to the posting
When the user undoes a triage action after which the detail view moved on to another posting, and the job list is still open, the system SHALL show the posting of that action in the detail view again.

#### Scenario: User undoes a triage action from the detail view
- **WHEN** the user dismisses the posting in the detail view, the detail view moves on to the next posting, and the user undoes the dismissal
- **THEN** the detail view shows the dismissed posting again, with its earlier status

### Requirement: Offline state
When the device has no network connection, the system SHALL say so in the status display. An action that the user takes while the device is offline SHALL fail with a message instead of waiting.

#### Scenario: Connection is lost
- **WHEN** the device loses its network connection
- **THEN** the status display states that the system is offline

#### Scenario: Action while offline
- **WHEN** the user takes an action that changes data while the device is offline
- **THEN** the system reports that the action failed
- **AND** the interface shows the state from before the action
