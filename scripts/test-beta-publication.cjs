const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const yaml = require("js-yaml");
const { validRequest, requirePassingChecks, main } = require("./check-beta-publication.cjs");
const sha = "a".repeat(40);
const check = (overrides = {}) => ({ id: 1, name: "Role & permission regression checks", head_sha: sha, app: { slug: "github-actions" }, status: "completed", conclusion: "success", ...overrides });

test("normal pushes and unconfirmed/wrong-branch dispatches cannot publish", () => {
  for (const ref of ["refs/heads/beta", "refs/heads/main", "refs/heads/codex/fix", "refs/tags/v1.4.75", "refs/tags/beta-v1.4.75-beta.1", "refs/tags/beta-publish-invalid"])
    assert.equal(validRequest("push", ref), false);
  assert.equal(validRequest("workflow_dispatch", "refs/heads/beta", "yes"), false);
  assert.equal(validRequest("workflow_dispatch", "refs/heads/main", "Publish beta now"), false);
  assert.equal(validRequest("workflow_dispatch", "refs/heads/beta", "Publish beta now"), true);
  assert.equal(validRequest("push", "refs/tags/beta-publish-20261019-050000"), true);
});

test("requires the latest successful check on the exact source commit", () => {
  requirePassingChecks([{ check_runs: [check()] }], sha);
  for (const checks of [[], [check({ head_sha: "b".repeat(40) })], [check({ app: { slug: "other" } })], [check({ conclusion: "failure" })], [check(), check({ id: 2, status: "in_progress", conclusion: null })]])
    assert.throws(() => requirePassingChecks([{ check_runs: checks }], sha), /successful regression checks/);
  requirePassingChecks([{ check_runs: [check({ conclusion: "failure" })] }, { check_runs: [check({ id: 2 })] }], sha);
});

test("preflight checks beta ancestry before reading status and never publishes", () => {
  const calls = [];
  const env = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/beta-publish-20261019-050000", GITHUB_SHA: sha, GITHUB_REPOSITORY: "owner/repo" };
  main(env, (command, args) => { calls.push([command, args]); return command === "gh" ? JSON.stringify([{ check_runs: [check()] }]) : ""; });
  assert.deepEqual(calls.slice(0, 2), [["git", ["fetch", "origin", "beta"]], ["git", ["merge-base", "--is-ancestor", sha, "refs/remotes/origin/beta"]]]);
  assert.equal(calls.length, 3);
  assert.throws(() => main(env, () => { throw new Error("not on beta"); }), /not on beta/);
  assert.throws(() => main({ ...env, GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/beta" }, () => { throw Error("must not execute"); }), /Publication requires/);
});

test("workflow keeps checks automatic but publishes paired beta apps only by request", () => {
  const workflow = yaml.load(fs.readFileSync(".github/workflows/beta-release.yml", "utf8"));
  const ci = yaml.load(fs.readFileSync(".github/workflows/ci.yml", "utf8"));
  assert.deepEqual(workflow.on.push, { tags: ["beta-publish-*"] });
  assert.equal(workflow.on.workflow_dispatch.inputs.confirmation.required, true);
  assert.ok(ci.on.push.branches.includes("beta"));
  assert.equal(workflow.jobs.android.needs, "prepare");
  assert.equal(workflow.jobs.windows.needs, "prepare");
  assert.deepEqual(workflow.jobs.publish.needs, ["prepare", "windows", "android", "ios"]);
  assert.equal(workflow.jobs.android.with.release_channel, "beta");
  assert.equal(workflow.jobs.windows.with.release_channel, "beta");
  assert.ok(workflow.jobs.prepare.steps.find(step => step.run === "node scripts/check-beta-publication.cjs"));
});

for (const name of ["android-apk.yml", "desktop-release.yml"]) {
  test(`${name} resolves explicit beta tags without weakening stable tag validation`, () => {
    const { spawnSync } = require("node:child_process");
    const os = require("node:os"), path = require("node:path");
    const workflow = yaml.load(fs.readFileSync(`.github/workflows/${name}`, "utf8"));
    const job = Object.values(workflow.jobs)[0];
    const source = job.steps.find(step => step.name === "Resolve release identity").run;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "beta-identity-"));
    const output = path.join(directory, "identity.txt");
    const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
    const version = require("../package.json").version;
    try {
      for (const [channel, ref, expected] of [["beta", "beta-publish-20261019-050000", 0], ["stable", `v${version}`, 0], ["stable", "v0.0.0", 1]]) {
        const script = source.replaceAll("${{ startsWith(github.ref, 'refs/tags/') }}", "true").replaceAll("${{ github.ref_name }}", ref).replaceAll("${{ inputs.beta_number }}", "10");
        const result = spawnSync(bash, ["-e", "-c", script], { encoding: "utf8", env: { ...process.env, RELEASE_CHANNEL: channel, BETA_VERSION: "1.4.75-beta.10", GITHUB_SHA: sha, GITHUB_OUTPUT: output.replaceAll("\\", "/") } });
        assert.equal(result.status, expected, result.stderr || result.stdout);
        if (channel === "beta") assert.match(fs.readFileSync(output, "utf8"), /tag=beta-v1\.4\.75-beta\.10/);
        if (fs.existsSync(output)) fs.unlinkSync(output);
      }
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
}
