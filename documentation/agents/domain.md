# Domain Documentation

How the workflow skills should consume this repository's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repository root, or
- **`GLOSSARY-MAP.md`** at the repository root if it exists: it points at one `GLOSSARY.md` per context. Read each one relevant to the topic.
- **`documentation/architecture-decision-record/`**: read architecture decision records that touch the area you're about to work in. In multi-context repositories, also check `src/<context>/documentation/architecture-decision-record/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `model-domain` skill, reached through `specify` or architecture work, creates them lazily when terms or decisions actually get resolved.

Before updating project or capability documents, call the Skill tool with "document" for the shared document model. Read applicable project and capability requirements as constraints; surface conflicts rather than silently changing those obligations.

## Guidelines

**`GUIDELINES.md`** at the repository root holds the project's code conventions. Read it before reviewing code or auditing architecture.

If it doesn't exist, the review and architecture skills offer to create it through `/model-domain` unless the line below says otherwise.

Guidelines: not set up — run `/model-domain` with the code focus to create it through an interview

## File structure

Single-context repository:

```
/
├── GLOSSARY.md
├── documentation/architecture-decision-record/
│   ├── 0001-<decision-slug>.md
│   └── ...
└── (app files at the root — index.html, app.js, views.js, engine.js, ...)
```

## Use the glossary's vocabulary

When your output names a domain concept, such as a task title, refactor proposal, hypothesis, or test name, use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/model-domain`).

## Flag architecture decision conflicts

If your output contradicts an existing architecture decision record, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
