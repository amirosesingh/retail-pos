#!/usr/bin/env node
/**
 * Packages the whole POS into the Capacitor web folder.
 *
 * The app is server-rendered, so there is no static index.html lying around.
 * This script builds a Node server bundle, starts it once, renders the app
 * shell to HTML, and writes that plus every client asset into
 * `capacitor-shell/`. The result runs entirely on the phone: Android serves
 * the folder locally and the router takes over from there, so the till boots
 * and sells with no internet at all.
 */
const { spawnSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { withoutWebEnv, scrubWebEnv } = require("./web-only-env.cjs");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "capacitor-shell");
const PORT = Number(process.env["MOBILE_RENDER_PORT"] || 43119);


function run(script, args, env) {
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: { ...withoutWebEnv(), ...env },
  });
  if (res.error) throw res.error;
  if (res.status !== 0) process.exit(res.status ?? 1);
}


async function waitForServer(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`The build server never answered on ${url}`);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

/**
 * Web deployment names are removed from this process's environment (and from
 * every child it starts) by scripts/web-only-env.cjs, so a CI runner variable
 * cannot reach the phone bundle — on top of the empty `envDir` and the
 * `undefined` defines in vite.config.ts.
 */


function cleanOutputs() {
  for (const dir of ["dist", out, path.join(root, "android", "app", "build")]) {
    fs.rmSync(path.isAbsolute(dir) ? dir : path.join(root, dir), {
      recursive: true,
      force: true,
    });
  }
}

async function main() {
  scrubWebEnv();
  console.log("› clearing stale build output");
  cleanOutputs();
  console.log("› building the phone bundle");
  run(path.join(root, "node_modules", "vite", "bin", "vite.js"), ["build"], {
    MOBILE_BUILD: "1",
  });

  const serverEntry = path.join(root, "dist", "server", "index.mjs");
  const clientDir = path.join(root, "dist", "client");
  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      "Phone server bundle is missing at dist/server/index.mjs. " +
        "Confirm vite.config.ts gives MOBILE_BUILD=1 an explicit dist output.",
    );
  }
  if (!fs.existsSync(clientDir)) {
    throw new Error(
      "Phone client assets are missing at dist/client. " +
        "Confirm the mobile Nitro publicDir is configured as dist/client.",
    );
  }

  console.log("› rendering the app shell");
  const server = spawn(process.execPath, [serverEntry], {
    cwd: root,
    env: {
      ...withoutWebEnv(),
      PORT: String(PORT),
      HOST: "127.0.0.1",
      NITRO_PORT: String(PORT),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });


  server.on("error", (error) => {
    console.error(`Could not start the phone render server: ${error.message}`);
  });

  let html;
  try {
    html = await waitForServer(`http://127.0.0.1:${PORT}/`);
  } finally {
    server.kill("SIGKILL");
  }

  // The APK must carry no tenant identity. The render server may have had a
  // project address and key in its own environment; strip anything it printed
  // into the page so the phone starts blank and is provisioned per device.
  html = html.replace(/<script[^>]*>[^<]*__POS_CONFIG__[^<]*<\/script>/g, "");
  if (html.includes("__POS_CONFIG__")) {
    throw new Error(
      "The rendered shell still carries cloud configuration. The APK must ship no tenant identity.",
    );
  }

  fs.rmSync(out, { recursive: true, force: true });
  copyDir(clientDir, out);
  fs.writeFileSync(path.join(out, "index.html"), html, "utf8");
  // Android's local server falls back to index.html for unknown paths, but a
  // copy under 200.html keeps other hosts (and manual testing) happy too.
  fs.writeFileSync(path.join(out, "200.html"), html, "utf8");



  console.log(`✓ phone bundle ready in ${path.relative(root, out)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
