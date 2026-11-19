# Spec Delta

## Purpose

Lets sieve run behind a gateway that serves it under a path prefix and signs users in, so the user can open it from any device without exposing it to other users of that gateway.

## ADDED Requirements

### Requirement: Path prefix
The system SHALL serve the interface, the API, the event stream and every download under the path prefix it was built for. Without a configured prefix the prefix is `/`.

#### Scenario: Built for a prefix
- **WHEN** the system was built for the prefix `/sieve/` and the interface requests the status
- **THEN** the request goes to `/sieve/api/status`

#### Scenario: Download link under a prefix
- **WHEN** the system was built for the prefix `/sieve/` and shows a link to a backup or a cover letter PDF
- **THEN** the link starts with `/sieve/api/`

#### Scenario: No prefix
- **WHEN** the system was built without a prefix and the interface requests the status
- **THEN** the request goes to `/api/status`

### Requirement: Health check
The system SHALL answer `GET /healthz` with status 200 without a login and without a gateway user.

#### Scenario: Platform probes health
- **WHEN** a request to `/healthz` arrives without a session and without a gateway user header
- **THEN** the system answers with status 200

### Requirement: Public icon
The system SHALL serve its icon at `GET /icon.png` without a login and without a gateway user.

#### Scenario: Device fetches the icon
- **WHEN** a request to `/icon.png` arrives without a session and without a gateway user header
- **THEN** the system answers with a PNG image

### Requirement: Allowed gateway user
When an allowed gateway user is configured, the system SHALL refuse every request whose gateway user header does not name that user, except the health check and the icon.

#### Scenario: Allowed user
- **WHEN** an allowed gateway user is configured and a request arrives with a gateway user header that names that user
- **THEN** the system handles the request as usual

#### Scenario: Other user
- **WHEN** an allowed gateway user is configured and a request arrives with a gateway user header that names another user
- **THEN** the system answers with status 403 and shows no data

#### Scenario: Header missing
- **WHEN** an allowed gateway user is configured and a request arrives without a gateway user header
- **THEN** the system answers with status 403 and shows no data

#### Scenario: Not configured
- **WHEN** no allowed gateway user is configured and a request arrives without a gateway user header
- **THEN** the system handles the request as before this change
