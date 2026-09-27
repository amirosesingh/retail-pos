#!/usr/bin/env node

/** Fast, deterministic checks that catch incomplete conflict resolution. */
const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const fail = (message) => {
  console.error(`Merge readiness failed: ${message}`);
  process.exitCode = 1;
};

try {
  git("diff", "--check", "HEAD");
} catch (error) {
  fail(error.stdout || error.message);
}

if (git("ls-files", "-u").trim()) fail("the Git index contains unresolved files");

const textExtensions = /\.(?:cjs|js|jsx|mjs|ts|tsx|css|md|json|sql|toml|ya?ml)$/i;
for (const file of git("ls-files", "-z").split("\0").filter(Boolean)) {
  // A readiness check commonly runs while obsolete tracked files are staged
  // for deletion. They are no longer part of the candidate tree and cannot be
  // read from disk, so inspect only files that still exist.
  if (!existsSync(file) || !textExtensions.test(file) || file === "package-lock.json") continue;
  const contents = readFileSync(file, "utf8");
  if (/^(?:<<<<<<<|=======|>>>>>>>)(?: |$)/m.test(contents)) fail(`${file} contains a conflict marker`);
  if (/\.inputValidator\(/.test(contents)) fail(`${file} still uses deprecated inputValidator()`);
}

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const lockRoot = JSON.parse(readFileSync("package-lock.json", "utf8")).packages?.[""];
if (!lockRoot) fail("package-lock.json has no root package entry");
for (const group of ["dependencies", "optionalDependencies", "devDependencies"]) {
  for (const [name, version] of Object.entries(manifest[group] ?? {})) {
    if (lockRoot?.[group]?.[name] !== version) fail(`package-lock.json disagrees on ${name}`);
  }
}

if (!process.exitCode) console.log("Merge readiness checks passed.");
