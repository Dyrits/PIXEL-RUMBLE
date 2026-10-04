# Pixel Rumble agent instructions

Zero-dependency static web app. See `README.md` for the feature set, the Elo
model, and the roster/cover pipelines. Verify engine changes with
`node engine.test.js`; run the app with `python3 -m http.server` from the root.

## Agent skills

### Task tracker

Local Markdown tracker: task bodies under `documentation/capabilities/<capability>/tasks/`, backlog in `documentation/backlog.md`. Repository specifications are authoritative and remote publication is explicit. See `documentation/agents/issue-tracker.md`.

### Triage roles

Default role vocabulary: categories `bug`/`enhancement`, states `to-evaluate`/`on-hold`/`ready`/`not-planned`. See `documentation/agents/triage-roles.md`.

### Domain documentation

Single-context: root `GLOSSARY.md` and `documentation/architecture-decision-record/`, created lazily by `model-domain`. See `documentation/agents/domain.md`.

### Project documents

Call the Skill tool with "document" before creating or updating project documents, to apply the shared authority, requirements, publication, resumption, and changelog rules.

### Reusable knowledge

Before writing a script or multi-step pipeline, read `.agents/scripts/INDEX.md` when it exists and reuse or extend a match. Call the Skill tool with "memorize" the moment something is rebuilt a second time or the user corrects a behavior.
