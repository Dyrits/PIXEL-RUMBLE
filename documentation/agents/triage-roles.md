# Triage Roles

The skills speak in two category roles and four state roles. This file maps each role to the string this repository's tracker actually uses.

## Where a role is written

- **Remote tracker**: as a label on the task (or merge request / pull request).
- **Local markdown tracker**: as the `Category:` and `Status:` lines near the top of the task body under `documentation/capabilities/<capability>/tasks/`.

Unresolved proposals in `documentation/capabilities/<capability>/draft.md` hold no triage role. Roles start when a task enters intake, locally or on the remote tracker. A local title/link reference to a published remote task does not duplicate its remote role state.

## Category roles

| Canonical role | String in our tracker | Meaning                    |
| -------------- | --------------------- | -------------------------- |
| `bug`          | `bug`                 | Something is broken        |
| `enhancement`  | `enhancement`         | New feature or improvement |

## State roles

| Canonical role | String in our tracker | Meaning                                                                                       |
| -------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| `to-evaluate`  | `to-evaluate`         | Maintainer needs to evaluate this task                                                          |
| `on-hold`      | `on-hold`             | Paused on something named in the triage notes: a reply, an external dependency, another task    |
| `ready`        | `ready`               | Fully specified, with a brief attached, safe to pick up                                         |
| `not-planned`  | `not-planned`         | Closed without action, reason recorded                                                          |

When a skill names a role ("apply the ready triage role"), use the corresponding string from these tables.

Edit the right-hand columns to match the vocabulary you actually use. The role set itself stays fixed because `taskify` and `specify` consume `ready`. These four states cover intake only, whether a task is actionable. Execution progress belongs to the tracker's own progress field, the local task body, a branch, or a pull request.
