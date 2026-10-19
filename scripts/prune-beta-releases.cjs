/** Retain six published beta versions. Never recursively remove storage paths. */
const { execFileSync } = require('node:child_process');
const semver = require('semver');
const yaml = require('js-yaml');
const { assertBetaKey, originStore } = require('./publish-beta-release.cjs');
const PREFIX = 'pos-app/beta/';
const LIMIT = 6;
const VERSION = String.raw`\d+\.\d+\.\d+-beta\.[1-9]\d*`;
const valid = value => typeof value === 'string' && new RegExp(`^${VERSION}$`).test(value) && !!semver.valid(value);

function artifactVersion(key) {
  const archive = new RegExp(`^${PREFIX}releases/beta-v(${VERSION})-[a-f0-9]{7,40}/(.+)$`).exec(key);
  if (archive && valid(archive[1])) {
    const [ , version, file ] = archive;
    if (['release.json', `Retail Setup ${version}.exe`, `Retail Setup ${version}.exe.blockmap`, `android/Retail-${version}.apk`].includes(file)) return version;
  }
  const latest = new RegExp(`^${PREFIX}latest/(?:Retail Setup (${VERSION})\\.exe(?:\\.blockmap)?|(${VERSION})\\.yml|android/Retail-(${VERSION})\\.apk)$`).exec(key);
  const version = latest?.slice(1).find(Boolean);
  return valid(version) ? version : null;
}

function planRetention(releases, keys, active) {
  if (!valid(active)) throw new Error('Invalid active beta version.');
  const betas = releases.filter(r => r.prerelease === true && !r.draft &&
    typeof r.tag_name === 'string' && r.tag_name.startsWith('beta-v') && valid(r.tag_name.slice(6)))
    .map(r => ({ ...r, version: r.tag_name.slice(6) }));
  if (!betas.some(r => r.version === active)) throw new Error('Active beta has no published GitHub release; refusing cleanup.');
  if (betas.some(r => semver.gt(r.version, active))) throw new Error('A newer beta release exists; refusing stale cleanup.');
  const versions = [...new Set(betas.map(r => r.version))].sort(semver.rcompare);
  const keep = new Set(versions.slice(0, LIMIT));
  if (!keep.has(active)) throw new Error('Active beta would be removed.');
  const removeKeys = [...new Set(keys)].filter(key => {
    const version = artifactVersion(key);
    return version && !keep.has(version) && semver.lt(version, active);
  });
  return { keep: [...keep], removeKeys, removeReleases: betas.filter(r => !keep.has(r.version)) };
}

async function pruneBeta(store, github, expected) {
  const readVersion = async (key, parse = JSON.parse) => parse((await store.read(PREFIX + key)).toString()).version;
  const active = await readVersion('manifest.json');
  if (!valid(expected) || active !== expected) throw new Error('The advertised beta changed; refusing cleanup.');
  for (const [key, parse] of [['latest/manifest.json', JSON.parse], ['latest/android/latest.json', JSON.parse], ['latest/latest.yml', yaml.load]]) {
    if (await readVersion(key, parse) !== active) throw new Error('Beta update pointers disagree; refusing cleanup.');
  }
  const plan = planRetention(await github.list(), await store.list(), active);
  for (const key of plan.removeKeys) { assertBetaKey(key); await store.remove(key); }
  for (const release of plan.removeReleases) await github.remove(release.tag_name);
  console.log(`Beta retention: kept ${plan.keep.length} versions; removed ${plan.removeReleases.length} releases and ${plan.removeKeys.length} objects.`);
  return plan;
}

function githubStore(repository) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Invalid GitHub repository.');
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', windowsHide: true });
  return {
    list: () => JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`])).flat(),
    remove(tag) {
      if (!tag.startsWith('beta-v') || !valid(tag.slice(6))) throw new Error('Refusing non-beta GitHub deletion.');
      gh(['release', 'delete', tag, '--repo', repository, '--cleanup-tag', '--yes']);
    },
  };
}

module.exports = { LIMIT, artifactVersion, planRetention, pruneBeta };
if (require.main === module) pruneBeta(originStore(), githubStore(process.env.GITHUB_REPOSITORY), process.env.BETA_VERSION)
  .catch(error => { console.error(error.message); process.exitCode = 1; });
