# Contributing

## Commands

    npm run dev            development server
    npm run check          types, lint, format, unit tests, build
    npm run test:watch     unit tests in watch mode
    npm run test:e2e       build and browser tests (Playwright, Chromium)
    npm run build          dist/ for publishing
    npm run preview        preview dist/ at http://localhost:4173

First run of the browser tests: `npx playwright install chromium`.

## Library contract

Lands in M3. Until then it is described in the design doc, section 5.

## Publishing

`.github/workflows/pages.yml` builds and publishes `dist/` to GitHub Pages on
every push to `main`. One-time setup: Settings > Pages > Source: GitHub Actions.
