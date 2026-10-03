# Software Requirements Specification (SRS) — Heisenbug

## Assessment Architecture & Deferred Capabilities

### 1. Assessment Scope (Single-Problem Assessments)
- **1:1 Mapping**: Each `Assessment` in Heisenbug currently scopes to exactly **one** problem pack (`ProblemVersion`).
- **Domain Alignment**: `Invitation` has a 1:1 foreign key relationship (`sessionId String? @unique`) with `Session`. Scoping an assessment to a single problem pack ensures that candidate invitations map cleanly to single Docker workspace sessions with precise time limits, isolated grading, and unequivocal completion statuses.

### 2. Multi-Problem Assessment Batteries (Deferred)
- **Status**: Deferred to future milestones.
- **Rationale**: Multi-problem assessment batteries (where a candidate completes multiple independent engineering tickets within a single overall assessment session) require multi-session tracking per invitation or an assessment battery entity. Scoping current assessments 1:1 with problem packs guarantees zero ambiguity across database contracts, API endpoints, and real-time container grading execution.
