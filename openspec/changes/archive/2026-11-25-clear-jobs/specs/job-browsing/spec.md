# Spec Delta

## ADDED Requirements

### Requirement: Clear postings
The system SHALL let the user delete the stored postings from the settings screen, after a confirmation that states how many postings go and how many stay. A posting that has an application SHALL stay, with its score and its application. The system SHALL create a backup of all data before it deletes a posting. The system SHALL NOT clear while a fetch run is active.

#### Scenario: User clears postings
- **WHEN** the user chooses to clear the postings and confirms
- **THEN** the job list holds no posting without an application
- **AND** the scores, cover letters, match analyses, and queued and failed work of the deleted postings are gone
- **AND** the profile, the preferences, and the settings stay

#### Scenario: Confirmation states the counts
- **WHEN** the user chooses to clear the postings
- **THEN** the system states how many postings it deletes and how many stay, before it deletes any

#### Scenario: Posting with an application stays
- **WHEN** the user clears the postings and a posting has an application
- **THEN** the posting stays with its score
- **AND** the application stays in its stage

#### Scenario: Backup before the clear
- **WHEN** the user confirms the clear
- **THEN** the system stores a backup of all data before it deletes any posting
- **AND** when the backup fails, the system deletes nothing and reports the failure

#### Scenario: Fetch run is active
- **WHEN** a fetch run is active and the user tries to clear the postings
- **THEN** the system deletes nothing and states that the run must end first

#### Scenario: Deleted posting comes back
- **WHEN** a fetch run after a clear returns a posting that the clear deleted
- **THEN** the system stores it as a new, unread posting and scores it again, as for any posting it has not stored before
