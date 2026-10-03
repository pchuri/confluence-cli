const VALID_LINK_STYLES = ['smart', 'plain', 'wiki', 'auto'];

function resolveLinkStyle({ isCloud = false, linkStyle = null } = {}) {
  if (VALID_LINK_STYLES.includes(linkStyle)) {
    return linkStyle;
  }
  return isCloud ? 'smart' : 'plain';
}

// Builds the predicate behind `linkStyle: 'auto'`: true only for absolute
// hrefs that point at the configured Confluence site. Origin and path are
// compared on the parsed URL, with a path-segment boundary, so look-alikes
// such as `https://wiki.example.com.evil.test/` or `/wikiother` do not match.
// Without a resolvable site (offline conversion) or for relative hrefs it
// returns false, which `auto` renders as a plain link.
function createInternalLinkMatcher({ webUrlPrefix = '', buildUrl = null } = {}) {
  if (typeof buildUrl !== 'function') return () => false;
  let base;
  try {
    base = new URL(buildUrl(webUrlPrefix || '/'));
  } catch {
    return () => false;
  }
  const basePath = base.pathname.replace(/\/+$/, '');
  return (href) => {
    let url;
    try {
      url = new URL(href);
    } catch {
      return false;
    }
    return url.origin === base.origin
      && (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`));
  };
}

module.exports = { VALID_LINK_STYLES, resolveLinkStyle, createInternalLinkMatcher };
