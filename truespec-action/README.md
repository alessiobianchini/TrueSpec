# TrueSpec GitHub Action (Early Access)

Detect OpenAPI spec drift in CI and surface breaking changes before merge.

This repository is public while the Action is in early access. The current
implementation is a placeholder until the CLI is released to early access
teams.

## What it does

- Compares your OpenAPI spec with implementation changes.
- Flags breaking changes with clear severity.
- Produces a short PR-friendly summary.

## Inputs

- `spec-path` (required): Path to the OpenAPI file, for example `openapi.yaml`.
- `fail-on` (optional): `breaking`, `warning`, or `none`. Default: `breaking`.

## Usage

```yaml
name: api-contract
on: [pull_request]

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: truespec/action@v0
        with:
          spec-path: openapi.yaml
          fail-on: breaking
```

## Outputs

- `summary`: Short string describing the run.

## Early access

Join the waitlist to get access to the real Action and CLI.

- https://truespec-app.com/#waitlist

## License

MIT
