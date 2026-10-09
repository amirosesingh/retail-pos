/** Read-only display data. Never accept installer commands or URLs from history. */
function parseHistory(raw) {
  const data = JSON.parse(raw);
  if (!Array.isArray(data.releases)) throw new Error('Invalid release history.');
  const releases = data.releases.filter(r => r && /^\d+\.\d+\.\d+$/.test(r.version) &&
    ['successful', 'legacy-published'].includes(r.status)).slice(0, 100).map(r => ({
    version: r.version, released: typeof r.released === 'string' ? r.released.slice(0, 40) : '',
    status: r.status, notes: typeof r.notes === 'string' ? r.notes.slice(0, 4000) : '',
  }));
  releases.sort((a,b) => { const av=a.version.split('.').map(Number),bv=b.version.split('.').map(Number); return bv[0]-av[0] || bv[1]-av[1] || bv[2]-av[2]; });
  return releases;
}
module.exports = { parseHistory };
