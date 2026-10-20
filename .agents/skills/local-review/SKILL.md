---
name: local-review
description: Use for an independent, read-only review of a completed project requirements document or a feature-sized code change before implementation or PR creation.
---

# Local review

Use an independent reviewer in a fresh context. When the client can select the named
`local-reviewer` agent, use it. If named-agent selection is unavailable, start a fresh
subagent using the client's model configuration and explicitly give it the
`local-reviewer` role: follow this skill's criteria, do not edit files, and review
only the supplied scope. Do not replace the independent review with a self-review
in the implementation thread.

1. For a requirements document, provide the completed document, its relevant decisions, and any context needed to assess scope. Run before implementation begins.
2. For code, provide the feature-sized diff from the immediately preceding stacked PR base, its requirement source, and the relevant callers and tests. Include uncommitted or untracked changes only when they are part of the review. Run after the feature is complete and before preparing the PR. Skip formatting-only changes; do not re-review earlier stack diffs.
3. Ask the reviewer to read this skill, inspect only relevant code paths, and report evidence-based findings without editing files.
4. Review each finding against the actual requirement and behavior. Fix only confirmed required issues; treat optional simplification suggestions as choices for the implementer.

## Review criteria

Check only what the supplied scope can establish:

- Whether documented behavior is clearly classified as required, deferred, or implementation discretion, and whether the change preserves required behavior.
- Whether shared logic is backed by actual values and call paths, rather than similar signatures or names alone.
- Whether standard APIs or existing dependencies already satisfy the requirement.
- Whether a contract change leaves obsolete conversions, lookups, validation, configuration, return data, exports, or helpers behind.
- Whether tests protect observable contracts without following private implementation details or adding exports only for tests.

Report a finding only when the evidence shows a concrete problem. Include file and line, triggering condition, requirement or behavior at risk, and impact. Label it either **Required correction** or **Optional simplification**. It is valid to return no findings. Do not object to an abstraction only because it has one caller; a useful name such as `sameContent` can clarify intent, and a one-line adapter such as a sleep wrapper can preserve a meaningful boundary. Do not treat style or speculative future use as a defect.

## Maintaining this skill

To evaluate the review behavior, read [the evaluation prompts](references/evaluation-prompts.md) and [the separate expectations](references/evaluation-expectations.md). Give the reviewer only one prompt fixture and its relevant code or document at a time. Never provide the expectations file to the reviewer.
