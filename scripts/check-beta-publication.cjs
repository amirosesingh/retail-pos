const { execFileSync } = require("node:child_process");

function validRequest(event, ref, confirmation) {
  return (event === "workflow_dispatch" && ref === "refs/heads/beta" && confirmation === "Publish beta now") ||
    (event === "push" && /^refs\/tags\/beta-publish-\d{8}-\d{6}$/.test(ref));
}

function requirePassingChecks(pages, sha) {
  const checks = pages.flatMap(page => page.check_runs ?? [])
    .filter(check => check.name === "Role & permission regression checks" &&
      check.head_sha === sha && check.app?.slug === "github-actions")
    .sort((a, b) => b.id - a.id);
  if (!checks.length || checks[0].status !== "completed" || checks[0].conclusion !== "success")
    throw new Error("Beta publication requires completed, successful regression checks for this exact commit. Wait for checks or fix failures before requesting publication again.");
}

function main(env = process.env, run = execFileSync) {
  if (!validRequest(env.GITHUB_EVENT_NAME, env.GITHUB_REF ?? "", env.BETA_CONFIRMATION))
    throw new Error('Publication requires an owner-requested beta release tag or the explicit "Publish beta now" dispatch on beta.');
  const sha = env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("A full source commit is required.");
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? "")) throw new Error("Invalid repository.");
  run("git", ["fetch", "origin", "beta"], { stdio: "pipe" });
  // A release tag may only select a commit already merged into beta.
  run("git", ["merge-base", "--is-ancestor", sha, "refs/remotes/origin/beta"], { stdio: "pipe" });
  const pages = JSON.parse(run("gh", ["api", `repos/${env.GITHUB_REPOSITORY}/commits/${sha}/check-runs?per_page=100`, "--paginate", "--slurp"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
  requirePassingChecks(pages, sha);
  console.log(`Explicit beta publication validated for ${sha}.`);
}

if (require.main === module) main();
module.exports = { validRequest, requirePassingChecks, main };
