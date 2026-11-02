# Resumen diario

A daily Spanish news digest for learners. A generator fetches news feeds, asks an LLM to write graded Spanish with English glosses, and commits JSON files to `web/public/digests/`. A static Vite web app (installable PWA, works offline for recent digests) reads them. A GitHub Actions workflow runs every morning and deploys to GitHub Pages.

## Setup

1. Create a GitHub repository and push this project to the `main` branch.
2. In **Settings > Pages**, set **Source** to **GitHub Actions**.
3. In **Settings > Secrets and variables > Actions**, add a repository secret named `LLM_API_KEY`.
4. Run the workflow once manually: **Actions > Daily digest > Run workflow**. After that it runs daily at 10:00 UTC (edit the cron in `.github/workflows/daily.yml` for a different time).
5. Open `https://<user>.github.io/<repo>/`.

Pushes to `main` rebuild and redeploy the site without generating a new digest.

### Configuration

Edit `generator/config.json` to change the learner level (`level`), Spanish variant, `provider`, `model`, feeds, and story limits. The `timezone` field controls the date used for each digest.

## Local development

```sh
npm ci
npm run dev                       # web app at http://localhost:5173
npm test                          # unit tests
npm run build                     # production build into web/dist
LLM_API_KEY=... npm run generate  # write today's digest to web/public/digests/
```

To test a GitHub Pages build locally: `BASE_PATH=/<repo>/ npm run build`.

The placeholder PWA icons in `web/public/icons/` were produced by `node web/scripts/make-icons.mjs`; replace them with real artwork any time.
