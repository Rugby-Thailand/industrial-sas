import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Exercise the published consumers of our scoped Zod overrides. Checking the
// validator alone would miss incompatibilities in the builders' actual schemas.
const require = createRequire(import.meta.url);
const vercelRequire = createRequire(require.resolve("vercel/package.json"));
const pythonRequire = createRequire(vercelRequire.resolve("@vercel/python"));
const analysisPath = pythonRequire.resolve("@vercel/python-analysis");
const schemas = pythonRequire("@vercel/python-analysis");

for (const name of ["backends", "express", "hono"]) {
  const builderRequire = createRequire(
    vercelRequire.resolve(`@vercel/${name}`),
  );
  assert.equal(builderRequire("zod/package.json").version, "4.6.6");
}
assert.equal(createRequire(analysisPath)("zod/package.json").version, "4.6.6");

const fixtures = [
  {
    name: "PyProjectTomlSchema",
    valid: {
      project: {
        name: "fixture",
        dependencies: ["fastapi>=0.100"],
        urls: { Homepage: "https://example.com" },
        "optional-dependencies": { test: ["pytest"] },
        entry_points: { console: { fixture: "fixture:main" } },
      },
      "dependency-groups": { dev: ["pytest", { "include-group": "lint" }] },
    },
    invalid: { project: { urls: { Homepage: 42 } } },
  },
  {
    name: "PipfileLikeSchema",
    valid: {
      packages: {
        requests: "*",
        fastapi: { version: "*", extras: ["standard"] },
      },
      scripts: { start: "python app.py" },
    },
    invalid: { packages: { requests: 42 } },
  },
  {
    name: "PipfileLockLikeSchema",
    valid: {
      _meta: { requires: { python_version: "3.12" } },
      default: {
        requests: { version: "==2.32.0", hashes: ["sha256:fixture"] },
      },
    },
    invalid: { default: { requests: { version: 42 } } },
  },
  {
    name: "UvConfigSchema",
    valid: {
      sources: { fixture: { path: "./fixture", editable: true } },
      workspace: { members: ["packages/*"], exclude: ["packages/legacy"] },
    },
    invalid: { sources: { fixture: { editable: "yes" } } },
  },
];

for (const { name, valid, invalid } of fixtures) {
  assert.deepEqual(schemas[name].parse(valid), valid, `${name}: parsed data`);
  const rejected = schemas[name].safeParse(invalid);
  assert.equal(rejected.success, false, `${name}: malformed configuration`);
  assert.ok(rejected.error.issues.length > 0, `${name}: configuration error`);
  assert.ok(Array.isArray(rejected.error.issues[0].path));
  assert.equal(typeof rejected.error.issues[0].message, "string");
}

console.log(
  "Release-tool Zod compatibility passed: four published schemas and scoped resolutions.",
);
