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

## Task 3: Pointer Animation
- Implemented `@keyframes pointerWobble` that wobbles between -3deg and 3deg while maintaining `translateX(-50%)` to keep the pointer centered.
- Applied the animation conditionally: `animate-pointer-wobble` when idle, and `-translate-x-1/2` when spinning (static position).
- Added a hover glow effect using `hover:drop-shadow-[0_0_15px_rgba(251,146,60,0.7)]` with a smooth transition.

## Task 4: Confetti Enhancement
- Increased `particleCount` from 7 to 12 in `canvas-confetti` calls to create a denser, more festive celebration.
- Added `shapes: ['star', 'circle']` to introduce variety beyond the default squares.
- Updated the color palette to match the candy theme (`#fbbf24`, `#f97316`, `#ec4899`, `#a78bfa`, `#34d399`, `#60a5fa`), replacing the standard primary colors.

## Task 5: Candy Modal
- Styled the modal with a `bg-gradient-to-br from-pink-50 via-orange-50 to-amber-50` to match the warm, sweet theme.
- Increased border radius to `rounded-[2.5rem]` for a softer, friendlier appearance.
- Applied a custom colored shadow `shadow-[0_20px_60px_rgba(251,146,60,0.3)]` (orange tint) to create a warm glow effect, replacing the standard black shadow.
- Added `border-4 border-white/80` to frame the modal content cleanly.
- Updated decoration orbs to pink/amber colors (`bg-pink-200`, `bg-amber-200`) and increased their size (`w-40`) to enhance the background depth without being distracting.
