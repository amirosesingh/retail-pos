const fs = require('node:fs');
const path = require('node:path');

/** Validate UI resources, not runtime API endpoints inside application JS. */
function checkMobileInterface(root, html) {
  function asset(url) {
    if (/^(?:data:|#)/i.test(url)) return;
    if (/^(?:[a-z]+:)?\/\//i.test(url)) throw new Error('Android interface requires a remote asset: ' + url);
    const file = path.resolve(root, url.replace(/^\//, '').split(/[?#]/)[0]);
    if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file))
      throw new Error('Missing packaged Android interface asset: ' + url);
  }
  for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const value = /(?:src|href)=["']([^"']+)["']/i.exec(tag[0]);
    if (value && (tag[0].startsWith('<script') || /rel=["'](?:stylesheet|modulepreload|icon)["']/i.test(tag[0]))) asset(value[1]);
  }
  function styles(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) styles(file);
      else if (entry.name.endsWith('.css')) {
        const css = fs.readFileSync(file, 'utf8');
        if (/@import\s+["']https?:/i.test(css)) throw new Error('Remote stylesheet in Android interface.');
        for (const match of css.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) {
          if (/^(?:data:|#)/i.test(match[1])) continue;
          const url = match[1].startsWith('/') || /^(?:[a-z]+:)?\/\//i.test(match[1])
            ? match[1] : path.relative(root, path.resolve(path.dirname(file), match[1])).replaceAll('\\', '/');
          asset(url);
        }
      }
    }
  }
  styles(root);
}
module.exports = { checkMobileInterface };
