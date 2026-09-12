// SPDX-License-Identifier: MIT
//
// rcam-merge.mjs — the dependency-free .rcam three-way git merge driver.
// Bundled from the rcam source by scripts/build-merge-driver.ts. MIT licensed;
// see LICENSE-MIT.
//
import { readFileSync, writeFileSync } from "node:fs";
//#region src/core/units.ts
var MM_PER_INCH = 25.4;
/** Convert an internal millimetre value to `unit`. */
function fromMM(mm, unit) {
	return unit === "in" ? mm / MM_PER_INCH : mm;
}
//#endregion
//#region src/io/rcamObjectNames.ts
/**
* Naming the thing a merge conflict is about.
*
* `mergeRcam` addresses conflicts by id — `entities[ent-mfk3-a7b2].p0.x` — which
* is exact, stable, and the seam anything programmatic should use. It is also
* unfindable by a person: nobody can look at a canvas and pick out
* `ent-mfk3-a7b2`. So every conflict also carries a sentence saying WHICH SHAPE,
* and roughly where it is, which is all you need to go and look at it.
*
* Two constraints shape this file:
*
* 1. It works on PERSISTED JSON, not on `Entity` instances. The merge driver
*    never builds a document — that is the dependency weight it exists to avoid
*    — so `describeEntity` in ../ui/designTree, which needs real entities with
*    `bounds()` and computed getters, cannot be reused. This is deliberately a
*    second description of the same nine types, and `rcamObjectNames.test.ts`
*    drives the list off the SCHEMA so a tenth type cannot be added without
*    teaching this too.
* 2. It must stay dependency-free. `../core/units` is imported for the mm
*    conversion and has no imports of its own; nothing heavier belongs here.
*/
function num(v) {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}
/** A length in the file's own display unit — reporting raw mm to someone
*  working in inches is the units bug this codebase has fixed three times. */
function len(mm, unit) {
	const v = num(mm);
	if (v === null) return "?";
	return `${fromMM(v, unit).toFixed(unit === "in" ? 3 : 2)} ${unit}`;
}
/** A bare coordinate pair, no unit suffix — the suffix goes on the whole pair. */
function at(p, unit) {
	const o = p ?? {};
	const x = num(o.x);
	const y = num(o.y);
	if (x === null || y === null) return "";
	const d = unit === "in" ? 3 : 1;
	return ` at (${fromMM(x, unit).toFixed(d)}, ${fromMM(y, unit).toFixed(d)}) ${unit}`;
}
/** The user's own name for an object, quoted, when they gave it one. */
function given(o) {
	const n = o.name;
	return typeof n === "string" && n.trim() ? ` "${n.trim()}"` : "";
}
/**
* Describe one persisted entity: what it is, how big, and where.
*
* Every branch names a SIZE as well as a position. A conflict report that said
* only "Circle at (120, 45)" is no help in a design with a bolt circle in it —
* the diameter is what tells two otherwise identical holes apart.
*/
function describeEntityJson(o, unit) {
	const name = given(o);
	switch (o.type) {
		case "point": return `Point${name}${at(o.pos, unit)}`;
		case "line": {
			const a = o.a ?? {};
			const b = o.b ?? {};
			const ax = num(a.x);
			const ay = num(a.y);
			const bx = num(b.x);
			const by = num(b.y);
			return `Line${name}${ax !== null && ay !== null && bx !== null && by !== null ? ` ${len(Math.hypot(bx - ax, by - ay), unit)}` : ""}${at(o.a, unit)}`;
		}
		case "circle": return `Circle${name} ⌀${len(num(o.radius) === null ? null : o.radius * 2, unit)}${at(o.center, unit)}`;
		case "ellipse": {
			const d = (v) => len(num(v) === null ? null : v * 2, unit);
			return `Ellipse${name} ${d(o.rx)} × ${d(o.ry)}${at(o.center, unit)}`;
		}
		case "arc": return `Arc${name} R${len(o.radius, unit)}${at(o.center, unit)}`;
		case "rectangle": {
			const p0 = o.p0 ?? {};
			const p1 = o.p1 ?? {};
			const w = num(p0.x) !== null && num(p1.x) !== null ? Math.abs(p1.x - p0.x) : null;
			const h = num(p0.y) !== null && num(p1.y) !== null ? Math.abs(p1.y - p0.y) : null;
			return `Rectangle${name}${w !== null && h !== null ? ` ${len(w, unit)} × ${len(h, unit)}` : ""}${at(o.p0, unit)}`;
		}
		case "polyline": {
			const pts = Array.isArray(o.points) ? o.points : [];
			const sides = num((o.polygon ?? null)?.sides);
			return `${sides !== null ? `Polygon${name} (${sides} sides)` : `${o.closed ? "Closed" : "Open"} polyline${name} (${pts.length} points)`}${at(pts[0], unit)}`;
		}
		case "bezier": return `Bezier curve${name}${at(o.p0, unit)}`;
		case "polybezier": {
			const nodes = Array.isArray(o.nodes) ? o.nodes : [];
			const segs = nodes.length < 2 ? 0 : o.closed === true ? nodes.length : nodes.length - 1;
			const what = o.closed === true ? "Closed curve" : "Curve";
			const first = nodes[0] ?? {};
			return `${what}${name} (${segs} segment${segs === 1 ? "" : "s"})${at(first.pos, unit)}`;
		}
		case "text": {
			const t = typeof o.text === "string" ? o.text : "";
			return `Text "${t.length > 18 ? `${t.slice(0, 18)}…` : t}"${at(o.position, unit)}`;
		}
		case "image": return `Image${name} ${len(o.widthMM, unit)} × ${len(o.heightMM, unit)}${at(o.position, unit)}`;
		default: return null;
	}
}
/** What each non-entity collection calls one of its members. */
var NOUN = {
	groups: "Group",
	blockDefinitions: "Block",
	features: "Feature",
	layers: "Layer",
	constraints: "Constraint",
	dimensions: "Dimension",
	variables: "Variable",
	bindings: "Binding",
	patterns: "Pattern",
	operations: "Toolpath",
	tools: "Tool",
	fonts: "Font",
	images: "Image data"
};
/**
* A human description of one object from a `.rcam` collection.
*
* Returns null when there is nothing better to say than the id the caller
* already has — a caller must not print an empty parenthetical.
*/
function describeObject(collection, obj, unit) {
	if (obj === null || typeof obj !== "object") return null;
	const o = obj;
	if (collection === "entities") return describeEntityJson(o, unit);
	const noun = NOUN[collection];
	if (!noun) return null;
	const name = given(o);
	if (name) return `${noun}${name}`;
	const t = o.type;
	return typeof t === "string" ? `${noun} (${t})` : noun;
}
/**
* Plain-English names for the single-valued document fields, so a conflict on
* one reads as a setting rather than as a variable name.
*/
var SCALAR_LABEL = {
	name: "Document name",
	canvas: "Work area size",
	displayUnit: "Display units",
	stockThickness: "Stock thickness",
	stockRect: "Stock position",
	origin: "Origin corner",
	machineKind: "Machine kind",
	endPosition: "End position",
	toolChangePosition: "Tool change position",
	flip: "Double-sided setup",
	rotary: "Rotary setup",
	metadata: "Job metadata",
	activeLayerId: "Active layer",
	counter: "Serial counter"
};
/** The label for a document-level field, or null if it is not one. */
function describeScalar(field) {
	return SCALAR_LABEL[field.split(".")[0]] ?? null;
}
//#endregion
//#region src/io/rcamMerge.ts
/** Every collection in the format that is keyed by `id`, in file order. */
var COLLECTIONS = [
	"groups",
	"blockDefinitions",
	"features",
	"layers",
	"entities",
	"constraints",
	"dimensions",
	"variables",
	"bindings",
	"patterns",
	"operations",
	"tools",
	"fonts",
	"images"
];
/**
* Single-valued fields, merged by taking whichever side changed. `counter` is
* handled separately (a monotonic serial, so two branches bumping it are not in
* conflict), and the collections above are excluded.
*/
var SCALARS = [
	"name",
	"canvas",
	"displayUnit",
	"stockThickness",
	"stockRect",
	"origin",
	"machineKind",
	"endPosition",
	"toolChangePosition",
	"flip",
	"rotary",
	"metadata",
	"activeLayerId"
];
/**
* A key-order-independent rendering of a value, for COMPARISON only.
*
* `JSON.stringify` preserves insertion order, so a hand-edited file that wrote
* `id` before `type` would compare as "changed" against a design nobody
* touched. Sorting keys makes "did this side change it" a question about
* content. The original object is what gets written out, never this.
*/
function canonical(v) {
	if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
	if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
	const rec = v;
	return `{${Object.keys(rec).sort().filter((k) => rec[k] !== void 0).map((k) => `${JSON.stringify(k)}:${canonical(rec[k])}`).join(",")}}`;
}
function isPlainObject(v) {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}
/**
* Three-way merge of one value, down to the field.
*
* Object granularity is not enough, and the merge lab proved it: two people
* moving DIFFERENT corners of one rectangle — one edits `p0.x`, the other
* `p1.y` — changed the same object, so an object-level merge calls that a
* conflict. Git's plain text merge handles it, because the two coordinates are
* on different lines. A driver that has to be installed must not lose to the
* thing it replaces, so this recurses into objects and disagrees only where the
* two sides actually set the same field to different values.
*
* Arrays are treated as single values, deliberately. A polyline's `points` and
* an operation's `entityIds` are ordered wholes: merging them element by
* element would splice two different shapes together and call it success. One
* side changing the list wins; both changing it differently is a conflict.
*/
function mergeValue(where, base, ours, theirs, conflicts) {
	const b = canonical(base);
	const o = canonical(ours);
	const t = canonical(theirs);
	if (o === t) return ours;
	if (b === o) return theirs;
	if (b === t) return ours;
	if (isPlainObject(ours) && isPlainObject(theirs) && isPlainObject(base)) {
		const out = {};
		for (const key of /* @__PURE__ */ new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
			const inOurs = key in ours;
			const inTheirs = key in theirs;
			if (inOurs && inTheirs) {
				out[key] = mergeValue(`${where}.${key}`, base[key], ours[key], theirs[key], conflicts);
				continue;
			}
			const side = inOurs ? ours : theirs;
			const had = key in base;
			if (!had || canonical(base[key]) === canonical(side[key])) {
				if (!had) out[key] = side[key];
			} else {
				out[key] = side[key];
				conflicts.push({
					where: `${where}.${key}`,
					reason: "removed on one side and changed on the other — kept the change"
				});
			}
		}
		return out;
	}
	conflicts.push({
		where,
		reason: "changed on both sides, differently — kept ours"
	});
	return ours;
}
function idOf(o) {
	const id = o?.id;
	return typeof id === "string" ? id : void 0;
}
/** Index a collection by id, keeping the first of any duplicate. */
function byId(list) {
	const m = /* @__PURE__ */ new Map();
	for (const o of list ?? []) {
		const id = idOf(o);
		if (id !== void 0 && !m.has(id)) m.set(id, o);
	}
	return m;
}
/**
* Merge one id-keyed collection.
*
* Order matters — for `entities` it IS the draw order — so the result follows
* ours, then appends what only theirs added, in theirs' own order. A new object
* from the other branch therefore lands on top of the stack, which is what
* "added most recently" means anyway.
*/
function mergeCollection(name, base, ours, theirs, conflicts) {
	const b = byId(base);
	const o = byId(ours);
	const t = byId(theirs);
	const keep = /* @__PURE__ */ new Map();
	for (const id of /* @__PURE__ */ new Set([...o.keys(), ...t.keys()])) {
		const inBase = b.has(id);
		const bv = inBase ? canonical(b.get(id)) : void 0;
		const ov = o.has(id) ? canonical(o.get(id)) : void 0;
		const tv = t.has(id) ? canonical(t.get(id)) : void 0;
		if (ov !== void 0 && tv !== void 0) {
			if (!inBase && ov !== tv) {
				keep.set(id, o.get(id));
				conflicts.push({
					where: `${name}[${id}]`,
					reason: "added on both sides with the same id but different content — kept ours"
				});
			} else keep.set(id, mergeValue(`${name}[${id}]`, b.get(id), o.get(id), t.get(id), conflicts));
			continue;
		}
		const survivor = ov !== void 0 ? o.get(id) : t.get(id);
		const survivorValue = ov ?? tv;
		if (!inBase) keep.set(id, survivor);
		else if (bv === survivorValue) {} else {
			keep.set(id, survivor);
			conflicts.push({
				where: `${name}[${id}]`,
				reason: `deleted on one side and changed on the other — kept the changed ${ov !== void 0 ? "ours" : "theirs"}`
			});
		}
	}
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const list of [ours, theirs]) for (const obj of list ?? []) {
		const id = idOf(obj);
		if (id === void 0 || seen.has(id) || !keep.has(id)) continue;
		seen.add(id);
		out.push(keep.get(id));
	}
	return out;
}
/**
* Checks that only make sense once both sides are in one document. The file is
* well-formed either way — these are how a CLEAN merge still produces a broken
* design, so they are reported the same way as a structural conflict.
*/
/**
* The collections that OWN entities: each names, in a list, the entities it is
* made of. A pattern names its generated copies, a group its members, an
* operation the geometry it cuts.
*/
var OWNERS = [
	{
		key: "patterns",
		noun: "pattern",
		field: "instanceIds"
	},
	{
		key: "groups",
		noun: "group",
		field: "entityIds"
	},
	{
		key: "operations",
		noun: "toolpath",
		field: "entityIds"
	}
];
/** The entity ids one owner names, flattened — `instanceIds` nests one level. */
function ownedIds(owner, field) {
	const raw = owner?.[field];
	const out = /* @__PURE__ */ new Set();
	for (const v of Array.isArray(raw) ? raw : []) if (typeof v === "string") out.add(v);
	else if (Array.isArray(v)) {
		for (const x of v) if (typeof x === "string") out.add(x);
	}
	return out;
}
/**
* Entities a side put INTO a pattern, group or toolpath that the merged file
* leaves in no owner at all.
*
* These lists are merged whole (see mergeValue), so when both sides change one,
* ours wins and theirs' additions fall out of the owner — while the entities
* themselves, having unique ids, are kept as plain additions. The result is
* geometry that is still drawn and no longer belongs to anything:
*
* - two people regenerating one pattern keep BOTH sets of instances, and the
*   losing set becomes loose circles sitting exactly where the pattern is;
* - a shape added to a toolpath by the other branch stays in the drawing and is
*   NOT CUT, which is the quiet half of a wrong part;
* - a shape added to a rigid block comes loose and stops moving with it.
*
* The list conflict is reported already, but it says "entityIds changed on both
* sides" — nothing about the shape now missing from the job. Only ADDITIONS are
* reported: an entity a side deliberately removed from its group was meant to
* come loose, and flagging that would train people to ignore this.
*/
function orphanedEntities(ours, theirs, base, merged) {
	const stillPresent = new Set((merged.entities ?? []).map(idOf).filter((id) => !!id));
	const ownedNow = /* @__PURE__ */ new Set();
	for (const { key, field } of OWNERS) for (const owner of merged[key] ?? []) for (const id of ownedIds(owner, field)) ownedNow.add(id);
	const out = [];
	const reported = /* @__PURE__ */ new Set();
	for (const { key, noun, field } of OWNERS) {
		const baseOwners = byId(base[key]);
		for (const side of [ours, theirs]) for (const owner of side[key] ?? []) {
			const ownerId = idOf(owner);
			if (ownerId === void 0) continue;
			const wasOwned = ownedIds(baseOwners.get(ownerId), field);
			for (const id of ownedIds(owner, field)) {
				if (wasOwned.has(id)) continue;
				if (ownedNow.has(id) || !stillPresent.has(id) || reported.has(id)) continue;
				reported.add(id);
				out.push({
					where: `entities[${id}]`,
					reason: `added to ${noun} "${ownerId}" on one side and left out of the merged ${noun} — the shape is still in the design but belongs to nothing`
				});
			}
		}
	}
	return out;
}
function semanticConflicts(merged) {
	const out = [];
	const byName = /* @__PURE__ */ new Map();
	for (const v of merged.variables ?? []) {
		const name = v.name;
		const id = idOf(v);
		if (typeof name !== "string" || id === void 0) continue;
		byName.set(name, [...byName.get(name) ?? [], id]);
	}
	for (const [name, ids] of byName) if (ids.length > 1) out.push({
		where: `variables[${ids.join(", ")}]`,
		reason: `${ids.length} variables are named "${name}" — expressions reference a variable by name, so one of them has to be renamed`
	});
	for (const key of COLLECTIONS) {
		const ids = /* @__PURE__ */ new Set();
		for (const o of merged[key] ?? []) {
			const id = idOf(o);
			if (id === void 0) continue;
			if (ids.has(id)) out.push({
				where: `${key}[${id}]`,
				reason: "duplicate id after merge"
			});
			ids.add(id);
		}
	}
	return out;
}
/**
* Merge `ours` and `theirs` against their common ancestor `base`.
*
* Never throws and never returns half a file: on conflict the result still
* carries our version of the disputed object, so there is always something to
* open. `ok` is false when anything needs a person.
*/
function mergeRcam(base, ours, theirs) {
	const conflicts = [];
	const s = {};
	for (const key of SCALARS) s[key] = mergeValue(key, base[key], ours[key], theirs[key], conflicts);
	const c = {};
	for (const key of COLLECTIONS) c[key] = mergeCollection(key, base[key], ours[key], theirs[key], conflicts);
	const counter = Math.max(base.counter ?? 1, ours.counter ?? 1, theirs.counter ?? 1);
	const merged = {
		version: ours.version,
		name: s.name,
		canvas: s.canvas,
		displayUnit: s.displayUnit,
		stockThickness: s.stockThickness,
		...counter !== 1 ? { counter } : {},
		...s.stockRect ? { stockRect: s.stockRect } : {},
		origin: s.origin,
		...s.machineKind !== void 0 && s.machineKind !== "mill" ? { machineKind: s.machineKind } : {},
		...s.endPosition ? { endPosition: s.endPosition } : {},
		...s.toolChangePosition ? { toolChangePosition: s.toolChangePosition } : {},
		...s.flip ? { flip: s.flip } : {},
		...s.rotary ? { rotary: s.rotary } : {},
		...s.metadata ? { metadata: s.metadata } : {},
		groups: c.groups,
		...c.blockDefinitions.length ? { blockDefinitions: c.blockDefinitions } : {},
		...c.features.length ? { features: c.features } : {},
		layers: c.layers,
		activeLayerId: s.activeLayerId,
		entities: c.entities,
		constraints: c.constraints,
		dimensions: c.dimensions,
		variables: c.variables,
		bindings: c.bindings,
		patterns: c.patterns,
		operations: c.operations,
		tools: c.tools,
		...c.fonts.length ? { fonts: c.fonts } : {},
		...c.images.length ? { images: c.images } : {}
	};
	conflicts.push(...semanticConflicts(merged));
	conflicts.push(...orphanedEntities(ours, theirs, base, merged));
	nameConflicts(conflicts, base, ours, theirs);
	return {
		merged,
		conflicts,
		ok: conflicts.length === 0
	};
}
/** `entities[ent-x].p0.y` -> `["entities", "ent-x"]`; null for a bare scalar. */
function addressOf(where) {
	const m = /^([A-Za-z]+)\[([^\]]+)\]/.exec(where);
	return m ? [m[1], m[2]] : null;
}
/**
* Fill in {@link MergeConflict.what} for every conflict.
*
* Done in one pass at the end rather than at each `conflicts.push`, because the
* pushes happen deep inside `mergeValue`, where the field's value is in scope
* and the object that owns it is not. Looking the id back up here needs no
* plumbing through six call sites.
*
* The object is looked for in OURS first, then theirs, then base: a conflict
* about something deleted on our side still has to be describable, and the base
* is the last place it certainly existed.
*/
function nameConflicts(conflicts, base, ours, theirs) {
	const unit = ours.displayUnit === "in" ? "in" : "mm";
	const indexes = /* @__PURE__ */ new Map();
	const lookup = (collection, id) => {
		let idx = indexes.get(collection);
		if (!idx) {
			idx = [
				ours,
				theirs,
				base
			].map((f) => byId(f[collection]));
			indexes.set(collection, idx);
		}
		for (const m of idx) if (m.has(id)) return m.get(id);
	};
	for (const c of conflicts) {
		const addr = addressOf(c.where);
		if (addr) {
			const what = describeObject(addr[0], lookup(addr[0], addr[1]), unit);
			if (what) c.what = what;
		} else {
			const label = describeScalar(c.where);
			if (label) c.what = label;
		}
		addValues(c, addr, ours, theirs, unit);
	}
}
/** Follow a dotted path into an object; undefined if any step is missing. */
function walkPath(obj, path) {
	let cur = obj;
	for (const key of path) {
		if (cur === null || typeof cur !== "object") return void 0;
		cur = cur[key];
	}
	return cur;
}
/**
* Paths whose numbers are LENGTHS in millimetres, and so must be converted
* before they are shown next to a unit.
*
* Deliberately a short allow-list rather than "every number". `startAngle` and
* `angle` are numbers on the same entities and are not lengths; printing a
* radian count as "1.05 mm" would be the units bug this codebase has fixed
* three times, wearing a new hat. Anything not listed prints as stored, with no
* unit suffix, which cannot lie.
*/
var LENGTH_LEAVES = /* @__PURE__ */ new Set([
	"x",
	"y",
	"radius",
	"widthMM",
	"heightMM",
	"sizeMM"
]);
var LENGTH_ROOTS = /* @__PURE__ */ new Set([
	"stockThickness",
	"canvas",
	"stockRect",
	"endPosition",
	"toolChangePosition"
]);
function isLengthPath(collection, path) {
	const leaf = path[path.length - 1];
	if (collection === null) return LENGTH_ROOTS.has(path[0]);
	return collection === "entities" && LENGTH_LEAVES.has(leaf);
}
/** A conflicting value as a person should read it. */
function showValue(v, length, unit) {
	if (v === void 0) return "(absent)";
	if (v === null) return "none";
	if (typeof v === "number") return length ? `${fromMM(v, unit).toFixed(unit === "in" ? 3 : 2)} ${unit}` : String(v);
	if (typeof v === "string") return JSON.stringify(v);
	if (typeof v === "boolean") return String(v);
	return null;
}
/**
* Attach the two disagreeing values to a conflict, when there are two simple
* values to show.
*
* Read back out of the two source files by path rather than captured where the
* conflict is raised: `mergeValue` pushes from six places, and the values are
* already here in `ours` and `theirs`, addressed by the `where` string the
* conflict carries.
*/
function addValues(c, addr, ours, theirs, unit) {
	const rest = addr ? c.where.slice(`${addr[0]}[${addr[1]}]`.length).replace(/^\./, "") : c.where;
	if (!rest) return;
	const path = rest.split(".");
	const root = (f) => addr ? byId(f[addr[0]]).get(addr[1]) : f;
	const a = walkPath(root(ours), path);
	const b = walkPath(root(theirs), path);
	if (a === void 0 && b === void 0) return;
	const length = isLengthPath(addr ? addr[0] : null, path);
	const shownA = showValue(a, length, unit);
	const shownB = showValue(b, length, unit);
	if (shownA === null || shownB === null) return;
	if (shownA === shownB) return;
	c.ours = shownA;
	c.theirs = shownB;
}
//#endregion
//#region cli/mergeDriver.ts
/**
* The `.rcam` merge driver as a standalone program.
*
* `cli/rcam.ts merge` does the same job and more — it also runs the full
* `validate` pass on the result — but it needs this repository checked out and
* `tsx` to run it. rcam is a web app, so the people most likely to keep
* designs in git have neither. This entry exists to be BUILT into one
* dependency-free file (`dist/rcam-merge.mjs`, served from the site next to
* the schema and the format guide) that plain `node` can run:
*
*   git config merge.rcam.driver "node ~/rcam-merge.mjs %O %A %B"
*
* It is deliberately the smaller tier. The deep checks — dangling references,
* whether the constraint system still solves, whether the toolpaths still cut
* anything — live in `checkRcamText`, which pulls in the document model, the
* solver, the CAM stack, a schema validator and the bundled fonts. Bundling
* those here would be worse than not having them: without the font files a
* design dimensioned to the ink width of a word measures a DIFFERENT width and
* the checks would report confidently wrong numbers. So this merges, reports
* what the merge itself can see, and says where the rest lives.
*/
var USAGE = `rcam-merge — three-way merge for .rcam designs

  node rcam-merge.mjs <base> <ours> <theirs> [-o <out>]

Writes the merge over <ours> (what git's %A expects) unless -o is given, and
exits non-zero when something needs a person. As a git merge driver:

  git config merge.rcam.name "rcam .rcam merge"
  git config merge.rcam.driver "node /path/to/rcam-merge.mjs %O %A %B"
  echo "*.rcam merge=rcam" >> .gitattributes

For the deeper checks — dangling references, whether it still solves, whether
the toolpaths still cut — run \`rcam validate\` on the result.`;
/** Parse a `.rcam`, refusing anything this tier cannot safely handle. */
function read(path) {
	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch (e) {
		throw new Error(`cannot read ${path}: ${e.message}`);
	}
	let file;
	try {
		file = JSON.parse(text);
	} catch (e) {
		throw new Error(`${path} is not valid JSON: ${e.message}`);
	}
	const version = file?.version;
	if (version !== 3) throw new Error(`${path} is version ${String(version)}; this driver reads version 3. Open and re-save it in rcam first.`);
	return file;
}
function main(argv) {
	const args = argv.slice(2);
	if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
		console.log(USAGE);
		return args.length === 0 ? 2 : 0;
	}
	const [basePath, oursPath, theirsPath] = args;
	if (!basePath || !oursPath || !theirsPath) {
		console.error(`merge needs <base> <ours> <theirs>\n\n${USAGE}`);
		return 2;
	}
	const flag = args.indexOf("-o");
	const outPath = flag !== -1 && args[flag + 1] ? args[flag + 1] : oursPath;
	let result;
	try {
		result = mergeRcam(read(basePath), read(oursPath), read(theirsPath));
	} catch (e) {
		console.error(e.message);
		return 1;
	}
	writeFileSync(outPath, `${JSON.stringify(result.merged, null, 2)}\n`);
	for (const c of result.conflicts) {
		console.log(c.what ? `  ✗ ${c.what}` : `  ✗ ${c.where}`);
		console.log(`      ${c.reason}`);
		if (c.ours !== void 0) console.log(`      yours ${c.ours}  ·  theirs ${c.theirs}`);
		if (c.what) console.log(`      ${c.where}`);
	}
	if (result.ok) {
		console.log(`merged cleanly into ${outPath}`);
		return 0;
	}
	console.error(`\n${result.conflicts.length} conflict${result.conflicts.length === 1 ? "" : "s"} — review ${outPath} before committing.`);
	return 1;
}
if (process.argv[1] && /rcam-merge|mergeDriver/.test(process.argv[1])) process.exit(main(process.argv));
//#endregion
export { main };
