# Spec Delta

## Purpose

Tells the user about new high-scoring postings through push notifications, so that the user does not need to open the application to learn about a good match.

## ADDED Requirements

### Requirement: Notification channel
The system SHALL send notifications through an ntfy topic. The system SHALL generate the topic name at random with enough length that a third party cannot guess it. The system SHALL show the topic name and a subscribe link to the user.

#### Scenario: User enables notifications for the first time
- **WHEN** the user enables notifications and no topic exists
- **THEN** the system generates a topic name and shows it with a subscribe link

#### Scenario: Generated names differ
- **WHEN** two installations each generate a topic name
- **THEN** the two names are different and neither contains a fixed guessable part alone

### Requirement: Topic regeneration
The system SHALL let the user replace the topic with a newly generated one. After the replacement the system SHALL send nothing to the old topic.

#### Scenario: User regenerates the topic
- **WHEN** the user regenerates the topic
- **THEN** the system shows the new topic name
- **AND** later notifications go only to the new topic

### Requirement: Notification server setting
The system SHALL use the public ntfy server by default and SHALL let the user set another ntfy server address.

#### Scenario: User sets a self-hosted server
- **WHEN** the user saves another server address
- **THEN** the system sends later notifications to that server

### Requirement: High score notification
When notifications are enabled, the system SHALL notify the user about a posting that receives its first score at or above the notification threshold. The user SHALL set the threshold. The system SHALL notify at most once for each posting.

#### Scenario: New posting scores above the threshold
- **WHEN** a new posting receives a first score of 85 and the threshold is 80
- **THEN** the system sends one notification for that posting

#### Scenario: Posting scores below the threshold
- **WHEN** a new posting receives a first score below the threshold
- **THEN** the system sends no notification

#### Scenario: Rescore raises a score
- **WHEN** a rescore moves an already scored posting above the threshold
- **THEN** the system sends no notification

#### Scenario: Notifications are disabled
- **WHEN** notifications are disabled and a posting scores above the threshold
- **THEN** the system sends no notification

### Requirement: Notification batching
The system SHALL combine postings that qualify within a short window into one notification. A combined notification SHALL state the number of postings and list the highest-scored ones.

#### Scenario: Several postings qualify together
- **WHEN** six postings qualify within the batching window
- **THEN** the system sends one notification that states six new matches

### Requirement: Notification content
A notification SHALL contain only the posting title, the company, the total score, and a link that opens the posting in the application. A notification SHALL NOT contain text from the CV, the profile, the preferences, or the assessment.

#### Scenario: Notification for one posting
- **WHEN** the system notifies about one posting
- **THEN** the notification shows the title, the company, and the score
- **AND** the notification link opens that posting in the application

#### Scenario: Personal data stays out
- **WHEN** the system builds any notification
- **THEN** the notification contains no CV text, no profile data, and no assessment text

### Requirement: Test notification
The system SHALL let the user send a test notification and SHALL report whether the ntfy server accepted it.

#### Scenario: Test succeeds
- **WHEN** the user requests a test notification and the server accepts it
- **THEN** the system reports success

#### Scenario: Server is unreachable
- **WHEN** the user requests a test notification and the server does not respond
- **THEN** the system reports the failure with its cause

### Requirement: Delivery failure handling
A failed notification SHALL NOT stop or delay matching. The system SHALL retry a failed delivery a bounded number of times and SHALL record a final failure in the activity view.

#### Scenario: Server fails during matching
- **WHEN** the ntfy server returns an error for a notification
- **THEN** matching continues
- **AND** the system retries the delivery later
