# Learnings - Lottery UI Candy Redesign

## Conventions
- Tailwind CSS utilities only (no inline styles unless necessary)
- CSS animations defined in globals.css
- Follow existing animation patterns (spin, fadeIn, scaleIn)

## Patterns
- Gradients: Use Tailwind's `bg-gradient-to-*` utilities
- Animations: Use Tailwind's `animate-*` classes + custom keyframes in globals.css
- Shadows: Use `shadow-[...]` for custom shadows

## Baseline Observations
- Dev server launches via `npm run dev` on localhost:3000 (Next.js 16.1.3/Turbopack) with no runtime errors.
- Screenshot captured at `.sisyphus/evidence/0-baseline.png` showing the lottery wheel (stone-900 dark inner ring) before any UX changes.
- API endpoints (`/api/auth/me`, `/api/lottery`, `/api/lottery/ranking`) return unauthorized, but UI still renders static wheel, disabled buttons, and placeholder records.
- Replaced dark stone-900/800 elements with candy pink-orange gradients (from-pink-200 via-orange-100 to-amber-200) to match the new lighter theme.
- Updated inner shadows to be lighter and warmer (rgba(251,146,60,0.2)) instead of heavy black.

## CSS Clip-Path Decoration
- Applied `clip-path: polygon(...)` to create a 12-petal flower border effect around the lottery wheel.
- Used `drop-shadow` instead of `box-shadow` on the clipped element to ensure the shadow follows the custom shape.
- Positioned the petal layer (`inset-0`) behind the inner ring (`inset-3`) to create a layered scallop effect where only the tips are visible.
