const VALID_LINK_STYLES = ['smart', 'plain', 'wiki'];

function resolveLinkStyle({ isCloud = false, linkStyle = null } = {}) {
  if (VALID_LINK_STYLES.includes(linkStyle)) {
    return linkStyle;
  }
  return isCloud ? 'smart' : 'plain';
}

module.exports = { VALID_LINK_STYLES, resolveLinkStyle };
