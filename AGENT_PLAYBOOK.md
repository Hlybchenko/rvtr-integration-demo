# Copilot Playbook (Short)

## Project snapshot

- Stack: React 19, TypeScript, Vite, React Router, React Query, Zustand.
- Main flow: `AppShell` + `Sidebar` (navigation + theme switch) + `OverviewPage` + `DevicePage` + `DevicePreview`.
- Key logic: device frame scaling, screen cutout detection, per-device URL resolution, iframe sandbox/loading, voice-agent file sync.

## Core skills

- Safely update routing/pages without breaking shell/navigation.
- Tune device preview geometry (`screenRect`, expand, radius, scale).
- Keep URL state consistent across settings, device page, and preview.
- Handle iframe UX (minimal centered loader, no jump/flicker) with minimal regressions.
- Maintain theme behavior via `data-theme` + localStorage persistence.
- Keep theme-toggle UX intact: rolling thumb + sun/moon morph animation.
- Add new device end-to-end via config + asset + preview validation.

## Working rules

- Chat language: Ukrainian.
- Code and technical artifacts: English.
- Default detail level: medium.
- Flow: plan first, then code changes.
- After edits run: `yarn typecheck` and `yarn lint`.
- Keep fixes focused, avoid unrelated changes.

## Quick checklist

1. Confirm impacted areas.
2. Apply minimal targeted changes.
3. Validate with typecheck + lint.
4. Provide short handoff summary.
