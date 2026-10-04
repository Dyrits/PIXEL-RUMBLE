# Issue tracker: Local Markdown

Backlog: `documentation/backlog.md`

The local backlog owns candidate outcomes, priorities, and deferrals. Working state remains in `documentation/work-in-progress.md` for active execution and resumption. Apply the shared document rules supplied by the `document` skill.

Local task bodies live in `documentation/capabilities/<capability>/tasks/`. The living specification is `documentation/capabilities/<capability>/specifications.md`. Call the Skill tool with "document" for the shared authority, requirements, publication, and changelog rules.

## Conventions

- One capability per directory: `documentation/capabilities/<capability>/`
- The specification is `documentation/capabilities/<capability>/specifications.md`
- Implementation tasks are one file per task at `documentation/capabilities/<capability>/tasks/NN-<slug>.md`
- Triage roles are two lines near the top of each intake task body: `Category:` for the category role and `Status:` for the state role (see `triage-roles.md` for the strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading
- Record blockers, execution status, and acceptance evidence where useful, separately from intake roles
- Unresolved proposals belong in `draft.md`, without triage roles

## Ticket writing convention

- **Source:** Built-in `taskify`
- **Applies to:** Local task bodies
- **Rules:** Use the built-in task template unless the user selects another configured convention for the run.

## When a skill says "publish to the issue tracker"

Write or update the selected task body under `documentation/capabilities/<capability>/tasks/` within the user's scope. No remote publication occurs. Apply an intake role when the task enters triage; unresolved proposals have no triage role.

## When a skill says "fetch the relevant task"

Read the referenced task body.

## Wayfinding operations

Used by `/graphify`. The map is a file with one child file per decision task, not an implementation plan.

- **Map**: `documentation/capabilities/<capability>/map.md` (the Notes / Decisions-so-far / Fog body). Reference it from `documentation/backlog.md` when it represents a candidate effort.
- **Child task**: `documentation/capabilities/<capability>/tasks/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the task type (`research`/`prototype`/`refine`/`task`); a `Progress:` line records `claimed`/`resolved`. `Progress:` is graphify's own line, kept separate from the `Status:` triage role.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A task is unblocked when every file it lists is `Progress: resolved`.
- **Frontier**: scan `documentation/capabilities/<capability>/tasks/` for files that are unresolved, unblocked, and carry no `Progress: claimed`; first by number wins.
- **Claim**: set `Progress: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Progress: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

## Project documents and publication

Call the Skill tool with "document" before reading or updating project documents. It owns the document roles under `documentation/`, the terms authorized, obligation, lazy, and pointer, backlog authority for this tracker, and the root `CHANGELOG.md` format.

Reading remote records through the configured access method is always allowed. Creating or updating remote records needs authorization.
