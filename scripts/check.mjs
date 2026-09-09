// SPDX-License-Identifier: MIT
//
// Self-check for the public rcam-format mirror. The mirror is derived from the
// rcam source repository (which runs the full schema drift guard before
// publishing anything here), so this script only re-checks what a published
// tree must hold: the schema is intact, every example parses and declares
// version 3, the generated index matches the files on disk, and no hand edit
// has reintroduced a source-repo-only path. No dependencies; run
// `node scripts/check.mjs`.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const fail = (message) => failures.push(message);

const read = (rel) => readFileSync(join(root, rel), "utf8");
const parse = (rel) => {
  try {
    return JSON.parse(read(rel));
  } catch (error) {
    fail(`${rel}: not valid JSON (${error.message})`);
    return null;
  }
};

// --- The schema is the contract; its $id is permanent. ---
const schema = parse("schema/rcam-v3.schema.json");
if (schema) {
  if (schema.$id !== "https://rcamhub.com/schema/rcam-v3.schema.json") {
    fail(`schema $id is ${schema.$id}, expected https://rcamhub.com/schema/rcam-v3.schema.json`);
  }
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    fail(`schema $schema is ${schema.$schema}, expected draft 2020-12`);
  }
  if (schema.properties?.version?.const !== 3) {
    fail("schema must declare version as const 3");
  }
}

// --- Entity / operation types the schema enumerates — the parity the source ---
// --- repo tests against code, re-derived here from the schema itself.       ---
const entityTypes = new Set();
if (schema?.$defs?.entity?.oneOf) {
  for (const ref of schema.$defs.entity.oneOf) {
    const name = ref.$ref.split("/").pop();
    const type = schema.$defs[name]?.properties?.type?.const;
    if (type) entityTypes.add(type);
  }
}
if (entityTypes.size === 0) fail("could not derive entity types from $defs.entity.oneOf");
const operationTypes = new Set(schema?.$defs?.operation?.properties?.type?.enum ?? []);
if (operationTypes.size === 0) fail("could not derive operation types from $defs.operation.properties.type.enum");

// --- Examples: present, parse, version 3, and use known types. ---
const examples = readdirSync(join(root, "examples"))
  .filter((f) => f.endsWith(".rcam"))
  .sort();
if (examples.length === 0) fail("examples/ has no .rcam files");
for (const name of examples) {
  const doc = parse(`examples/${name}`);
  if (!doc) continue;
  if (doc.version !== 3) fail(`examples/${name}: version ${doc.version}, expected 3`);
  for (const entity of doc.entities ?? []) {
    if (entity?.type && !entityTypes.has(entity.type)) {
      fail(`examples/${name}: entity type "${entity.type}" is not in the schema`);
    }
  }
  for (const op of doc.operations ?? []) {
    if (op?.type && !operationTypes.has(op.type)) {
      fail(`examples/${name}: operation type "${op.type}" is not in the schema`);
    }
  }
}

// --- The generated index must name exactly the files on disk. ---
const index = parse("examples/index.json");
if (index) {
  const listed = Array.isArray(index) ? [...index].sort() : null;
  if (!listed || JSON.stringify(listed) !== JSON.stringify(examples)) {
    fail("examples/index.json does not match the .rcam files in examples/");
  }
}

// --- Text artifacts must exist and be non-trivial. ---
for (const rel of ["llms.txt", "llms-full.txt", "rcam-merge.mjs"]) {
  if (!existsSync(join(root, rel))) fail(`${rel} is missing`);
  else if (read(rel).trim().length < 20) fail(`${rel} looks empty`);
}
for (const rel of ["docs/rcam-format-v3.md", "docs/ai-integration.md", "docs/version-control.md"]) {
  if (!existsSync(join(root, rel))) fail(`${rel} is missing`);
}

// --- The mirror layout must not leak source-repo-only paths. ---
for (const rel of ["docs/rcam-format-v3.md", "docs/ai-integration.md", "docs/version-control.md"]) {
  if (read(rel).includes("public/schema")) {
    fail(`${rel} still references public/schema — the mirror rewrite did not apply`);
  }
}

// --- Every relative markdown link must resolve inside the mirror. ---
const markdownFiles = [
  "README.md",
  "docs/rcam-format-v3.md",
  "docs/ai-integration.md",
  "docs/version-control.md",
];
for (const rel of markdownFiles) {
  const text = read(rel);
  const base = dirname(join(root, rel));
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].trim();
    if (/^(https?:|#|mailto:)/.test(target)) continue; // absolute or anchor
    const [pathPart] = target.split("#");
    if (pathPart === "") continue;
    if (!existsSync(resolve(base, pathPart))) {
      fail(`${rel}: link "${target}" does not resolve`);
    }
  }
}

if (failures.length > 0) {
  console.error("rcam-format self-check failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`rcam-format self-check OK (${examples.length} examples).`);
