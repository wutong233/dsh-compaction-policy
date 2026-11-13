/**
 * dsh-compaction-policy — keep one compaction policy applied to every agent
 * preset across DSH upgrades, and let the person edit that policy from the
 * Web UI instead of hand-editing YAML.
 *
 * Why this exists: `dsh-web-app` disables the host-plane compaction trio, so the
 * instance an Agent really uses lives inside its preset. A Loader patch replaces
 * a row's whole `config`, so applying a policy means restating that preset's
 * complete plugin list — which silently goes stale whenever DSH ships a new
 * preset (new tools, renamed packages, changed plugin order).
 *
 * This plugin owns a marked region of the profile patch and regenerates it from
 * the preset files of the *installed* DSH on every start. Nothing is restated by
 * hand, and nothing is parsed: the shipped YAML is transformed textually, so
 * `!!js` expressions, nested groups and future plugins survive byte-for-byte.
 *
 * The rewrite is applied by the next start, never mid-boot: the running tree is
 * left alone, so a bad regenerate cannot destabilize a live session.
 *
 * Settings: the browser half (`./client`) renders every field of the policy in
 * Settings → Compaction. It talks to the route registered here, which validates
 * each value, writes `compaction-policy.json` beside the profile patch, and
 * regenerates the managed region in the same save. The file is the only thing
 * this plugin writes besides the region, so it never competes with the Loader
 * for the profile patch: `configEditor.edit` would restart this very plugin and
 * its start-time rewrite then raced the Loader's own write.
 *
 * An explicit `config.policy` in the profile patch still wins over the file —
 * the hand-written escape hatch — and the page marks such fields as pinned.
 *
 * One setting is deliberately not a preset override: the summary's thinking
 * level. DSH has no `compaction-basic` key for it, so it rides the `llm/stream`
 * waterfall and touches only calls that declare `purpose: 'compaction'` — never
 * the provider default, which every request through that route shares.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const name = 'compaction-policy';
export const inject = ['profileContext'];

const BEGIN = '# >>> dsh-compaction-policy — managed block, regenerated on start; edit nothing inside';
const END = '# <<< dsh-compaction-policy';

/** Profile patch id of this plugin's own row; also the row the UI edits. */
export const ENTRY_ID = 'compaction-policy';

/** Default policy applied to every preset's existing `compaction-basic` entry. */
const DEFAULT_POLICY = {
  thresholdRatio: 0.38,
  headroomTokens: 65536,
  retainTokens: 140000,
  maxTokens: 24576,
  compactionRetries: 1,
  maxOverflowRetries: 1,
  auto: true,
  summarizationProvider: '',
  summarizationModel: '',
};

const DEFAULT_PRESETS = ['standard', 'ptc', 'minimal', 'cordis'];

/**
 * Thinking levels a summary may ask for, weakest first; `''` asks for none and
 * lets the route's own default decide. This is pi-ai's vocabulary, so a level
 * some proxy would accept but DSH does not is never offered.
 */
const EFFORT_LEVELS = ['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * The one setting that is not a `compaction-basic` field: the thinking level of
 * the summary call itself. `compaction-basic` has no config key for it, so this
 * travels through the `llm/stream` hook below instead of the preset override.
 */
const DEFAULT_SUMMARIZATION = { reasoningEffort: 'high' };

/** Thinking level the `llm/stream` hook applies; refreshed on every start and save. */
const live = { reasoningEffort: DEFAULT_SUMMARIZATION.reasoningEffort };

/**
 * Field contracts shared with the browser half, which renders one control per
 * entry. Validation here is authoritative: the route refuses a value the Host
 * would not accept, so a bad form submission never reaches the patch.
 */
const POLICY_FIELDS = {
  thresholdRatio: { kind: 'ratio', min: 0.01, max: 1 },
  headroomTokens: { kind: 'integer', min: 0, max: 10_000_000 },
  retainTokens: { kind: 'integer', min: 0, max: 10_000_000 },
  maxTokens: { kind: 'integer', min: 1, max: 1_000_000 },
  compactionRetries: { kind: 'integer', min: 0, max: 20 },
  maxOverflowRetries: { kind: 'integer', min: 0, max: 20 },
  auto: { kind: 'boolean' },
  // Optional routing for the summary itself. Empty means "the session's own
  // route"; DSH accepts the pair only together, so both travel or neither does.
  summarizationProvider: { kind: 'text' },
  summarizationModel: { kind: 'text' },
};

/**
 * Locate the installed `@deepseek-ai/dsh-web-app` package that ships the presets.
 * Prefers the application archive; falls back to module resolution, which covers
 * a source checkout and a plain Node install.
 * @returns Directory holding `presets/*.patch.yml`.
 */
function webAppDir() {
  const roots = [];
  if (process.resourcesPath) roots.push(join(process.resourcesPath, 'app.asar'), join(process.resourcesPath, 'app'));
  roots.push(join(dirname(process.execPath), 'resources', 'app.asar'));
  for (const root of roots) {
    const dir = join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-app');
    if (existsSync(join(dir, 'presets'))) return dir;
  }
  try {
    const require = createRequire(import.meta.url);
    for (const specifier of ['@deepseek-ai/dsh-web-app/package.json', '@deepseek-ai/dsh-web-app']) {
      try {
        const resolved = require.resolve(specifier);
        const dir = resolved.endsWith('package.json') ? dirname(resolved) : dirname(dirname(resolved));
        if (existsSync(join(dir, 'presets'))) return dir;
      } catch {
        // try the next specifier
      }
    }
  } catch {
    // resolution unavailable in this runtime
  }
  return undefined;
}

/** Render one policy value as a YAML scalar: numbers and booleans bare, text quoted. */
function formatScalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return "'" + String(value).replace(/'/g, "''") + "'";
}

/**
 * Turn one shipped preset file into the profile-patch override for it.
 *
 * The shipped file is `- insert: [<row>]`; the patch needs `<row>` at column 0.
 * The shipped row keeps every plugin; only `compaction-basic` gains a `config`.
 * @param shipped - Raw YAML text of `presets/<id>.patch.yml`.
 * @param policy - Resolved policy fields to inject.
 * @returns Override YAML text, or undefined when the preset has no compaction group.
 */
function buildOverride(shipped, policy) {
  const lines = shipped.split(/\r?\n/);
  const insertAt = lines.findIndex((line) => /^-\s+insert:\s*$/.test(line));
  if (insertAt < 0) throw new Error('shipped preset is not an `- insert:` patch');
  const body = lines.slice(insertAt + 1).map((line) => (line.startsWith('    ') ? line.slice(4) : line));
  while (body.length && body[body.length - 1].trim() === '') body.pop();
  if (!body.some((line) => line.trim() === '- id: compaction-basic')) return undefined;

  const out = [];
  for (let i = 0; i < body.length; i += 1) {
    const line = body[i];
    out.push(line);
    if (line.trim() !== '- id: compaction-basic') continue;
    const indent = line.length - line.trimStart().length;
    const pad = ' '.repeat(indent + 2);
    // Skip the shipped `name:` line; it is restated so the entry stays readable.
    if (body[i + 1]?.trim().startsWith('name:')) {
      out.push(body[i + 1]);
      i += 1;
    }
    out.push(pad + 'config:');
    for (const [key, value] of Object.entries(policy)) {
      if (value === undefined || value === '') continue;
      out.push(pad + '  ' + key + ': ' + formatScalar(value));
    }
  }
  return out.join('\n');
}

/** Serialize the full managed region for the presets that have a compaction group. */
function buildRegion(presets, policy, dir) {
  const blocks = [];
  const skipped = [];
  for (const preset of presets) {
    const file = join(dir, 'presets', preset + '.patch.yml');
    if (!existsSync(file)) {
      skipped.push(preset + ' (not shipped)');
      continue;
    }
    const override = buildOverride(readFileSync(file, 'utf8'), policy);
    if (override === undefined) {
      skipped.push(preset + ' (no compaction group)');
      continue;
    }
    blocks.push('# preset ' + preset + ', regenerated from the installed DSH\n' + override);
  }
  if (!blocks.length) return { text: undefined, skipped };
  return { text: BEGIN + '\n' + blocks.join('\n\n') + '\n' + END, skipped };
}

/** Replace the managed region, or append it when absent. */
function splice(current, region) {
  const begin = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  if (begin >= 0 && end > begin) {
    return current.slice(0, begin) + region + current.slice(end + END.length);
  }
  const trimmed = current.replace(/\s*$/, '');
  // A fresh profile patch parses as the empty sequence `[]`; appending entries
  // after it reads as a second YAML document and fails to load, so replace it.
  const meaningful = trimmed
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('')
    .replace(/[\s-]/g, '');
  if (meaningful === '' || meaningful === '[]') return region + '\n';
  return trimmed + '\n\n' + region + '\n';
}

/** Atomic replace so a crash never leaves a half-written profile patch. */
function writeAtomic(file, content) {
  const tmp = file + '.compaction-policy.tmp';
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
}

/**
 * Regenerate the managed region in one profile patch.
 *
 * Exported so the same logic can run outside a boot: an installer, a test, or a
 * manual `node -e "import('dsh-compaction-policy').then(m => m.sync(...))"`.
 * @param options - `{ patchPath, presets?, policy?, logger? }`.
 * @returns `{ changed, written, skipped, presets }`.
 */
export async function sync(options) {
  const { patchPath, presets = DEFAULT_PRESETS, policy = DEFAULT_POLICY, logger } = options ?? {};
  if (!patchPath) throw new Error('compaction-policy: patchPath is required');
  const dir = webAppDir();
  if (dir === undefined) throw new Error('compaction-policy: cannot locate @deepseek-ai/dsh-web-app presets');
  const resolved = { ...DEFAULT_POLICY, ...policy };
  const { text, skipped } = buildRegion(presets, resolved, dir);
  if (text === undefined) {
    logger?.warn?.('compaction-policy: no shipped preset has a compaction group; nothing written');
    return { changed: false, written: false, skipped, presets: [] };
  }
  if (skipped.length) logger?.info?.('compaction-policy: skipped ' + skipped.join(', '));

  const current = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
  const next = splice(current, text);
  const written = next !== current;
  if (written) writeAtomic(patchPath, next);
  return {
    changed: written,
    written,
    skipped,
    presets: presets.filter((preset) => !skipped.some((entry) => entry.startsWith(preset + ' '))),
  };
}

/* -------------------------------------------------------------------------- */
/* settings surface                                                            */
/* -------------------------------------------------------------------------- */

/** Coerce one submitted boolean, or throw naming the field. */
function readBoolean(label, raw) {
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === 'false') return raw === 'true';
  throw new Error(`${label} must be a boolean`);
}

/** Coerce one submitted policy value, or throw with the offending field name. */
function readPolicyValue(key, raw) {
  const field = POLICY_FIELDS[key];
  if (field === undefined) throw new Error(`unknown policy field "${key}"`);
  if (field.kind === 'boolean') return readBoolean(`policy.${key}`, raw);
  if (field.kind === 'text') {
    if (raw === undefined || raw === null) return '';
    if (typeof raw !== 'string') throw new Error(`policy.${key} must be a string`);
    return raw.trim();
  }
  const value = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`policy.${key} must be a number`);
  if (field.kind === 'integer' && !Number.isInteger(value)) throw new Error(`policy.${key} must be a whole number`);
  if (value < field.min || value > field.max) {
    throw new Error(`policy.${key} must be between ${field.min} and ${field.max}`);
  }
  return value;
}

/** Coerce one submitted summary thinking level, or throw naming the field. */
function readEffort(raw) {
  const value = raw === undefined || raw === null ? '' : String(raw).trim();
  if (!EFFORT_LEVELS.includes(value)) {
    throw new Error('summarization.reasoningEffort must be one of ' + EFFORT_LEVELS.filter(Boolean).join(', '));
  }
  return value;
}

/** Read `presets` as a normalized list, or undefined to mean "the default set". */
function readPresets(raw) {
  if (raw === undefined || raw === null) return undefined;
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const presets = [];
  for (const item of list) {
    const preset = String(item).trim().toLowerCase();
    if (preset === '') continue;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(preset)) throw new Error(`presets: "${preset}" is not a preset id`);
    if (!presets.includes(preset)) presets.push(preset);
  }
  if (!presets.length) throw new Error('presets must name at least one preset');
  return presets;
}

/**
 * Validate one submitted form and return the values to keep.
 * @param submitted - `{ policy?, enabled?, presets? }` or a flat value map.
 * @returns `{ policy, enabled, presets }` with defaults filled in.
 */
export function normalizeValues(submitted) {
  const source = submitted ?? {};
  const policyInput = source.policy !== undefined && typeof source.policy === 'object' ? source.policy : source;
  const policy = { ...DEFAULT_POLICY };
  for (const key of Object.keys(POLICY_FIELDS)) {
    if (policyInput[key] === undefined) continue;
    policy[key] = readPolicyValue(key, policyInput[key]);
  }
  const provider = policy.summarizationProvider;
  const model = policy.summarizationModel;
  if ((provider === '') !== (model === '')) {
    throw new Error('policy.summarizationProvider and policy.summarizationModel must be set together');
  }
  const enabled = source.enabled === undefined ? true : readBoolean('enabled', source.enabled);
  const summarization = { ...DEFAULT_SUMMARIZATION };
  const submittedSummary = source.summarization;
  if (submittedSummary !== undefined && submittedSummary !== null && typeof submittedSummary === 'object') {
    if (submittedSummary.reasoningEffort !== undefined) {
      summarization.reasoningEffort = readEffort(submittedSummary.reasoningEffort);
    }
  }
  return { policy, enabled, presets: readPresets(source.presets), summarization };
}

/** Find this plugin's own profile row among the rows the editor can address. */
function findEntry(configEditor) {
  const entries = configEditor.entries();
  return (
    entries.find((entry) => entry.options?.id === ENTRY_ID) ??
    entries.find((entry) => entry.id === ENTRY_ID) ??
    entries.find((entry) => String(entry.options?.id ?? entry.id ?? '').endsWith(':' + ENTRY_ID))
  );
}

/** Where the settings page keeps its values: beside the profile patch it regenerates. */
function settingsFile(patchPath) {
  return join(dirname(patchPath), 'compaction-policy.json');
}

/**
 * Read the settings page's own file.
 *
 * A missing, partial or unparseable file is simply empty: hand editing it must
 * never be able to break a start.
 * @param patchPath - Profile patch whose directory holds the file.
 * @returns `{ policy, enabled, presets, lastRun }`, all optional.
 */
function readSettings(patchPath) {
  const file = settingsFile(patchPath);
  if (!existsSync(file)) return { policy: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const policy = {};
    const stored = parsed?.policy;
    if (stored !== null && typeof stored === 'object') {
      for (const key of Object.keys(POLICY_FIELDS)) {
        const value = stored[key];
        const kind = POLICY_FIELDS[key].kind;
        if (typeof value === 'number' && Number.isFinite(value) && kind !== 'boolean' && kind !== 'text') policy[key] = value;
        else if (typeof value === 'boolean' && kind === 'boolean') policy[key] = value;
        else if (typeof value === 'string' && kind === 'text') policy[key] = value.trim();
      }
    }
    return {
      policy,
      enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : undefined,
      presets:
        Array.isArray(parsed?.presets) && parsed.presets.length
          ? parsed.presets.filter((preset) => typeof preset === 'string')
          : undefined,
      summarization:
        parsed?.summarization !== null &&
        typeof parsed?.summarization === 'object' &&
        EFFORT_LEVELS.includes(parsed.summarization.reasoningEffort)
          ? { reasoningEffort: parsed.summarization.reasoningEffort }
          : undefined,
      lastRun: parsed?.lastRun !== null && typeof parsed?.lastRun === 'object' ? parsed.lastRun : undefined,
    };
  } catch {
    return { policy: {} };
  }
}

/**
 * Persist the page's values atomically, keeping only what differs from the
 * defaults so an untouched parameter keeps following future DSH numbers.
 * @param patchPath - Profile patch whose directory holds the file.
 * @param normalized - Result of `normalizeValues`.
 * @param lastRun - Coverage of the regeneration just performed.
 * @returns The document written.
 */
function writeSettings(patchPath, normalized, lastRun) {
  const policy = {};
  for (const [key, value] of Object.entries(normalized.policy)) {
    if (value !== DEFAULT_POLICY[key]) policy[key] = value;
  }
  const document = { version: 1 };
  if (Object.keys(policy).length) document.policy = policy;
  if (!normalized.enabled) document.enabled = false;
  if (normalized.presets !== undefined && normalized.presets.join(',') !== DEFAULT_PRESETS.join(',')) {
    document.presets = normalized.presets;
  }
  const summarization = {};
  for (const [key, value] of Object.entries(normalized.summarization ?? {})) {
    if (value !== DEFAULT_SUMMARIZATION[key]) summarization[key] = value;
  }
  if (Object.keys(summarization).length) document.summarization = summarization;
  if (lastRun !== undefined) document.lastRun = lastRun;
  const file = settingsFile(patchPath);
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(document, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
  return document;
}

/** This plugin's own row config, i.e. the hand-written YAML layer, when present. */
function yamlConfig(configEditor) {
  if (configEditor === undefined) return {};
  try {
    const config = findEntry(configEditor)?.options?.config;
    return config !== null && typeof config === 'object' ? structuredClone(config) : {};
  } catch {
    return {};
  }
}

/**
 * Merge the three layers the policy can come from.
 *
 * Defaults first, then the settings page's file, then an explicit `config.policy`
 * in the profile patch: YAML stays the escape hatch that wins, and the page
 * marks such a field as pinned instead of silently ignoring an edit.
 * @param patchPath - Profile patch directory.
 * @param config - This plugin's row config from the profile patch.
 * @returns `{ policy, enabled, presets }` in force.
 */
function effectiveSettings(patchPath, config) {
  const file = readSettings(patchPath);
  const yamlPolicy = config?.policy !== null && typeof config?.policy === 'object' ? config.policy : {};
  const policy = { ...DEFAULT_POLICY, ...file.policy };
  for (const key of Object.keys(POLICY_FIELDS)) {
    if (yamlPolicy[key] !== undefined) policy[key] = yamlPolicy[key];
  }
  const enabled = config?.enabled === false ? false : (file.enabled ?? true);
  const presets =
    Array.isArray(config?.presets) && config.presets.length
      ? config.presets.map(String)
      : (file.presets ?? DEFAULT_PRESETS);
  // The summary's thinking level follows the same three layers, and an invalid
  // hand-written level is ignored rather than allowed to break the start.
  const summarization = { ...DEFAULT_SUMMARIZATION, ...file.summarization };
  const yamlSummary =
    config?.summarization !== null && typeof config?.summarization === 'object' ? config.summarization : {};
  if (EFFORT_LEVELS.includes(yamlSummary.reasoningEffort)) summarization.reasoningEffort = yamlSummary.reasoningEffort;
  return { policy, enabled, presets, summarization, file };
}

/**
 * Project the layers into the snapshot the settings page renders.
 * @param patchPath - Profile patch the managed region lives in.
 * @param config - This plugin's row config from the profile patch.
 * @returns Values, defaults, which layer set each field, and last coverage.
 */
function readState(patchPath, config) {
  const { policy, enabled, presets, summarization, file } = effectiveSettings(patchPath, config);
  const yamlPolicy = config?.policy !== null && typeof config?.policy === 'object' ? config.policy : {};
  const pinned = Object.keys(POLICY_FIELDS).filter((key) => yamlPolicy[key] !== undefined);
  if (Array.isArray(config?.presets) && config.presets.length) pinned.push('presets');
  if (config?.enabled === false) pinned.push('enabled');
  for (const key of ['summarizationProvider', 'summarizationModel']) {
    if (yamlPolicy[key] !== undefined) pinned.push(key);
  }
  const yamlSummary =
    config?.summarization !== null && typeof config?.summarization === 'object' ? config.summarization : {};
  if (EFFORT_LEVELS.includes(yamlSummary.reasoningEffort)) pinned.push('reasoningEffort');
  const overridden = Object.keys(POLICY_FIELDS).filter((key) => file.policy?.[key] !== undefined);
  if (file.enabled === false) overridden.push('enabled');
  if (file.presets !== undefined) overridden.push('presets');
  if (file.summarization !== undefined) overridden.push('reasoningEffort');
  const patch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
  const begin = patch.indexOf(BEGIN);
  const end = patch.indexOf(END);
  return {
    values: { ...policy, enabled, presets, summarization },
    defaults: { ...DEFAULT_POLICY, enabled: true, presets: DEFAULT_PRESETS, summarization: { ...DEFAULT_SUMMARIZATION } },
    overridden,
    pinned,
    lastRun: file.lastRun,
    entry: ENTRY_ID,
    patchPath,
    settingsPath: settingsFile(patchPath),
    managed: begin >= 0 && end > begin,
  };
}

/** Reject a cross-origin write; the route has no authentication of its own. */
function sameOrigin(req, origin) {
  const header = req.headers.origin;
  if (header === undefined || header === '' || header === 'null') return true;
  if (origin === undefined) return false;
  return (
    header === origin ||
    header === req.headers.host ||
    header === 'http://' + req.headers.host ||
    header === 'https://' + req.headers.host
  );
}

/** Read a bounded JSON body. */
async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new Error('request body is too large');
    chunks.push(chunk);
  }
  if (!total) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Give the summary call a thinking level of its own.
 *
 * `compaction-basic` sends `purpose: 'compaction'` and no `reasoningEffort`, so
 * the level a summary runs at is whatever the route defaults to — which is how
 * one bad provider default turns every `/compact` into a failure. The
 * `llm/stream` waterfall hands this listener the very options object the adapter
 * reads afterwards, and its `next()` takes no arguments, so the level is set in
 * place before continuing. A frozen request is left alone: the level is a
 * preference, never a reason to break a call.
 * @param options - the request the caller built.
 * @param next - continuation returning the chunk stream.
 * @returns the chunk stream of the (possibly adjusted) request.
 */
function applySummaryEffort(options, next) {
  const effort = live.reasoningEffort;
  if (effort !== '' && options !== null && typeof options === 'object' && options.purpose === 'compaction') {
    if (options.reasoningEffort !== effort && !Object.isFrozen(options)) {
      try {
        options.reasoningEffort = effort;
      } catch {
        // A read-only proxy is as untouchable as a frozen object.
      }
    }
  }
  return next();
}

/** Serve and persist the policy from the two settings routes. */
function registerRoutes(scope) {
  const profile = scope.get('profileContext');
  const patchPath = profile?.patchPath;
  if (!patchPath) {
    scope.logger?.debug?.('compaction-policy: no profile patch in this composition; settings routes skipped');
    return;
  }
  const connection = scope.get('connection');

  const route = {
    name: 'compaction-policy-settings',
    kind: 'exact',
    path: '/compaction-policy/config',
    handler: async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(body));
      };
      // A raw webServer route inherits no deployment authentication, so it asks
      // Connection for the same Host/Origin and browser-credential verdict the
      // rest of the Web surface gets. A composition without Connection keeps
      // the loopback origin check below only.
      if (typeof connection?.requestRejection === 'function') {
        const rejection = connection.requestRejection(req);
        if (rejection !== undefined) {
          send(rejection, { ok: false, error: 'authentication required' });
          return;
        }
      } else {
        let origin;
        try {
          origin = typeof scope.webServer?.getOrigin === 'function' ? scope.webServer.getOrigin() : undefined;
        } catch {
          origin = undefined;
        }
        if (!sameOrigin(req, origin)) {
          send(403, { ok: false, error: 'cross-origin request refused' });
          return;
        }
      }
      if (req.method === 'GET') {
        try {
          send(200, { ok: true, ...readState(patchPath, yamlConfig(scope.get('configEditor'))) });
        } catch (error) {
          send(500, { ok: false, error: String(error?.message ?? error) });
        }
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'GET, POST' }).end();
        return;
      }
      try {
        const normalized = normalizeValues(await readJsonBody(req));
        let lastRun;
        try {
          const result = await sync({
            patchPath,
            presets: normalized.presets ?? DEFAULT_PRESETS,
            policy: normalized.policy,
            logger: scope.logger,
          });
          lastRun = {
            at: new Date().toISOString(),
            applied: result.presets,
            skipped: result.skipped,
            written: result.written,
          };
        } catch (error) {
          lastRun = { at: new Date().toISOString(), applied: [], skipped: [], error: String(error?.message ?? error) };
        }
        writeSettings(patchPath, normalized, lastRun);
        // The stream hook reads the live copy, so the level a saved call should
        // already apply does not need a restart.
        live.reasoningEffort = normalized.summarization.reasoningEffort;
        send(200, { ok: true, ...readState(patchPath, yamlConfig(scope.get('configEditor'))) });
      } catch (error) {
        send(400, { ok: false, error: String(error?.message ?? error) });
      }
    },
  };

  scope.effect(() => scope.webServer.register(route), 'compaction-policy: settings route');
}

/**
 * Storage internals, exposed for the workspace tests the way the other profile
 * plugins expose theirs: not part of the plugin contract.
 */
export const __settings = {
  DEFAULT_POLICY,
  DEFAULT_PRESETS,
  DEFAULT_SUMMARIZATION,
  EFFORT_LEVELS,
  POLICY_FIELDS,
  applySummaryEffort,
  buildOverride,
  effectiveSettings,
  live,
  readSettings,
  settingsFile,
  writeSettings,
  yamlConfig,
};

/**
 * Regenerate the managed region once per start, mount the settings page, and
 * shape the thinking level of compaction's own summary call.
 *
 * The policy comes from three layers, weakest first: the shipped defaults, the
 * settings page's own file, and an explicit `config.policy` in the profile
 * patch. A restart therefore always re-derives the region from what the page
 * last saved, and the page itself reads exactly the same merge.
 * @param ctx - Host context supplying `profileContext`.
 * @param config - This row's config from the profile patch.
 */
export async function apply(ctx, config = {}) {
  // The settings page rides the web profile only; a headless composition keeps
  // just the regeneration below. Registered before the first await so a fiber
  // disposed during startup never registers against a dead context.
  // `configEditor` is optional: it is only read for the hand-written YAML layer.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scope) => {
      try {
        registerRoutes(scope);
      } catch (error) {
        ctx.logger?.warn?.('compaction-policy: settings routes skipped: ' + String(error?.message ?? error));
      }
    });
  }
  const profile = ctx.get('profileContext');
  const patchPath = profile?.patchPath;
  if (!patchPath) {
    ctx.logger?.debug?.('compaction-policy: no profile patch in this composition; skipped');
    return;
  }
  const { policy, enabled, presets, summarization, file } = effectiveSettings(patchPath, config);
  if (!enabled) {
    ctx.logger?.info?.('compaction-policy: switched off in settings; the profile patch is left alone');
    return;
  }
  // The one lever that is not a preset override: the summary's own thinking
  // level. Registered before the first await, and disposed with this fiber.
  live.reasoningEffort = summarization.reasoningEffort;
  if (typeof ctx.on === 'function') {
    ctx.effect(() => ctx.on('llm/stream', applySummaryEffort), 'compaction-policy: summary thinking level');
  }
  const result = await sync({ patchPath, presets, policy, logger: ctx.logger });
  // Refresh the page's coverage summary in place, without ever adding a file for
  // someone who never opened it.
  if (existsSync(settingsFile(patchPath))) {
    try {
      const stored = {
        policy: { ...DEFAULT_POLICY, ...file.policy },
        enabled: file.enabled ?? true,
        presets: file.presets,
        summarization: { ...DEFAULT_SUMMARIZATION, ...file.summarization },
      };
      writeSettings(patchPath, stored, {
        at: new Date().toISOString(),
        applied: result.presets,
        skipped: result.skipped,
        written: result.written,
      });
    } catch (error) {
      ctx.logger?.debug?.('compaction-policy: could not record the run: ' + String(error?.message ?? error));
    }
  }
  if (result.written) {
    ctx.logger?.info?.(
      'compaction-policy: regenerated preset overrides in ' + patchPath + ' (effective on the next start)',
    );
  }
}
