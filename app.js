(() => {
  "use strict";

  const canvas = document.querySelector("#canvas");
  const wrap = document.querySelector("#canvas-wrap");
  const ctx = canvas.getContext("2d");
  const emptyState = document.querySelector("#empty-state");
  const statusChip = document.querySelector("#status-chip");
  const widthInput = document.querySelector("#width");
  const roughnessInput = document.querySelector("#roughness");
  const pressureInput = document.querySelector("#pressure");
  const colorInput = document.querySelector("#color");
  const undoButton = document.querySelector("#undo");
  const redoButton = document.querySelector("#redo");

  const state = {
    tool: "pen",
    color: "#1d1d1f",
    width: 4,
    roughness: 1.2,
    dynamicPressure: true,
    drawing: null,
    elements: [],
    redo: [],
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  function mulberry32(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      pressure: event.pointerType === "pen" && event.pressure > 0 ? event.pressure : null,
      time: performance.now(),
    };
  }

  function smoothInput(points, streamline = 0.48) {
    if (points.length < 2) return points.map((point) => ({ ...point }));
    const smoothed = [{ ...points[0] }];
    const follow = 0.2 + (1 - streamline) * 0.45;
    for (let index = 1; index < points.length; index += 1) {
      const previous = smoothed[smoothed.length - 1];
      const input = points[index];
      smoothed.push({
        ...input,
        x: lerp(previous.x, input.x, follow),
        y: lerp(previous.y, input.y, follow),
      });
    }
    const last = points[points.length - 1];
    smoothed[smoothed.length - 1] = { ...last };
    return smoothed;
  }

  function pressureForPoint(points, index, dynamicPressure) {
    if (!dynamicPressure) return 0.62;
    const point = points[index];
    if (point.pressure !== null) return clamp(point.pressure, 0.08, 1);
    if (index === 0) return 0.35;
    const previous = points[index - 1];
    const elapsed = Math.max(1, point.time - previous.time);
    const velocity = distance(previous, point) / elapsed;
    const target = clamp(0.88 - velocity * 0.72, 0.18, 0.9);
    const prior = previous.computedPressure ?? 0.35;
    return lerp(prior, target, 0.32);
  }

  function buildStrokeOutline(rawPoints, options) {
    if (!rawPoints.length) return [];
    const points = smoothInput(rawPoints);
    points.forEach((point, index) => {
      point.computedPressure = pressureForPoint(points, index, options.dynamicPressure);
    });

    if (points.length === 1) {
      const radius = options.width * (0.45 + points[0].computedPressure * 0.7);
      return Array.from({ length: 16 }, (_, index) => {
        const angle = (index / 16) * Math.PI * 2;
        return { x: points[0].x + Math.cos(angle) * radius, y: points[0].y + Math.sin(angle) * radius };
      });
    }

    const left = [];
    const right = [];
    points.forEach((point, index) => {
      const before = points[Math.max(0, index - 1)];
      const after = points[Math.min(points.length - 1, index + 1)];
      const angle = Math.atan2(after.y - before.y, after.x - before.x) + Math.PI / 2;
      const eased = Math.sin((point.computedPressure * Math.PI) / 2);
      const taperStart = clamp(index / 3, 0.55, 1);
      const taperEnd = clamp((points.length - 1 - index) / 4, 0.3, 1);
      const radius = options.width * (0.36 + eased * 0.78) * Math.min(taperStart, taperEnd);
      const nx = Math.cos(angle) * radius;
      const ny = Math.sin(angle) * radius;
      left.push({ x: point.x + nx, y: point.y + ny });
      right.push({ x: point.x - nx, y: point.y - ny });
    });
    return [...left, ...right.reverse()];
  }

  function drawSmoothClosedPath(context, outline, color) {
    if (!outline.length) return;
    if (outline.length < 3) {
      context.fillStyle = color;
      context.beginPath();
      context.arc(outline[0].x, outline[0].y, 2, 0, Math.PI * 2);
      context.fill();
      return;
    }
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(outline[0].x, outline[0].y);
    for (let index = 0; index < outline.length; index += 1) {
      const point = outline[index];
      const next = outline[(index + 1) % outline.length];
      context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
    }
    context.closePath();
    context.fill();
  }

  function jitter(random, roughness, scale = 1) {
    return (random() - 0.5) * roughness * scale;
  }

  function roughLine(context, start, end, options, random, passes = 2) {
    const length = distance(start, end);
    const bow = Math.min(12, length * 0.045) * options.roughness;
    const normalX = -(end.y - start.y) / Math.max(length, 1);
    const normalY = (end.x - start.x) / Math.max(length, 1);
    context.strokeStyle = options.color;
    context.lineWidth = Math.max(0.7, options.width / Math.sqrt(passes));
    context.lineCap = "round";
    context.lineJoin = "round";
    for (let pass = 0; pass < passes; pass += 1) {
      const offset = jitter(random, options.roughness, 1.6);
      const control = {
        x: (start.x + end.x) / 2 + normalX * (bow * (random() - 0.35)) + jitter(random, options.roughness, 2),
        y: (start.y + end.y) / 2 + normalY * (bow * (random() - 0.35)) + jitter(random, options.roughness, 2),
      };
      context.beginPath();
      context.moveTo(start.x + normalX * offset, start.y + normalY * offset);
      context.quadraticCurveTo(control.x, control.y, end.x + normalX * offset, end.y + normalY * offset);
      context.stroke();
    }
  }

  function drawRoughRectangle(context, element) {
    const random = mulberry32(element.seed);
    const left = Math.min(element.start.x, element.end.x);
    const top = Math.min(element.start.y, element.end.y);
    const right = Math.max(element.start.x, element.end.x);
    const bottom = Math.max(element.start.y, element.end.y);
    const corners = [
      { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
    ];
    corners.forEach((point, index) => roughLine(context, point, corners[(index + 1) % 4], element, random));
  }

  function drawRoughEllipse(context, element) {
    const random = mulberry32(element.seed);
    const cx = (element.start.x + element.end.x) / 2;
    const cy = (element.start.y + element.end.y) / 2;
    const rx = Math.abs(element.end.x - element.start.x) / 2;
    const ry = Math.abs(element.end.y - element.start.y) / 2;
    context.strokeStyle = element.color;
    context.lineWidth = element.width / Math.sqrt(2);
    for (let pass = 0; pass < 2; pass += 1) {
      context.beginPath();
      const count = 40;
      for (let index = 0; index <= count; index += 1) {
        const angle = (index / count) * Math.PI * 2;
        const wobble = 1 + jitter(random, element.roughness, 0.022);
        const x = cx + Math.cos(angle) * rx * wobble + jitter(random, element.roughness, 0.45);
        const y = cy + Math.sin(angle) * ry * wobble + jitter(random, element.roughness, 0.45);
        index === 0 ? context.moveTo(x, y) : context.lineTo(x, y);
      }
      context.closePath();
      context.stroke();
    }
  }

  function drawRoughArrow(context, element) {
    const random = mulberry32(element.seed);
    roughLine(context, element.start, element.end, element, random);
    const angle = Math.atan2(element.end.y - element.start.y, element.end.x - element.start.x);
    const size = clamp(distance(element.start, element.end) * 0.15, 12, 28) + element.width;
    const spread = Math.PI / 6;
    const a = { x: element.end.x - Math.cos(angle - spread) * size, y: element.end.y - Math.sin(angle - spread) * size };
    const b = { x: element.end.x - Math.cos(angle + spread) * size, y: element.end.y - Math.sin(angle + spread) * size };
    roughLine(context, a, element.end, element, random, 1);
    roughLine(context, b, element.end, element, random, 1);
  }

  function drawElement(context, element) {
    context.save();
    if (element.type === "pen") {
      drawSmoothClosedPath(context, buildStrokeOutline(element.points, element), element.color);
    } else if (element.type === "rectangle") {
      drawRoughRectangle(context, element);
    } else if (element.type === "ellipse") {
      drawRoughEllipse(context, element);
    } else if (element.type === "arrow") {
      drawRoughArrow(context, element);
    }
    context.restore();
  }

  function render() {
    const rect = canvas.getBoundingClientRect();
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    state.elements.forEach((element) => drawElement(ctx, element));
    if (state.drawing) drawElement(ctx, state.drawing);
    emptyState.classList.toggle("hidden", state.elements.length > 0 || Boolean(state.drawing));
    undoButton.disabled = state.elements.length === 0;
    redoButton.disabled = state.redo.length === 0;
  }

  function resizeCanvas() {
    const rect = wrap.getBoundingClientRect();
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * state.dpr);
    canvas.height = Math.round(rect.height * state.dpr);
    render();
  }

  function selectTool(tool) {
    state.tool = tool;
    wrap.dataset.tool = tool;
    document.querySelectorAll("[data-tool]").forEach((button) => {
      button.classList.toggle("active", button.dataset.tool === tool);
    });
    const labels = { pen: "Pen", rectangle: "Rectangle", ellipse: "Ellipse", arrow: "Arrow", eraser: "Eraser" };
    statusChip.textContent = `${labels[tool]}${tool === "pen" ? state.dynamicPressure ? " · pressure simulated" : " · constant width" : ` · roughness ${state.roughness.toFixed(1)}`}`;
  }

  function isNearElement(point, element) {
    if (element.type === "pen") {
      return element.points.some((strokePoint) => distance(point, strokePoint) < element.width * 2.5 + 9);
    }
    const left = Math.min(element.start.x, element.end.x) - 12;
    const right = Math.max(element.start.x, element.end.x) + 12;
    const top = Math.min(element.start.y, element.end.y) - 12;
    const bottom = Math.max(element.start.y, element.end.y) + 12;
    return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  }

  function eraseAt(point) {
    for (let index = state.elements.length - 1; index >= 0; index -= 1) {
      if (isNearElement(point, state.elements[index])) {
        state.elements.splice(index, 1);
        state.redo = [];
        render();
        return;
      }
    }
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    if (state.tool === "eraser") {
      eraseAt(point);
      return;
    }
    state.redo = [];
    const style = { color: state.color, width: state.width, roughness: state.roughness, dynamicPressure: state.dynamicPressure };
    state.drawing = state.tool === "pen"
      ? { type: "pen", points: [point], ...style }
      : { type: state.tool, start: point, end: point, seed: Math.floor(Math.random() * 2147483647), ...style };
    render();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    const point = pointFromEvent(event);
    if (state.tool === "eraser") {
      eraseAt(point);
      return;
    }
    if (!state.drawing) return;
    if (state.drawing.type === "pen") {
      const previous = state.drawing.points[state.drawing.points.length - 1];
      if (distance(previous, point) >= 1.25) state.drawing.points.push(point);
    } else {
      state.drawing.end = point;
    }
    render();
  });

  function commitDrawing(event) {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!state.drawing) return;
    if (state.drawing.type === "pen" && state.drawing.points.length === 1) {
      state.drawing.points.push({ ...state.drawing.points[0], x: state.drawing.points[0].x + 0.1 });
    }
    state.elements.push(state.drawing);
    state.drawing = null;
    render();
  }

  canvas.addEventListener("pointerup", commitDrawing);
  canvas.addEventListener("pointercancel", commitDrawing);

  document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => selectTool(button.dataset.tool)));
  document.querySelectorAll(".swatch").forEach((button) => button.addEventListener("click", () => {
    state.color = button.dataset.color;
    colorInput.value = state.color;
    document.querySelectorAll(".swatch").forEach((swatch) => swatch.classList.toggle("active", swatch === button));
  }));
  colorInput.addEventListener("input", () => {
    state.color = colorInput.value;
    document.querySelectorAll(".swatch").forEach((swatch) => swatch.classList.remove("active"));
  });
  widthInput.addEventListener("input", () => {
    state.width = Number(widthInput.value);
    document.querySelector("#width-output").value = `${state.width} px`;
  });
  roughnessInput.addEventListener("input", () => {
    state.roughness = Number(roughnessInput.value);
    document.querySelector("#roughness-output").value = state.roughness.toFixed(1);
    selectTool(state.tool);
  });
  pressureInput.addEventListener("change", () => {
    state.dynamicPressure = pressureInput.checked;
    selectTool(state.tool);
  });

  function undo() {
    const element = state.elements.pop();
    if (element) state.redo.push(element);
    render();
  }
  function redo() {
    const element = state.redo.pop();
    if (element) state.elements.push(element);
    render();
  }
  undoButton.addEventListener("click", undo);
  redoButton.addEventListener("click", redo);

  document.querySelector("#clear").addEventListener("click", () => {
    if (!state.elements.length) return;
    state.redo.push(...state.elements.splice(0));
    render();
  });

  document.querySelector("#export").addEventListener("click", () => {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exportContext = exportCanvas.getContext("2d");
    exportContext.fillStyle = "#fbfaf7";
    exportContext.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportContext.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    state.elements.forEach((element) => drawElement(exportContext, element));
    const link = document.createElement("a");
    link.download = `papertrail-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  });

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const shortcut = { p: "pen", r: "rectangle", o: "ellipse", a: "arrow", e: "eraser" }[event.key.toLowerCase()];
    if (shortcut) selectTool(shortcut);
  });

  new ResizeObserver(resizeCanvas).observe(wrap);
  selectTool("pen");
  resizeCanvas();
})();
