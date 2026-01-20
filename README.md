# TrueSpec

Keep your API specs honest.

TrueSpec detects drift between your code and your OpenAPI/Swagger documentation and reports breaking changes before they reach production.

This repository contains the landing page, waitlist, and backend API for the early access program.

## What is TrueSpec?

APIs evolve fast. Documentation often does not.

TrueSpec helps teams:
- detect mismatches between code and specs
- catch breaking changes early
- keep OpenAPI documentation aligned with reality

The long-term vision is a CI-friendly tool (CLI + GitHub Action) that runs on every pull request.

## Current features (v0)

- Static landing page (Astro)
- Brand and marketing pages
- Waitlist form
- Azure Functions backend (`/api/waitlist`)
- Deployed on Azure Static Web Apps

## Tech stack

Frontend:
- [Astro](https://astro.build/)
- TypeScript (strict)
- pnpm
- Tailwind + daisyUI

Backend:
- Azure Functions (Node.js / TypeScript)
- Azure Static Web Apps integration

Infrastructure:
- Azure Static Web Apps
- GitHub Actions CI/CD

## Project structure

```text
/
apps/
  web/                # Astro frontend
  api/                # Azure Functions (waitlist)
.github/workflows/    # CI/CD
README.md
```

## Local development

Prerequisites:
- Node.js 18+
- pnpm
- Azure SWA CLI (optional)

Frontend:
```bash
cd apps/web
pnpm install
pnpm dev
```

Frontend will be available at:
`http://localhost:4321`

Run frontend + API together (recommended):
```bash
pnpm add -g @azure/static-web-apps-cli
swa start http://localhost:4321 --api-location apps/api
```

## Waitlist API

Endpoint:
```
POST /api/waitlist
```

Form fields:
- `email` (required)

The current implementation stores emails locally for MVP purposes.
This will be replaced by persistent storage in later versions.

## Roadmap (short)

- [ ] OpenAPI diff engine (CLI)
- [ ] GitHub Action
- [ ] CI annotations for breaking changes
- [ ] Dashboard (later)
- [ ] Spec history and reports

## Philosophy

- Dev-first
- No lock-in
- CI-friendly
- Opinionated but transparent

## Security and privacy

- Emails are used only for early access communication
- No tracking, no ads
- GDPR-friendly by design

## License

TBD (likely MIT / Apache-2.0 for tooling, commercial for hosted services).

## Contact / Early access

Join the waitlist at:
https://truespec-app.com

Built for developers who are tired of broken docs.
