# cover-letters Specification

## Purpose
Writes a cover letter for one posting from the user's CV, so that the user starts an application with a draft that is specific to the job.

## Requirements

### Requirement: Cover letter generation
The system SHALL write a cover letter for a posting when the user asks for one. The system SHALL use the Claude Code command line with Fable 5.2 at medium effort, whatever provider the user selected for matching. The letter SHALL use the language of the posting and only facts from the CV and the profile. The user MAY add an instruction for one letter.

#### Scenario: User generates a letter
- **WHEN** the user asks for a cover letter for a posting and a CV exists
- **THEN** the system writes the letter from the posting, the CV, the profile, and the instruction, and shows it with the posting

#### Scenario: No CV and no profile exist
- **WHEN** the user asks for a cover letter and the system holds neither a CV text nor a profile
- **THEN** the system refuses and tells the user to import a CV

#### Scenario: Matching is paused
- **WHEN** matching is paused or the match queue holds work
- **THEN** a cover letter request still runs at once

#### Scenario: Generation fails
- **WHEN** the model call fails
- **THEN** the system reports the cause and keeps an earlier letter for that posting

### Requirement: Cover letter storage and export
The system SHALL store one cover letter for each posting. The user SHALL be able to edit, copy, regenerate, and delete the letter, and download it as a PDF file.

#### Scenario: User edits the letter
- **WHEN** the user changes the text and saves
- **THEN** the system stores the text and marks the letter as edited

#### Scenario: User regenerates the letter
- **WHEN** the user confirms a new generation
- **THEN** the new text replaces the stored text when the generation succeeds

#### Scenario: User downloads the letter
- **WHEN** the user downloads a stored letter
- **THEN** the system returns a PDF file with the letter text
