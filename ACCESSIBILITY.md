# Accessibility (WCAG 2.1 AA — pragmatic v1)

SupplierSync has been updated for substantially better ADA/WCAG 2.1 Level AA alignment across the app shell, auth flows, main workspace, account, billing, and renewals.

## What was done

### Navigation & structure
- **Skip to main content** link on signed-in app chrome (`AppChrome`) and all auth layouts; targets `#main-content`.
- **One `<h1>` per page** on Account, Billing, Renewals, and Vendor workspace (visually hidden h1 where the UI has no visible page title).
- **Auth heading order** fixed: promo panel no longer uses an `<h2>` before the page `<h1>`.
- **`<main id="main-content">`** on all primary app and auth pages.
- **Active nav** uses `aria-current="page"` on top-level tabs.

### Keyboard & focus
- **`:focus-visible` outlines** on links, buttons, inputs, tabs, and menu items (global CSS).
- **Modals** (`DocumentViewerModal`, `SetupGuide`): `role="dialog"`, `aria-modal`, labelled titles, Escape to close, focus trap with focus restore on close.
- **GlobalSearch**: combobox/listbox pattern with `aria-expanded`, `aria-activedescendant`, arrow-key navigation, Enter to select, Escape to clear; live result count announcements.
- **Vendor list**: keyboard-operable buttons with `aria-current` for selection.
- **Profile menu** trigger: `aria-label="Account menu"`.

### Forms & labels
- Auth forms (login, signup, reset password, create workspace, terms acceptance) use explicit **`htmlFor` / `id`** pairs.
- Account profile and danger-zone confirmation fields labelled.
- Quick-add vendor inputs and renewal handle-note field labelled (visually hidden where appropriate).

### Feedback & semantics
- **Errors** use `role="alert"`; success/async status uses `role="status"` + `aria-live="polite"`.
- **Icon-only / compact controls** get descriptive `aria-label` where visible text is missing (setup chip, delete buttons already labelled in shared patterns).
- **BrandLogo** retains meaningful `alt` text; decorative marketing icons use `aria-hidden`.

### Visual
- **Muted/label text** contrast bumped (`#64748b` → `#475569`) for better readability on light backgrounds.
- **`prefers-reduced-motion`**: animations and transitions minimized; hover transforms disabled.

### Utilities
- `src/lib/a11y.ts` — shared `MAIN_CONTENT_ID` and `useFocusTrap` hook.

## Remaining gaps (not in v1)

- Full **WAI-ARIA Authoring Practices** menu pattern for profile dropdown (roving tabindex, typeahead).
- **Home / marketing page** and **Outreach CRM** received lighter touch; not fully audited.
- **Complex vendor workspace tabs** (contracts, documents, spend) — many inline forms still rely on visible labels without `htmlFor`; worth a follow-up pass.
- **Color contrast** on badge/chip variants not exhaustively audited.
- **Automated CI** (axe-core, Lighthouse accessibility gate) not yet wired.
- **High-contrast / forced-colors** mode not explicitly styled.

## How to test

### Keyboard
1. Load any page and press **Tab** once — “Skip to main content” should appear and activate with Enter.
2. Tab through auth forms: every field should show a visible focus ring.
3. Open **GlobalSearch**, type a vendor name, use **↓/↑** to highlight results, **Enter** to open, **Escape** to clear.
4. Open a document preview or **Setup guide** — Tab should stay inside the dialog; **Escape** closes it and restores focus.
5. On Renewals, use **Tab** to reach filter chips and “Mark handled” actions.

### VoiceOver (macOS)
1. **Cmd+F5** to start VoiceOver.
2. On login: VO should announce field labels (“Email, edit text”) and errors when they appear.
3. On Vendors page: VO+U → **Landmarks** — confirm **navigation** and **main**.
4. GlobalSearch: after typing, listen for “N results available” status; arrow keys should update the active option.
5. Open Document viewer: VO should read the dialog title (file name) and trap focus until Close.

### Quick automated check
```bash
npm run build   # must pass
npx lighthouse http://localhost:5173/login --only-categories=accessibility --view
```
(Run dev server first with `npm run dev`.)

## Deploy (frontend only)

No backend or env changes required.

```bash
npm run build
# Deploy the dist/ folder to your static host (e.g. Vercel, Netlify, S3+CloudFront)
```

If using Vercel with the existing project, push to the connected branch or run `vercel --prod` from the repo root after `npm run build` succeeds locally.
