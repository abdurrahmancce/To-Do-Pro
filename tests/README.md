# Tests

End-to-end tests for To-Do Pro. They open the real app in headless Chromium, with an in-memory stand-in for Firebase (`fakecloud.js`), and check tasks, Trash, autosave, checklist, reminders, import/export, XSS safety, layout, error reporting, analytics and the service worker.

## Run

```bash
cd tests
npm install
npx playwright install chromium
npm test
```

Needs Node 18+. Screenshots and temporary files go to `tests/output/` (ignored by Git).
If Chromium is already installed elsewhere, set `CHROMIUM_PATH` to its executable.

## What is not covered

Real Firebase, Google sign-in, push delivery and the live Firestore rules cannot run here. After each deploy, check by hand: sign in, add a task with an alarm, confirm a document appears in the `reminders` collection, sign out and sign back in.

## Adding a test

Add a `await T('name', async () => ...)` block in `e2e.js`. Return `true` to pass; return a short string describing the problem to fail.
