import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ChainIcon } from "./DimensionFields.jsx";
import ScrubField from "./ScrubField.jsx";

// The selected object's transform box, drawn over the 3D view (it replaces the blue
// selection ring). Its geometry comes from `t.gizmo`, measured by the placement effect
// in the object's own yaw frame, so the box turns with the object:
//
//   - corner handles on the base   scale W and D (with the size link: everything)
//   - edge handles on the base     scale W or D (with the link: everything)
//   - the handle on top            scales the height
//   - the round handle             rotates (Shift: 15° steps)
//   - the diamond above the top    leans the object (tiltX/tiltZ, ±45°, Shift: 5° steps):
//                                  drag it the way the top should go
//   - the toolbar's second row     angle, both tilts, and 立てる/寝かせる
//   - a number field on each axis  types W / D / H directly
//   - the small toolbar            angle, and the size link (on by default)
//
// The side or corner opposite the handle stays where it is. Everything is written back
// as ordinary object fields (w/d/h or thickness, x/z, rotY) through onPatch.
const HANDLE = 5; // half size, screen px
const ROT_STEP = 15;
const LEAN_STEP = 5;
const LEAN_MAX = 45; // the inspector's limit
const LEAN_STEM = 30; // screen px from the top of the box up to the lean handle

const r1 = (v) => Math.round(v * 10) / 10;

// The same field as the inspector's (drag left/right to scrub, click to type, Shift ×5,
// Alt ×0.2), on a dark chip so it reads over the 3D view. Presses stop here, so
// working a field never selects, moves or orbits anything behind it.
function GizmoScrub({ prefix, title, ...field }) {
  return (
    <div
      title={title}
      onPointerDown={(e) => e.stopPropagation()}
      className="rounded"
      style={{ background: "rgba(28,26,23,0.92)", padding: "1px 3px", pointerEvents: "auto", whiteSpace: "nowrap" }}
    >
      <ScrubField compact label={prefix ? <span style={{ fontSize: "11px", color: "var(--highlight)" }}>{prefix}</span> : null} {...field} />
    </div>
  );
}

// the inspector's limits for each size field, so the box can't push past them either
function limitsFor(kind, o, field) {
  if (kind === "box") return field === "lidH" ? [1, 200] : [1, 500];
  if (o.kind === "die") return [2, 60];
  return field === "thickness" ? [0.1, 300] : [1, 500];
}
// narrows a scale factor so every field it touches stays inside its limits
function clampScale(k, entries) {
  let lo = 0;
  let hi = Infinity;
  entries.forEach(([value, [min, max]]) => {
    if (!(value > 0)) return;
    lo = Math.max(lo, min / value);
    hi = Math.min(hi, max / value);
  });
  return Math.min(hi, Math.max(lo, k));
}

// With several objects selected (t.gizmo.group) the box is world-aligned around all of
// them and acts on the whole set: scaling is uniform (every object's sizes and its
// distance from the anchor scale together), rotating turns every object and its
// position around the set's centre. Changes come back as onPatchMany([{ kind, id, patch }]).
export default function TransformGizmo({ t, SCALE, obj, members = [], artW, artH, zoom, link, onToggleLink, onPatch, onPatchMany }) {
  const [view, setView] = useState(null);
  const dragRef = useRef(null);
  const viewKeyRef = useRef("");

  // ---- yaw-frame ↔ world ----
  const toWorld = (g, lx, lz, y = 0) => {
    const c = Math.cos(g.yaw);
    const s = Math.sin(g.yaw);
    return new THREE.Vector3(g.P[0] + lx * c + lz * s, y, g.P[1] - lx * s + lz * c);
  };
  const toYaw = (g, wx, wz) => {
    const c = Math.cos(g.yaw);
    const s = Math.sin(g.yaw);
    const x = wx - g.P[0];
    const z = wz - g.P[1];
    return [x * c - z * s, x * s + z * c];
  };
  const project = (v) => {
    const p = v.clone().project(t.camera);
    return [((p.x + 1) / 2) * artW, ((1 - p.y) / 2) * artH, p.z];
  };

  // ---- per frame: project the box; re-render only when it actually moved ----
  useEffect(() => {
    t.onFrame = () => {
      const g = t.gizmo;
      if (!g || !t.camera) {
        if (viewKeyRef.current !== "") {
          viewKeyRef.current = "";
          setView(null);
        }
        return;
      }
      const cx = (g.x0 + g.x1) / 2;
      const cz = (g.z0 + g.z1) / 2;
      const corners = [
        [g.x0, g.z0],
        [g.x1, g.z0],
        [g.x1, g.z1],
        [g.x0, g.z1],
      ];
      const base = corners.map(([x, z]) => project(toWorld(g, x, z, g.y0)));
      const top = corners.map(([x, z]) => project(toWorld(g, x, z, g.y1)));
      if ([...base, ...top].some((p) => p[2] > 1)) {
        // behind the camera
        if (viewKeyRef.current !== "") {
          viewKeyRef.current = "";
          setView(null);
        }
        return;
      }
      // edges in order: z0 (x-parallel), x1 (z-parallel), z1, x0 — with the handle each drives
      const edges = [
        { a: 0, b: 1, h: [0, -1], axis: "x", out: [0, -1] },
        { a: 1, b: 2, h: [1, 0], axis: "z", out: [1, 0] },
        { a: 2, b: 3, h: [0, 1], axis: "x", out: [0, 1] },
        { a: 3, b: 0, h: [-1, 0], axis: "z", out: [-1, 0] },
      ].map((e) => ({ ...e, mid: [(base[e.a][0] + base[e.b][0]) / 2, (base[e.a][1] + base[e.b][1]) / 2] }));
      const cornerH = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ];
      // labels sit on the edge of each pair that is lowest on screen (nearest the viewer)
      const pick = (axis) => edges.filter((e) => e.axis === axis).sort((p, q) => q.mid[1] - p.mid[1])[0];
      const ex = pick("x");
      const ez = pick("z");
      const centerScr = project(toWorld(g, cx, cz, g.y0));
      const away = (m, k = 22) => {
        const dx = m[0] - centerScr[0];
        const dy = m[1] - centerScr[1];
        const l = Math.hypot(dx, dy) || 1;
        return [m[0] + (dx / l) * k, m[1] + (dy / l) * k];
      };
      // height: the vertical edge at the right-most base corner
      const hi = base.reduce((best, p, i) => (p[0] > base[best][0] ? i : best), 0);
      // rotation handle: out past the edge that is highest on screen (the far side)
      const far = [...edges].sort((p, q) => p.mid[1] - q.mid[1])[0];
      const reach = Math.max(g.x1 - g.x0, g.z1 - g.z0) * 0.22 + 0.12;
      const farMidYaw = [cx + far.out[0] * ((g.x1 - g.x0) / 2), cz + far.out[1] * ((g.z1 - g.z0) / 2)];
      const rotYaw = [farMidYaw[0] + far.out[0] * reach, farMidYaw[1] + far.out[1] * reach];
      const rot = project(toWorld(g, rotYaw[0], rotYaw[1], g.y0));
      const next = {
        base,
        top,
        edges,
        cornerH,
        labelX: away(ex.mid),
        labelZ: away(ez.mid),
        hIndex: hi,
        labelH: [(base[hi][0] + top[hi][0]) / 2 + 30, (base[hi][1] + top[hi][1]) / 2],
        // how long each axis looks on screen — a field only sits on its edge when the
        // edge is long enough to hold it; otherwise it moves into the toolbar
        lenX: Math.hypot(base[ex.a][0] - base[ex.b][0], base[ex.a][1] - base[ex.b][1]),
        lenZ: Math.hypot(base[ez.a][0] - base[ez.b][0], base[ez.a][1] - base[ez.b][1]),
        lenH: Math.hypot(top[hi][0] - base[hi][0], top[hi][1] - base[hi][1]),
        rot,
        farMid: far.mid,
        topCenter: project(toWorld(g, cx, cz, g.y1)),
        // under the box, centred on it — or above it when there's no room below
        toolbar: (() => {
          const all = [...base, ...top, rot];
          const xs = all.map((p) => p[0]);
          const ys = all.map((p) => p[1]);
          const cxs = Math.min(artW - 90, Math.max(90, (Math.min(...xs) + Math.max(...xs)) / 2));
          const below = Math.max(...ys) + 16;
          return below < artH - 40 ? { x: cxs, y: below, above: false } : { x: cxs, y: Math.max(40, Math.min(...ys) - 16), above: true };
        })(),
      };
      const key = JSON.stringify([...[base, top, rot].flat(2).map((v) => Math.round(v)), artW, artH]);
      if (key !== viewKeyRef.current) {
        viewKeyRef.current = key;
        setView(next);
      }
    };
    return () => {
      t.onFrame = null;
    };
  }); // re-bound each render so it sees the current artW/artH

  if (!view || !t.gizmo) return null;
  const g = t.gizmo;
  const f = g.fieldFor;

  // ---- writing a scale back: new fields + the origin moved so the anchor holds ----
  // s: per-axis factors; hx/hz: which side is dragged (0 = scale about the centre)
  const scalePatch = (g0, o0, { sx, sy, sz, hx = 0, hz = 0 }) => {
    // keep every field inside the inspector's limits; a linked scale stays one factor
    if (g0.uniformOnly) {
      sx = sy = sz = clampScale(sx, [[o0.w, limitsFor(g0.kind, o0, "w")]]);
    } else if (sx === sy && sy === sz) {
      const k = clampScale(sx, ["x", "y", "z"].map((ax) => [o0[g0.fieldFor[ax]], limitsFor(g0.kind, o0, g0.fieldFor[ax])]));
      sx = sy = sz = k;
    } else {
      const one = (k, ax) => (k === 1 ? 1 : clampScale(k, [[o0[g0.fieldFor[ax]], limitsFor(g0.kind, o0, g0.fieldFor[ax])]]));
      sx = one(sx, "x");
      sy = one(sy, "y");
      sz = one(sz, "z");
    }
    const ex0 = g0.x1 - g0.x0;
    const ez0 = g0.z1 - g0.z0;
    const span = (lo, hi, len, sgn) => (sgn > 0 ? [lo, lo + len] : sgn < 0 ? [hi - len, hi] : [(lo + hi) / 2 - len / 2, (lo + hi) / 2 + len / 2]);
    const [nx0] = span(g0.x0, g0.x1, ex0 * sx, hx);
    const [nz0] = span(g0.z0, g0.z1, ez0 * sz, hz);
    // the origin keeps its place within the bounds
    const ox = nx0 - g0.x0 * sx;
    const oz = nz0 - g0.z0 * sz;
    const P = toWorld(g0, ox, oz);
    const patch = { x: r1(P.x / SCALE), z: r1(P.z / SCALE) };
    if (g0.uniformOnly) {
      const v = Math.max(1, r1(o0.w * sx));
      return { ...patch, w: v, d: v, thickness: v };
    }
    [
      ["x", sx],
      ["y", sy],
      ["z", sz],
    ].forEach(([axis, k]) => {
      const field = g0.fieldFor[axis];
      if (field && k !== 1) patch[field] = Math.max(field === "thickness" ? 0.1 : 1, r1(o0[field] * k));
    });
    return patch;
  };

  // ---- the whole selection at once ----
  const groupScale = (g0, ms0, k0, hx = 0, hz = 0) => {
    const k = clampScale(
      k0,
      ms0.flatMap(({ kind, obj: o }) => (kind === "box" ? ["w", "d", "h", "lidH"] : ["w", "d", "thickness"]).map((fl) => [o[fl], limitsFor(kind, o, fl)]))
    );
    const ax = hx > 0 ? g0.x0 : hx < 0 ? g0.x1 : (g0.x0 + g0.x1) / 2;
    const az = hz > 0 ? g0.z0 : hz < 0 ? g0.z1 : (g0.z0 + g0.z1) / 2;
    return ms0.map(({ kind, id, obj: o }) => {
      const px = o.x * SCALE;
      const pz = o.z * SCALE;
      const patch = { x: r1((ax + (px - ax) * k) / SCALE), z: r1((az + (pz - az) * k) / SCALE) };
      (kind === "box" ? ["w", "d", "h", "lidH"] : ["w", "d", "thickness"]).forEach((fl) => {
        if (o[fl] > 0) patch[fl] = Math.max(fl === "thickness" ? 0.1 : 1, r1(o[fl] * k));
      });
      if (o.floatHeight) patch.floatHeight = r1(o.floatHeight * k);
      return { kind, id, patch };
    });
  };
  const groupRotate = (ms0, c, deltaDeg) => {
    const th = (deltaDeg * Math.PI) / 180;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    return ms0.map(({ kind, id, obj: o }) => {
      const rx = o.x * SCALE - c.x;
      const rz = o.z * SCALE - c.z;
      const rot = ((((o.rotY || 0) + deltaDeg) % 360) + 360) % 360;
      return { kind, id, patch: { x: r1((c.x + rx * cs + rz * sn) / SCALE), z: r1((c.z - rx * sn + rz * cs) / SCALE), rotY: rot } };
    });
  };
  const snapshot = () => members.map((m) => ({ kind: m.kind, id: m.id, obj: { ...m.obj } }));

  // ---- dragging ----
  const groundAt = (e, y) => {
    const rect = t.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, t.camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
  };
  const begin = (e, mode, extra) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // no live pointer to capture (synthetic events) — the drag still works without it
    }
    dragRef.current = { mode, g0: { ...g, P: [...g.P] }, o0: { ...obj }, ms0: snapshot(), ...extra };
    if (mode === "rotate") {
      const c = toWorld(g, (g.x0 + g.x1) / 2, (g.z0 + g.z1) / 2);
      const p = groundAt(e, g.y0);
      if (p) dragRef.current.phi0 = Math.atan2(p.x - c.x, p.z - c.z);
      dragRef.current.c = c;
    }
    if (mode === "lean") {
      const p = groundAt(e, g.y1);
      if (p) dragRef.current.l0 = toYaw(g, p.x, p.z);
    }
    if (mode === "height") {
      dragRef.current.b = view.base[view.hIndex];
      dragRef.current.tp = view.top[view.hIndex];
      const rect = t.renderer.domElement.getBoundingClientRect();
      dragRef.current.rect = rect;
    }
  };
  const move = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const { g0, o0 } = d;
    const linked = link || g0.uniformOnly;
    if (d.mode === "scale") {
      const p = groundAt(e, g0.y0);
      if (!p) return;
      const [lx, lz] = toYaw(g0, p.x, p.z);
      const [hx, hz] = d.h;
      const ax = hx > 0 ? g0.x0 : hx < 0 ? g0.x1 : (g0.x0 + g0.x1) / 2;
      const az = hz > 0 ? g0.z0 : hz < 0 ? g0.z1 : (g0.z0 + g0.z1) / 2;
      const ex0 = g0.x1 - g0.x0;
      const ez0 = g0.z1 - g0.z0;
      let sx = hx ? Math.max(0.05, (hx * (lx - ax)) / ex0) : 1;
      let sz = hz ? Math.max(0.05, (hz * (lz - az)) / ez0) : 1;
      let sy = 1;
      if (linked) {
        let s;
        if (hx && hz) {
          const vx = hx * ex0;
          const vz = hz * ez0;
          s = ((lx - ax) * vx + (lz - az) * vz) / (vx * vx + vz * vz);
        } else s = hx ? sx : sz;
        s = Math.max(0.05, s);
        sx = sy = sz = s;
      }
      if (g0.group) onPatchMany(groupScale(g0, d.ms0, sx, hx, hz));
      else onPatch(scalePatch(g0, o0, { sx, sy, sz, hx, hz }));
    } else if (d.mode === "height") {
      // along the vertical edge as it appears on screen
      const k = artW / d.rect.width; // client px → artboard px (the artboard is zoomed)
      const cx = (e.clientX - d.rect.left) * k;
      const cy = (e.clientY - d.rect.top) * k;
      const ux = d.tp[0] - d.b[0];
      const uy = d.tp[1] - d.b[1];
      const s = Math.max(0.05, ((cx - d.b[0]) * ux + (cy - d.b[1]) * uy) / (ux * ux + uy * uy || 1));
      if (g0.group) onPatchMany(groupScale(g0, d.ms0, s));
      else onPatch(scalePatch(g0, o0, linked ? { sx: s, sy: s, sz: s } : { sx: 1, sy: s, sz: 1 }));
    } else if (d.mode === "lean") {
      // the pointer, on the plane through the top of the box, in the object's own
      // frame: leaning by tiltX moves the top along +z, by tiltZ along -x
      const p = groundAt(e, g0.y1);
      if (!p || !d.l0) return;
      const [lx, lz] = toYaw(g0, p.x, p.z);
      const h = Math.max(0.01, g0.y1 - g0.y0);
      const deg = (r) => (r * 180) / Math.PI;
      const step = (v) => {
        const r = e.shiftKey ? Math.round(v / LEAN_STEP) * LEAN_STEP : Math.round(v);
        return Math.max(-LEAN_MAX, Math.min(LEAN_MAX, r));
      };
      const tiltX = step((o0.tiltX || 0) + deg(Math.atan2(lz, h) - Math.atan2(d.l0[1], h)));
      const tiltZ = step((o0.tiltZ || 0) - deg(Math.atan2(lx, h) - Math.atan2(d.l0[0], h)));
      onPatch({ tiltX, tiltZ });
    } else if (d.mode === "rotate") {
      const p = groundAt(e, g0.y0);
      if (!p || d.phi0 == null) return;
      const phi = Math.atan2(p.x - d.c.x, p.z - d.c.z);
      if (g0.group) {
        let delta = ((phi - d.phi0) * 180) / Math.PI;
        delta = e.shiftKey ? Math.round(delta / ROT_STEP) * ROT_STEP : Math.round(delta);
        onPatchMany(groupRotate(d.ms0, d.c, delta));
        return;
      }
      let deg = (o0.rotY || 0) + ((phi - d.phi0) * 180) / Math.PI;
      deg = e.shiftKey ? Math.round(deg / ROT_STEP) * ROT_STEP : Math.round(deg);
      onPatch({ rotY: ((deg % 360) + 360) % 360 });
    }
  };
  const end = () => {
    dragRef.current = null;
  };
  const dragProps = (mode, extra) => ({
    onPointerDown: (e) => begin(e, mode, extra),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
  });

  // ---- typed values ----
  const typeSize = (axis, v) => {
    if (g.group) {
      const ext = valueOf(axis);
      if (v > 0 && ext > 0) onPatchMany(groupScale(g, snapshot(), v / ext));
      return;
    }
    const field = f[axis];
    const old = g.uniformOnly ? obj.w : obj[field];
    if (!(v > 0) || !(old > 0)) return;
    const k = v / old;
    const linked = link || g.uniformOnly;
    const s = { sx: 1, sy: 1, sz: 1 };
    if (linked) s.sx = s.sy = s.sz = k;
    else s["s" + axis] = k;
    onPatch(scalePatch(g, obj, s));
  };
  // a set's size is its overall extent; one object's is its own field
  function valueOf(axis) {
    if (g.group) return ((axis === "x" ? g.x1 - g.x0 : axis === "z" ? g.z1 - g.z0 : g.y1 - g.y0) / SCALE);
    return (g.uniformOnly ? obj.w : obj[f[axis]]) ?? 0;
  }
  const groupLabel = { x: ["W", "幅(全体)"], z: ["D", "奥行(全体)"], y: ["H", "高さ(全体)"] };
  const label = { w: "幅", d: "奥行", h: "高さ", thickness: "厚み" };
  const short = { w: "W", d: "D", h: "H", thickness: "T" };

  // one size field per axis (a die has just one); each on its edge, or in the toolbar
  const EDGE_MIN = 96; // screen px an edge needs to carry its own field
  const z = zoom || 1;
  const fields = (g.group || !g.uniformOnly ? ["x", "z", "y"] : ["x"]).map((axis) => {
    const len = axis === "x" ? view.lenX : axis === "z" ? view.lenZ : view.lenH;
    return {
      axis,
      onEdge: len * z >= EDGE_MIN,
      at: axis === "x" ? view.labelX : axis === "z" ? view.labelZ : view.labelH,
      input: (() => {
        // the same min/max/step as the inspector field it stands for
        const [min, max] = g.group ? [1, 3000] : limitsFor(g.kind, obj, g.uniformOnly ? "w" : f[axis]);
        const fine = !g.group && f[axis] === "thickness";
        return (
          <GizmoScrub
            value={valueOf(axis)}
            onChange={(v) => typeSize(axis, v)}
            min={min}
            max={max}
            step={fine ? 0.1 : g.group || g.kind === "box" ? 0.1 : 0.5}
            decimals={1}
            unit="mm"
            dragRange={g.group ? 900 : 300}
            prefix={g.group ? groupLabel[axis][0] : g.uniformOnly ? "" : short[f[axis]]}
            title={g.group ? groupLabel[axis][1] : g.uniformOnly ? "サイズ" : label[f[axis]]}
          />
        );
      })(),
    };
  });

  const pts = (arr) => arr.map((p) => `${p[0]},${p[1]}`).join(" ");
  const inv = 1 / (zoom || 1);
  const at = (p, child, key) => (
    <div key={key} style={{ position: "absolute", left: p[0], top: p[1], transform: `translate(-50%, -50%) scale(${inv})`, pointerEvents: "none" }}>
      {child}
    </div>
  );
  const handleRect = (p, key, mode, extra, cursor) => (
    <g key={key} style={{ cursor, pointerEvents: "auto" }} {...dragProps(mode, extra)}>
      <circle cx={p[0]} cy={p[1]} r={HANDLE * 2.2 * inv} fill="transparent" />
      <rect
        x={p[0] - HANDLE * inv}
        y={p[1] - HANDLE * inv}
        width={HANDLE * 2 * inv}
        height={HANDLE * 2 * inv}
        fill="#ffffff"
        stroke="var(--highlight)"
        strokeWidth={1.5 * inv}
      />
    </g>
  );

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
      <svg width={artW} height={artH} style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}>
        {/* top outline and verticals faint, the base (what the handles act on) solid */}
        <polygon points={pts(view.top)} fill="none" stroke="var(--highlight)" strokeOpacity={0.45} strokeWidth={1 * inv} strokeDasharray={`${4 * inv} ${3 * inv}`} />
        {view.base.map((b, i) => (
          <line key={i} x1={b[0]} y1={b[1]} x2={view.top[i][0]} y2={view.top[i][1]} stroke="var(--highlight)" strokeOpacity={i === view.hIndex ? 0.9 : 0.35} strokeWidth={1 * inv} />
        ))}
        <polygon points={pts(view.base)} fill="rgba(95,211,217,0.06)" stroke="var(--highlight)" strokeWidth={1.5 * inv} />
        <line x1={view.farMid[0]} y1={view.farMid[1]} x2={view.rot[0]} y2={view.rot[1]} stroke="var(--highlight)" strokeWidth={1 * inv} />
        <g style={{ cursor: "grab", pointerEvents: "auto" }} {...dragProps("rotate")}>
          <circle cx={view.rot[0]} cy={view.rot[1]} r={HANDLE * 2.4 * inv} fill="transparent" />
          <circle cx={view.rot[0]} cy={view.rot[1]} r={HANDLE * 1.3 * inv} fill="var(--highlight)" stroke="#ffffff" strokeWidth={1.5 * inv} />
        </g>
        {!g.group &&
          (() => {
            const [tx, ty] = view.topCenter;
            const hy = ty - LEAN_STEM * inv;
            const r = HANDLE * 1.25 * inv;
            return (
              <g key="lean">
                <line x1={tx} y1={ty} x2={tx} y2={hy} stroke="#ffb454" strokeWidth={1 * inv} strokeDasharray={`${3 * inv} ${2 * inv}`} />
                <g style={{ cursor: "move", pointerEvents: "auto" }} {...dragProps("lean")}>
                  <title>ドラッグで傾ける(Shiftで5°刻み)</title>
                  <circle cx={tx} cy={hy} r={HANDLE * 2.4 * inv} fill="transparent" />
                  <path d={`M${tx} ${hy - r} L${tx + r} ${hy} L${tx} ${hy + r} L${tx - r} ${hy} Z`} fill="#ffb454" stroke="#1c1a17" strokeWidth={1 * inv} />
                </g>
              </g>
            );
          })()}
        {view.base.map((p, i) => handleRect(p, `c${i}`, "scale", { h: view.cornerH[i] }, "nwse-resize"))}
        {view.edges.map((e, i) => handleRect(e.mid, `e${i}`, "scale", { h: e.h }, e.axis === "x" ? "ns-resize" : "ew-resize"))}
        {/* a thin piece's top sits on its base corner — no separate height handle then (the field still works) */}
        {Math.hypot(view.top[view.hIndex][0] - view.base[view.hIndex][0], view.top[view.hIndex][1] - view.base[view.hIndex][1]) * (zoom || 1) >= 16 &&
          handleRect(view.top[view.hIndex], "h", "height", null, "ns-resize")}
      </svg>

      {fields.filter((fd) => fd.onEdge).map((fd) => at(fd.at, fd.input, fd.axis))}

      {/* toolbar: the size fields that don't fit on their edges, angle, size link */}
      <div
        style={{
          position: "absolute",
          left: view.toolbar.x,
          top: view.toolbar.y,
          transform: `translate(-50%, ${view.toolbar.above ? "-100%" : "0"}) scale(${inv})`,
          transformOrigin: view.toolbar.above ? "50% 100%" : "50% 0",
          pointerEvents: "auto",
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex flex-col items-center gap-1"
      >
        <div className="flex items-center gap-1">
        {fields.filter((fd) => !fd.onEdge).map((fd) => (
          <React.Fragment key={fd.axis}>{fd.input}</React.Fragment>
        ))}
        {g.group && (
          // a set has no angle of its own (rotate it with the round handle) and always scales uniformly
          <span className="rounded" style={{ background: "rgba(28,26,23,0.9)", border: "1px solid var(--border-well)", padding: "2px 6px", fontSize: "11px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
            {g.count}個を選択中
          </span>
        )}
        {!g.group && (
        <button
          type="button"
          onClick={onToggleLink}
          aria-pressed={link}
          aria-label="縦横高さの比率を固定"
          title={link ? "比率固定オン(ハンドルや数値で縦横高さが一緒に変わる)" : "比率固定オフ(各辺を個別に変える)"}
          className="flex items-center justify-center rounded"
          style={{
            width: "22px",
            height: "22px",
            background: "rgba(28,26,23,0.9)",
            color: link ? "var(--accent)" : "var(--text-muted)",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: link ? "var(--accent)" : "var(--border-well)",
            cursor: "pointer",
          }}
        >
          <ChainIcon on={link} />
        </button>
        )}
        </div>
        {!g.group && (
          // the pose: turn, lean front/back and left/right, stand up or lay down
          <div className="flex items-center gap-1">
            <GizmoScrub prefix="角度" value={obj.rotY || 0} onChange={(v) => onPatch({ rotY: ((v % 360) + 360) % 360 })} min={0} max={359} unit="°" title="角度(回転 Y)" />
            <GizmoScrub prefix="前後" value={obj.tiltX || 0} onChange={(v) => onPatch({ tiltX: v })} min={-LEAN_MAX} max={LEAN_MAX} unit="°" title="傾き(前後)" />
            <GizmoScrub prefix="左右" value={obj.tiltZ || 0} onChange={(v) => onPatch({ tiltZ: v })} min={-LEAN_MAX} max={LEAN_MAX} unit="°" title="傾き(左右)" />
            {obj.kind !== "die" && (
              <button
                type="button"
                onClick={() => onPatch({ orientation: obj.orientation === "standing" ? "lying" : "standing" })}
                title={obj.orientation === "standing" ? "寝かせる(平置きにする)" : "立てる(縦置きにする)"}
                className="rounded"
                style={{ background: "rgba(28,26,23,0.9)", border: "1px solid var(--border-well)", color: "var(--text-primary)", fontSize: "11px", padding: "3px 8px", whiteSpace: "nowrap", cursor: "pointer" }}
              >
                {obj.orientation === "standing" ? "寝かせる" : "立てる"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
