# Evidence: how Excalidraw gets its hand-drawn feel

Observed and source-backed findings gathered on 2026-10-18:

1. A controlled Chromium replay of `https://excalidraw.com/` loaded the production module `/assets/index-j68--5dB.js` and identified the deployed page version as `2026-10-12T12:34:16Z-43a92e6`. REA Evidence: `ev_dcf9a682d2a46785b390734bf8e240e82e485ad4e5d5fc498f108c93769f4d9f`.
2. The official package declares `roughjs` and `perfect-freehand` as runtime dependencies.
3. The official shape generator creates rectangles, ellipses, lines, and arrows with a `RoughGenerator`. Its options include a stable element seed, roughness, stroke width, multi-stroke behavior, and hachure fill settings.
4. Free-draw is a separate pipeline. Excalidraw sends points and either real or simulated pressure to `perfect-freehand`, using an outline size proportional to stroke width, thinning, smoothing, streamlining, and an ease-out-sine pressure curve.
5. The resulting outline is converted into a closed SVG path using midpoint quadratic curves. SVG export renders this as a filled path, while rough geometry is rendered through RoughJS.

Primary sources:

- https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/package.json
- https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/shape.ts
- https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/renderer/staticSvgScene.ts
- https://github.com/excalidraw/excalidraw/issues/3500

## What this project implements

Papertrail mirrors the architecture rather than cloning implementation details:

- a velocity/pressure-aware filled outline for the pen;
- a smoothed centerline and quadratic boundary;
- stable seeded jitter for rough shapes;
- retained semantic elements, undo/redo, erasing, responsive high-DPI redraw, and PNG export.
