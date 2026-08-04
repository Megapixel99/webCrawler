function parse(text, userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  const groups = [];
  let current = null;
  let lastWasAgent = false;

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();


    if (field === 'user-agent') {
      if (!lastWasAgent || current === null) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (current === null) continue;

    if (field === 'disallow') {
      current.rules.push({ allow: false, path: value });
    } else if (field === 'allow') {
      current.rules.push({ allow: true, path: value });
    } else if (field === 'crawl-delay') {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        current.crawlDelay = seconds;
      }
    }
  }


  const specific = groups.find((g) =>
    g.agents.some((a) => a !== '*' && a.length > 0 && ua.includes(a)));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  const group = specific || wildcard;

  return group === undefined
    ? { rules: [], crawlDelay: null }
    : { rules: group.rules, crawlDelay: group.crawlDelay };
}

function matchLength(pattern, path) {
  if (!pattern) return -1;
  let anchored = pattern.endsWith('$');
  let pat = anchored ? pattern.slice(0, -1) : pattern;
  if (pat.endsWith('*')) anchored = false;

  const segments = pat.split('*');
  if (!path.startsWith(segments[0])) return -1;
  let pos = segments[0].length;

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '') continue;
    if (anchored && i === segments.length - 1) {
      if (!path.endsWith(seg) || path.length - seg.length < pos) return -1;
      pos = path.length;
    } else {
      const at = path.indexOf(seg, pos);
      if (at === -1) return -1;
      pos = at + seg.length;
    }
  }

  if (anchored && pos !== path.length) return -1;
  return pattern.length;
}

function isAllowed(rules, path) {
  let best = null;
  for (const rule of rules) {
    const length = matchLength(rule.path, path);
    if (length < 0) continue;
    if (best === null || length > best.length || (length === best.length && rule.allow)) {
      best = { allow: rule.allow, length };
    }
  }
  return best === null ? true : best.allow;
}

module.exports = { parse, isAllowed };
