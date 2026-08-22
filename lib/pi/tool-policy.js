const TOOL_TO_OPERATION = Object.freeze({
  confluence_read: 'read',
  confluence_search: 'search',
  confluence_info: 'info',
  confluence_spaces: 'spaces',
  confluence_children: 'children',
  confluence_export: 'export',
  confluence_convert: 'convert',
});

const TOOL_OPERATIONS = Object.freeze(Object.keys(TOOL_TO_OPERATION));

module.exports = { TOOL_OPERATIONS, TOOL_TO_OPERATION };
