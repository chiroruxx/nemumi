---
name: implementation-workflow
description: Use when planning or implementing repository changes, especially when turning a project document into code or refactoring existing behavior.
---

# Implementation workflow

Use this workflow for feature work and refactoring. Follow repository `AGENTS.md` for its testing, formatting, lint, type-check, naming, and ADR requirements.

## Before implementation

1. Read the relevant project document and nearby code, tests, and existing decisions.
2. In the project document, make the scope clear by separating:
   - **Required behavior**: conditions the implementation and its acceptance checks must satisfy.
   - **Deferred candidates**: useful possibilities that are explicitly outside this change. Do not implement them unless they are promoted to required behavior.
   - **Implementation discretion**: choices that may vary as long as required behavior is preserved.
3. Treat existing settled behavior as required unless the user explicitly changes it. Do not turn implementation details into requirements without a reason.
4. For each requirement that may drive complexity, identify its observable acceptance condition. If an important choice is unresolved and changes that condition, ask before implementing the dependent behavior; continue independent work.
5. Check the runtime's standard APIs and existing dependencies before adding custom machinery or overriding their defaults. Preserve special behavior only when a required condition depends on it.
6. For refactoring, identify existing tests that protect the behavior being changed and run them before editing. Add tests before implementation only for behavior not covered by those tests, then confirm the baseline passes.

## During and after implementation

- Implement required behavior; leave deferred candidates out of scope.
- When a contract, type, dependency, or call graph changes, inspect its callers and remove machinery made unnecessary by that change, including pass-through conversions, repeated searches, redundant validation, settings, return data, exports, and helpers.
- Keep abstractions when their name or boundary expresses a useful concept; call count alone does not determine whether a helper is useful.
- Test behavior through the entry point that owns the contract. Test exported functions' behavior directly according to the repository rule, but do not export internals solely to reach them from tests.
- Before finishing, compare the diff with the required behavior and deferred candidates. Explain any added abstraction, custom default, defensive branch, or extra state in terms of a requirement. Run the repository's required checks.
