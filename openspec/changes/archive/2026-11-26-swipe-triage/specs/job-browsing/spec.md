# Spec Delta

## ADDED Requirements

### Requirement: Swipe triage
On touch input, the system SHALL let the user move a posting one step along the statuses dismissed, new, saved, and applied by swiping its card in the list: to the right toward applied, to the left toward dismissed. A swipe from applied to saved SHALL remove the application only after the user confirms. Every other swipe SHALL offer the same undo as the other triage actions. A mouse drag SHALL NOT triage a posting.

#### Scenario: User swipes a new posting to the left
- **WHEN** the user swipes the card of a new posting far enough to the left on a touch screen and lifts the finger
- **THEN** the system dismisses the posting and the card leaves the default list
- **AND** the system offers an undo action
- **AND** the posting does not open

#### Scenario: User swipes a new posting to the right
- **WHEN** the user swipes the card of a new posting far enough to the right and lifts the finger
- **THEN** the system saves the posting
- **AND** the system offers an undo action

#### Scenario: User swipes a saved posting to the right
- **WHEN** the user swipes the card of a saved posting far enough to the right and lifts the finger
- **THEN** the system marks the posting as applied and creates its application in the first stage of the application board
- **AND** the system offers an undo action

#### Scenario: User swipes a saved posting to the left
- **WHEN** the user swipes the card of a saved posting far enough to the left and lifts the finger
- **THEN** the posting is new again and stays in the default list
- **AND** the system offers an undo action

#### Scenario: User swipes a dismissed posting to the right
- **WHEN** the list shows dismissed postings and the user swipes the card of a dismissed posting far enough to the right
- **THEN** the posting is new again
- **AND** the system offers an undo action

#### Scenario: Swipe past the end of the line
- **WHEN** the user swipes a dismissed posting to the left, or an applied posting to the right
- **THEN** the card does not move in that direction and the posting keeps its status

#### Scenario: User swipes an applied posting to the left
- **WHEN** the user swipes the card of an applied posting far enough to the left and lifts the finger
- **THEN** the card returns to its place and the system asks the user to confirm the removal of the application
- **AND** the question states that the notes and the history of the application are deleted and cannot be restored
- **AND** the posting stays applied until the user confirms

#### Scenario: User confirms the removal by swipe
- **WHEN** the user confirms the removal that a swipe asked for
- **THEN** the system removes the application as *Remove an application* in `application-tracking` defines, and the posting is saved
- **AND** the system offers no undo action

#### Scenario: User cancels the removal by swipe
- **WHEN** the user cancels the removal that a swipe asked for
- **THEN** the posting stays applied and keeps its application

#### Scenario: Mouse drag
- **WHEN** the user drags a card sideways with a mouse
- **THEN** the card stays in its place and the posting keeps its status

#### Scenario: Swipe while cards are selected
- **WHEN** other cards are selected for a bulk action and the user swipes one card
- **THEN** only the swiped posting changes its status
- **AND** the other cards stay selected

### Requirement: Swipe feedback
While a card moves under the finger, the system SHALL name the action that a release takes and show when the swipe is far enough to take it. A swipe that ends short of that point SHALL change nothing.

#### Scenario: Swipe in progress
- **WHEN** the user moves a card sideways with a finger
- **THEN** the space that the card uncovers names the action that a release takes
- **AND** that space changes its look when the swipe is far enough to take the action

#### Scenario: Short swipe
- **WHEN** the user lifts the finger before the swipe is far enough
- **THEN** the card returns to its place and the posting keeps its status
- **AND** the posting does not open

#### Scenario: Vertical drag
- **WHEN** the user drags a card mostly up or down with a finger
- **THEN** the list scrolls and no posting changes its status
