Implement the design-to-implementation pipeline defined in `docs/superpowers/specs/2026-03-20-design-pipeline-design.md`. Read that spec fully before starting.

**Summary:** Build 7 new `/design-*` Claude Code skills that create a structured workflow for extracting design languages from reference websites, generating mockups, implementing across web (HTML/CSS/Next.js) and SwiftUI, refining with Impeccable commands, and verifying with screenshot diffing. The skills integrate Dembrandt CLI for site analysis, Design Token Bridge MCP for cross-platform token translation, Impeccable skills for design refinement, and the existing Playwright/mobai/design-comparison tools for verification.

**Deliverables:**

1. Seven skill files in `skills/`: `design-analyze`, `design-language`, `design-evolve`, `design-mockup`, `design-implement`, `design-refine`, `design-verify` — each with a SKILL.md following existing skill conventions in this repo
2. A shared preamble at `skills/_design-preamble.md` for design context loading
3. Updates to `skills/bootstrap/SKILL.md` — preamble skill table (21 skills), DESIGN_SYSTEM template, CLAUDE.md template, Step 7 workflow, skill count
4. Updates to `setup.sh` — symlink 7 new skills, clone/install Impeccable skills from `pbakaus/impeccable`, install Dembrandt globally via npm
5. Updates to `CLAUDE.md` — add design skills to tables, architecture tree, and skill pipeline

**Key constraints:**
- Follow existing skill conventions: frontmatter with `name`, `description`, `argument-hint`, `allowed-tools`
- Reference the preamble from `skills/_preamble.md` for the agentic-workflow skill table
- All design context flows through `.impeccable.md` (brand/aesthetic) and `design-tokens.json` (W3C DTCG tokens), both referencing `planning/DESIGN_SYSTEM.md`
- `/design-refine` dispatches Impeccable skills via the `Skill` tool
- `/design-mockup` uses scoped `allowed-tools`: `Bash(*/start-server.sh *)`, `Write`, `Read`
- `/design-verify` detects web vs iOS via file heuristics (Package.swift/xcodeproj → iOS, package.json → web)
- `/design-implement` interactively selects from approved mockups when multiple exist
- Generated token files (`tokens.css`, `tailwind.preset.js`, `Theme.swift`) go at project root
