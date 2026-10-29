<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# iHateUpload

Privacy-first file tools: every tool runs in the browser tab. Nothing is uploaded.

## Starting a feature

Before writing code, do both of these and say what you chose:

1. **Pick a skill pack** and follow it. None are installed locally, so read the SKILL.md from GitHub with `gh api repos/<repo>/contents/<path>/SKILL.md --jq .content | base64 -d`:
   - **pstack** by Lauren Tan (poteto), `cursor/plugins`, path `pstack/skills/<name>`. Good for features: `figure-it-out`, `architect`, `tdd`, `principle-prove-it-works`, `show-me-your-work`, `blast-radius`, `unslop`.
   - **Matt Pocock's skills**, `mattpocock/skills`, path `skills/engineering/<name>`. Good for features: `research`, `to-spec`, `implement-spec`, `tdd`, `diagnosing-bugs`, `code-review`.
   - **Anthropic agent skills**, `anthropics/skills`, path `skills/<name>`. Use for file formats and testing: `pdf`, `docx`, `xlsx`, `pptx`, `webapp-testing`, `frontend-design`.
2. **Pick the language.** Use TypeScript unless Rust/WASM or a C/C++ library built with Emscripten would be much faster or more accurate. Name the library and the reason. It must run client-side, with no GPL/AGPL licences.

## Commands

- Dev server: `bun run dev` (port 43127)
- Tests: `bun test <file>` (bun's runner, not vitest). Add each new test file to the `test` script in `package.json`.
- Typecheck: `npx tsc --noEmit`. Lint: `npx eslint <files>`.

## Rules

- Test data must be synthetic: generate PDFs and images in code. Never use the user's personal files.
- When matching a competitor's feature (iLovePDF, ihatepdf.cv), check their real behaviour first and match their defaults unless ours is clearly better for users.
- Verify UI changes in the browser before calling them done.
