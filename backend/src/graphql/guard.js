// GraphQL request analysis using the real graphql-js parser (never regular expressions).
// Used for BridgeX's own /graphql endpoint, for forwarding to upstream GraphQL integrations and for
// API-key traffic to GraphQL-protocol gateway APIs, so all three enforce the same limits.
const { parse, Kind, getOperationAST, GraphQLError } = require('graphql');
const env = require('../config/env');

class GraphqlRequestError extends Error {
  constructor(code, message, status = 400, extensions = {}) {
    super(message);
    this.name = 'GraphqlRequestError';
    this.code = code;
    this.status = status;
    this.extensions = extensions;
  }
}

const LIST_SIZE_ARGS = new Set(['first', 'last', 'limit', 'take', 'pageSize', 'per_page']);
const MAX_LIST_MULTIPLIER = 100;

function fragmentMap(doc) {
  const m = new Map();
  for (const def of doc.definitions) if (def.kind === Kind.FRAGMENT_DEFINITION) m.set(def.name.value, def);
  return m;
}

function listMultiplier(field, variables) {
  for (const arg of field.arguments || []) {
    if (!LIST_SIZE_ARGS.has(arg.name.value)) continue;
    if (arg.value.kind === Kind.INT) return Math.min(MAX_LIST_MULTIPLIER, Math.max(1, parseInt(arg.value.value, 10)));
    if (arg.value.kind === Kind.VARIABLE && variables && Number.isInteger(variables[arg.value.name.value])) {
      return Math.min(MAX_LIST_MULTIPLIER, Math.max(1, variables[arg.value.name.value]));
    }
  }
  return 1;
}

/**
 * Walks a selection set (following fragments, cycle-safe) and returns { depth, cost, introspection }.
 * depth = nesting of fields; cost = number of fields, with children of a list-limited field multiplied
 * by that limit (capped), so `users(first: 100) { friends(first: 100) { name } }` is expensive.
 */
function measure(selectionSet, fragments, variables, stack = new Set()) {
  let depth = 0; let cost = 0; let introspection = false;
  for (const sel of selectionSet.selections) {
    if (sel.kind === Kind.FIELD) {
      const name = sel.name.value;
      if (name === '__schema' || name === '__type') introspection = true;
      let childDepth = 0; let childCost = 0;
      if (sel.selectionSet) {
        const m = measure(sel.selectionSet, fragments, variables, stack);
        childDepth = m.depth; childCost = m.cost; introspection = introspection || m.introspection;
      }
      depth = Math.max(depth, 1 + childDepth);
      cost += 1 + childCost * listMultiplier(sel, variables);
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      const m = measure(sel.selectionSet, fragments, variables, stack);
      depth = Math.max(depth, m.depth); cost += m.cost; introspection = introspection || m.introspection;
    } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
      const frag = fragments.get(sel.name.value);
      if (!frag) throw new GraphqlRequestError('GRAPHQL_VALIDATION_FAILED', `Unknown fragment "${sel.name.value}".`);
      if (stack.has(sel.name.value)) throw new GraphqlRequestError('GRAPHQL_VALIDATION_FAILED', `Fragment "${sel.name.value}" forms a cycle.`);
      stack.add(sel.name.value);
      const m = measure(frag.selectionSet, fragments, variables, stack);
      stack.delete(sel.name.value);
      depth = Math.max(depth, m.depth); cost += m.cost; introspection = introspection || m.introspection;
    }
  }
  return { depth, cost, introspection };
}

/**
 * Parses and measures a GraphQL request. Throws GraphqlRequestError (always status 400 unless noted).
 * Returns { document, operation: { type, name }, depth, complexity, introspection }.
 */
function analyze({ query, operationName, variables }, limits = {}) {
  const maxBytes = limits.maxBytes || env.GRAPHQL_MAX_QUERY_BYTES;
  const maxDepth = limits.maxDepth || env.GRAPHQL_MAX_DEPTH;
  const maxComplexity = limits.maxComplexity || env.GRAPHQL_MAX_COMPLEXITY;

  if (typeof query !== 'string' || query.trim() === '') {
    throw new GraphqlRequestError('GRAPHQL_PARSE_FAILED', 'A GraphQL query string is required.');
  }
  if (Buffer.byteLength(query, 'utf8') > maxBytes) {
    throw new GraphqlRequestError('PAYLOAD_TOO_LARGE', `The GraphQL query exceeds the maximum size of ${maxBytes} bytes.`, 413);
  }
  let document;
  try {
    document = parse(query, { maxTokens: 10000, noLocation: true });
  } catch (err) {
    if (err instanceof GraphQLError) throw new GraphqlRequestError('GRAPHQL_PARSE_FAILED', `Syntax error: ${err.message.replace(/^Syntax Error:\s*/, '')}`);
    throw err;
  }
  const operations = document.definitions.filter((d) => d.kind === Kind.OPERATION_DEFINITION);
  if (operations.length === 0) throw new GraphqlRequestError('GRAPHQL_VALIDATION_FAILED', 'The document contains no operation.');
  if (operations.length > 1 && !operationName) {
    throw new GraphqlRequestError('GRAPHQL_VALIDATION_FAILED', 'operationName is required when the document contains multiple operations.');
  }
  const op = getOperationAST(document, operationName || undefined);
  if (!op) throw new GraphqlRequestError('GRAPHQL_VALIDATION_FAILED', `Unknown operation "${String(operationName).slice(0, 80)}".`);

  const { depth, cost, introspection } = measure(op.selectionSet, fragmentMap(document), variables);
  if (depth > maxDepth) throw new GraphqlRequestError('GRAPHQL_QUERY_TOO_DEEP', `The query depth (${depth}) exceeds the maximum of ${maxDepth}.`, 400, { depth, maxDepth });
  if (cost > maxComplexity) throw new GraphqlRequestError('GRAPHQL_QUERY_TOO_COMPLEX', `The query complexity (${cost}) exceeds the maximum of ${maxComplexity}.`, 400, { complexity: cost, maxComplexity });

  return { document, operation: { type: op.operation, name: op.name ? op.name.value : null }, depth, complexity: cost, introspection };
}

module.exports = { analyze, GraphqlRequestError };
