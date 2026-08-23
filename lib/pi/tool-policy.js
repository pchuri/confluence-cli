const { getOperation, listToolNames } = require('./operation-policy');

const TOOL_OPERATIONS = Object.freeze(listToolNames({ includeWrites: false }));
const TOOL_TO_OPERATION = Object.freeze(Object.fromEntries(
  TOOL_OPERATIONS.map((toolName) => [toolName, getOperation(toolName).cliCommand]),
));

module.exports = { TOOL_OPERATIONS, TOOL_TO_OPERATION };
