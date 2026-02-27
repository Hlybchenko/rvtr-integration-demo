# Accessibility Audit: RVTR Integration Demo

**Standard:** WCAG 2.1 AA | **Date:** 2026-02-27

## Summary

**Issues found:** 23 | **Critical:** 5 | **Major:** 10 | **Minor:** 8

The app has a solid foundation: semantic HTML, aria-attributes on navigation,
`prefers-reduced-motion` support, focus-visible outlines. Main gaps are color
contrast in dark mode, form validation not linked programmatically, missing
live regions, and no skip-to-content link.

## Color contrast

Measured against WCAG AA requirements (4.5:1 normal text, 3:1 large text/UI).

### Dark theme (default)

| Token pair                          | Ratio  | AA normal | AA large |
| ----------------------------------- | ------ | --------- | -------- |
| `--text` (#e8eaf0) on `--bg`       | 16.0:1 | PASS      | PASS     |
| `--text-secondary` on `--bg`       | 7.5:1  | PASS      | PASS     |
| `--muted` (#5a6072) on `--bg`      | 3.1:1  | FAIL      | PASS     |
| `--accent` (#6c5ce7) on `--bg`     | 4.0:1  | FAIL      | PASS     |
| `--text-secondary` on panel (~#14) | 6.8:1  | PASS      | PASS     |
| `--muted` on panel                 | 2.8:1  | FAIL      | FAIL     |

### Light theme

| Token pair                          | Ratio  | AA normal | AA large |
| ----------------------------------- | ------ | --------- | -------- |
| `--text` (#141b2d) on `--bg`       | 16.0:1 | PASS      | PASS     |
| `--text-secondary` on `--bg`       | 6.5:1  | PASS      | PASS     |
| `--muted` (#7d879d) on `--bg`      | 3.4:1  | FAIL      | PASS     |
| `--success` (#059669) on `--bg`    | 3.5:1  | FAIL      | PASS     |
| `--danger` (#e11d48) on `--bg`     | 4.4:1  | FAIL      | PASS     |
| `--muted` on white panel           | 3.6:1  | FAIL      | PASS     |

### Required token changes

```css
/* Dark theme */
--muted: #7a8194;       /* 5.0:1 on #0b0e17 (was #5a6072 = 3.1:1) */
--accent: #8b7ff0;      /* 5.5:1 on #0b0e17 (was #6c5ce7 = 4.0:1) */

/* Light theme */
--muted: #5c6680;       /* 5.0:1 on #f5f7fb (was #7d879d = 3.4:1) */
--success: #047857;     /* 4.8:1 on #f5f7fb (was #059669 = 3.5:1) */
--danger: #be123c;      /* 5.6:1 on #f5f7fb (was #e11d48 = 4.4:1) */
```

## Findings by WCAG principle

### Perceivable

| #  | Issue                                    | Criterion    | Severity | Recommendation                                                        |
| -- | ---------------------------------------- | ------------ | -------- | --------------------------------------------------------------------- |
| P1 | `--muted` fails AA in both themes        | 1.4.3        | Critical | Update token values (see above)                                       |
| P2 | `--accent` fails AA in dark theme        | 1.4.3        | Critical | Lighten to ~#8b7ff0                                                   |
| P3 | `--success`, `--danger` fail AA in light | 1.4.3        | Critical | Darken to #047857, #be123c                                            |
| P4 | Disabled buttons use `opacity: 0.5`      | 1.4.3        | Major    | Use `opacity: 0.6` min or distinct muted color                        |
| P5 | Placeholder text inherits low contrast   | 1.4.3        | Major    | Use `--text-secondary` without additional opacity                     |
| P6 | Emoji icons in sidebar have no alt       | 1.1.1        | Minor    | Add `aria-hidden="true"` on emoji span, text label already present    |
| P7 | Empty state uses emoji as indicator      | 1.1.1        | Minor    | Wrap emoji in `aria-hidden`, rely on adjacent text                    |
| P8 | Loading spinner lacks label              | 1.1.1        | Minor    | Add `aria-label="Loading"` or `role="status"` with visually-hidden text |

### Operable

| #  | Issue                                        | Criterion | Severity | Recommendation                                                    |
| -- | -------------------------------------------- | --------- | -------- | ----------------------------------------------------------------- |
| O1 | No skip-to-main-content link                 | 2.4.1     | Critical | Add hidden link as first child of `<body>`, visible on focus      |
| O2 | Document title not updated on route change   | 2.4.2     | Major    | Use `useEffect` + `document.title` in each page or layout        |
| O3 | No `aria-current="page"` on active nav link  | 2.4.3     | Major    | React Router NavLink supports `aria-current` via `className` cb   |
| O4 | Mobile sidebar not dismissible via Escape    | 2.1.1     | Major    | Add `onKeyDown` handler for Escape on sidebar overlay             |
| O5 | No breadcrumb on DevicePage                  | 2.4.8     | Minor    | Add `<nav aria-label="Breadcrumb">` on device pages               |

### Understandable

| #  | Issue                                                | Criterion | Severity | Recommendation                                                       |
| -- | ---------------------------------------------------- | --------- | -------- | -------------------------------------------------------------------- |
| U1 | Validation messages not linked to inputs             | 3.3.1     | Critical | Add `aria-describedby={errorId}` on input, `id={errorId}` on message |
| U2 | No `aria-invalid="true"` on error inputs             | 3.3.1     | Major    | Set `aria-invalid={!!error}` on each input                           |
| U3 | Radio options in radiogroup lack individual labels   | 3.3.2     | Major    | Add `aria-label` or wrap in `<label>` per radio option               |
| U4 | Status changes not announced (save, process status)  | 3.3.1     | Major    | Use `aria-live="polite"` region for status messages                  |
| U5 | No `aria-required` on required fields                | 3.3.2     | Minor    | Add where applicable                                                 |

### Robust

| #  | Issue                                     | Criterion | Severity | Recommendation                                          |
| -- | ----------------------------------------- | --------- | -------- | ------------------------------------------------------- |
| R1 | TopBar uses `<div>` instead of `<header>` | 4.1.1     | Minor    | Change root element to `<header>`                       |
| R2 | ErrorFallback lacks `role="alert"`        | 4.1.3     | Major    | Add `role="alert"` on error card container              |
| R3 | No `aria-busy` during async operations    | 4.1.3     | Minor    | Add `aria-busy={isLoading}` on form sections            |
| R4 | iframe loading state not announced        | 4.1.3     | Minor    | Add `aria-label` describing load state on wrapper       |
| R5 | Sidebar nav has redundant `role="navigation"` | 4.1.1 | Minor    | Remove `role`, `<nav>` already implies it               |

## Keyboard navigation

Focus order is logical: sidebar nav links, then main content inputs/buttons.
`focus-visible` outline defined globally (`2px solid var(--accent)`). All
interactive elements reachable via Tab.

**Gaps:**

- No skip-to-content (O1)
- Escape doesn't close mobile sidebar (O4)
- Theme toggle is a custom button -- works via Enter/Space (OK)

## Action plan

### Phase 1 -- Critical (blocks WCAG AA)

1. **Fix contrast tokens** in `tokens.css` (P1, P2, P3)
2. **Add skip-to-main-content** link in `AppShell.tsx` (O1)
3. **Link validation to inputs** via `aria-describedby` + `aria-invalid` in `OverviewPage.tsx` (U1, U2)

### Phase 2 -- Major (significant UX impact)

4. **Update document.title** on route change -- `useEffect` in `AppShell` or each page (O2)
5. **Add `aria-current="page"`** to active NavLink in `Sidebar.tsx` (O3)
6. **Close sidebar on Escape** -- keydown handler in `AppShell.tsx` (O4)
7. **Add `aria-live="polite"`** region for status messages in `OverviewPage.tsx` (U4)
8. **Label radio options** inside voice agent radiogroup (U3)
9. **Add `role="alert"`** on ErrorFallback (R2)
10. **Fix disabled button contrast** -- min opacity or dedicated color (P4, P5)

### Phase 3 -- Minor (polish)

11. Semantic `<header>` in TopBar (R1)
12. `aria-hidden` on decorative emoji (P6, P7)
13. `aria-busy` on async sections (R3)
14. Loading spinner label (P8)
15. Breadcrumb on DevicePage (O5)
16. Remove redundant `role="navigation"` (R5)
17. `aria-required` on required fields (U5)

## Estimated effort

| Phase    | Issues | Effort     |
| -------- | ------ | ---------- |
| Phase 1  | 5      | 2-3 hours  |
| Phase 2  | 6      | 3-4 hours  |
| Phase 3  | 7      | 2-3 hours  |
| **Total** | **23** | **7-10 hours** |
