# Papertrail hand-drawn sketch canvas

A dependency-free browser implementation of an Excalidraw-like hand-drawn feature.

## Run

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

## Rendering model

- **Freehand ink:** records Pointer Events, smooths the centerline, derives pressure from a stylus when present or from pointer velocity, expands each sample along its normal, and paints the result as a closed quadratic path.
- **Geometric tools:** rectangles, ellipses, and arrows are drawn in two seeded passes. The random seed is stored with the element, so the rough appearance remains stable across redraws.
- **Retained scene:** strokes and shapes are stored as semantic elements and rerendered after resize, undo, redo, or export.

This is an independently written approximation of the behavior, not a copy of Excalidraw source code.
