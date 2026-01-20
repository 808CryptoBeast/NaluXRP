# Contributing to NaluXRP

Thanks for your interest in contributing! This document outlines a lightweight process to help you propose changes, add resources, or submit bug reports.

How to contribute
- Fork the repository and create a topic branch with a descriptive name (e.g. `feat/about-resources`).
- Make small, focused commits with clear messages.
- Open a pull request describing the change and include screenshots or a short demo when relevant.

Guidelines
- Keep user-facing copy clear and neutral. Avoid identity claims — use "addresses" or "wallets" rather than personal identifiers.
- When adding resources to `docs/resources.json`, include:
  - id (short, unique)
  - title
  - url
  - type (vendor, government, academic, protocol, training)
  - tags (array of short tags)
  - description
- For sample snapshots in `examples/`, ensure they are synthetic or redacted to avoid exposing real user data.

Reporting issues & requesting resources
- Use the Resource Request issue template at `.github/ISSUE_TEMPLATE/resource_request.md` for additions to the curated resources list.

Developer notes
- The About page (`js/about.js`) loads `docs/resources.json` and `examples/demo_snapshot.json` to populate the Resources UI.
- If you add new resource tags, the UI will pick them up automatically.

License & conduct
- Follow the repository license and maintain respectful communication in PRs and issues.