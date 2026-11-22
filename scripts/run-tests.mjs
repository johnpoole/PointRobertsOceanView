// Runs every page test: node scripts/run-tests.mjs, or npm test.
//
// The files are found here and not by a shell glob. `src/**/test-*.mjs` is not
// expanded on Windows, where it ran nothing, and under sh it matched only the
// files in src/scene and none of the ones in src.
//
// Each test file is a script that exits non-zero when it fails. One is a stand-in
// for three that other tests load, and is not a test.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOT_A_TEST = new Set(["test-three-stub.mjs"]);

const files = [];
for (const dir of ["src", "src/scene"]) {
  for (const name of fs.readdirSync(path.join(root, dir)).sort()) {
    if (/^test-.*\.mjs$/.test(name) && !NOT_A_TEST.has(name)) files.push(`${dir}/${name}`);
  }
}
if (!files.length) {
  console.error(`No test files were found under ${root}/src. Nothing was run.`);
  process.exit(1);
}

const failed = [];
for (const file of files) {
  const run = spawnSync(process.execPath, [file], { cwd: root, encoding: "utf8" });
  if (run.status === 0) {
    console.log(`ok    ${file}`);
    continue;
  }
  failed.push(file);
  console.log(`FAIL  ${file}`);
  process.stdout.write(run.stdout || "");
  process.stderr.write(run.stderr || "");
  if (run.error) console.error(`${file} could not be started: ${run.error.message}`);
}

console.log(`\n${files.length - failed.length} of ${files.length} test files passed.`);
if (failed.length) {
  console.error(`Failed: ${failed.join(", ")}`);
  process.exit(1);
}
