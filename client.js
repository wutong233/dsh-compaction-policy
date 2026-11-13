// Browser half of dsh-compaction-policy: the Settings → Compaction page.
//
// Every field of the policy is editable here, and the page invents no storage of
// its own: reads and writes go to the Host half's `/compaction-policy/config`
// route, which keeps `compaction-policy.json` beside the profile patch and
// regenerates the preset overrides in the same save. Clearing a field to its
// default removes it from that file, so untouched values keep following future
// DSH defaults instead of freezing today's. A field pinned by the profile YAML
// arrives in `pinned` and renders locked rather than silently ignoring an edit.
//
// Hand-written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load
// with a factory returning cordis-plugin exports), so there is no build step and
// no import of any dsh Client package: the same zero-dependency stance as the
// Host half. Controls are plain React elements styled with the host's
// `--dsw-alias-*` tokens, which keep light and dark switching working.
window.__ModuleLoader__.load({
  id: 'dsh-compaction-policy',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    /** Dictionary namespace owned by this plugin. */
    var NS = 'dsh-compaction-policy';
    /** The Host half's settings route. */
    var ENDPOINT = '/compaction-policy/config';

    /**
     * Editable fields, in page order. `ratio` fields are entered as a whole
     * percentage and stored as a fraction, which is how the compaction policy
     * reads them.
     */
    var FIELDS = [
      { key: 'thresholdRatio', group: 'timing', kind: 'ratio', min: 1, max: 100 },
      { key: 'headroomTokens', group: 'timing', kind: 'integer', min: 0 },
      { key: 'retainTokens', group: 'retention', kind: 'integer', min: 0 },
      { key: 'maxTokens', group: 'retention', kind: 'integer', min: 1 },
      { key: 'compactionRetries', group: 'retries', kind: 'integer', min: 0 },
      { key: 'maxOverflowRetries', group: 'retries', kind: 'integer', min: 0 },
      { key: 'auto', group: 'behaviour', kind: 'boolean' },
      { key: 'enabled', group: 'behaviour', kind: 'boolean' },
      { key: 'summarizationProvider', group: 'route', kind: 'text' },
      { key: 'summarizationModel', group: 'route', kind: 'text' },
      // Not a policy value: `compaction-basic` has no key for a summary's
      // thinking level, so the Host applies it to the summary call itself.
      { key: 'reasoningEffort', scope: 'summarization', group: 'route', kind: 'choice', choices: ['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] },
    ];

    var GROUPS = ['timing', 'retention', 'retries', 'behaviour', 'route'];

    /** English copy. */
    var en = {
      title: 'Compaction',
      description:
        'One compaction policy for every agent preset. Values are written to this profile’s patch and take effect for new turns after the next start.',
      loading: 'Reading the current policy…',
      loadFailed: 'Could not read the policy',
      retry: 'Retry',
      overridden: 'custom',
      reset: 'Reset',
      resetAll: 'Reset all to defaults',
      discard: 'Discard changes',
      save: 'Save',
      saving: 'Saving…',
      unsaved: 'Unsaved changes',
      saved: 'Saved',
      saveFailed: 'The Host rejected these values',
      crossOrigin: 'The Host refused the request',
      invalidNumber: 'Enter a whole number.',
      invalidRange: 'Enter a value between {min} and {max}.',
      percent: '%',
      toggleOn: 'On',
      toggleOff: 'Off',
      'group.timing': 'When to compact',
      'group.retention': 'What to keep',
      'group.retries': 'Retries',
      'group.behaviour': 'Behaviour',
      'field.thresholdRatio.label': 'Trigger at',
      'field.thresholdRatio.hint':
        'Share of the context window at which compaction starts. The default DSH value is 80%; lower compacts earlier and keeps replies cheaper.',
      'field.headroomTokens.label': 'Headroom (tokens)',
      'field.headroomTokens.hint':
        'Tokens reserved on top of the routed output reservation, so a long reply never overflows right after a compaction.',
      'field.retainTokens.label': 'Keep recent history (tokens)',
      'field.retainTokens.hint':
        'The newest messages kept verbatim. Everything older may be summarised; must stay below the trigger point.',
      'field.maxTokens.label': 'Summary cap (tokens)',
      'field.maxTokens.hint': 'How long one generated summary may be.',
      'field.compactionRetries.label': 'Compaction retries',
      'field.compactionRetries.hint': 'Extra attempts when one summarisation round fails.',
      'field.maxOverflowRetries.label': 'Overflow retries',
      'field.maxOverflowRetries.hint': 'Recovery attempts after the model rejects a request as too long.',
      'field.auto.label': 'Automatic compaction',
      'field.auto.hint': 'Compact between steps without being asked. Turn this off to keep history untouched.',
      'field.enabled.label': 'Policy plugin active',
      'field.enabled.hint':
        'While off, this plugin leaves the profile patch alone and every preset keeps its shipped compaction settings.',
      'group.route': 'Summary',
      'field.summarizationProvider.label': 'Summary provider',
      'field.summarizationProvider.hint':
        'Provider asked to write the summary. Leave both route fields empty to reuse the session’s own model.',
      'field.summarizationProvider.placeholder': 'follow the session',
      'field.summarizationModel.label': 'Summary model',
      'field.summarizationModel.hint':
        'Model asked to write the summary. It must accept the thinking level below; set both route fields together.',
      'field.summarizationModel.placeholder': 'follow the session',
      'field.reasoningEffort.label': 'Summary thinking level',
      'field.reasoningEffort.hint':
        'Only the summary call carries this level, never your own turns. Stock DSH sends none, so a summary used to run at whatever the provider defaulted to. The level must be one the summary model declares, or compaction fails naming that model; “inherit” sends none again.',
      'route.pair': 'Fill both route fields, or neither.',
      'effort.inherit': 'inherit',
      'invalidChoice': 'Pick one of the listed levels.',
      'presets.label': 'Presets covered',
      'presets.hint': 'Comma-separated preset ids. Leave the shipped list to cover every preset that has a compaction group.',
      'presets.placeholder': 'standard, ptc, minimal, cordis',
      'status.title': 'Coverage of the last run',
      'status.applied': 'Updated: {list}',
      'status.skipped': 'Skipped: {list}',
      'status.none': 'No preset has been written yet.',
      'status.managed': 'Managed block present in {path}',
      'status.unmanaged': 'No managed block yet — it appears when the plugin next starts.',
      'status.effective': 'Saved to the plugin’s settings file; the patch was regenerated for the next start.',
      'status.settings': 'Settings file: {path}',
      'status.pinned': 'Pinned by profile YAML',
      'status.pinnedHint': 'This field is set in the profile patch, so it wins over this page. Remove it there to edit it here.',
      'status.lastRun': 'Last regeneration: {when}',
      'status.error': 'Last regeneration failed: {error}',
      'formula': 'Trigger: min(W × {ratio}%, W − output − {headroom}) tokens per route.',
    };

    /** Simplified Chinese copy. */
    var zh = {
      title: '压缩',
      description:
        '为所有 agent 预设使用同一套压缩策略。数值写入本 profile 的 patch，下次启动后对新回合生效。',
      loading: '正在读取当前策略…',
      loadFailed: '读取策略失败',
      retry: '重试',
      overridden: '已自定义',
      reset: '恢复默认',
      resetAll: '全部恢复默认',
      discard: '放弃修改',
      save: '保存',
      saving: '保存中…',
      unsaved: '有未保存的修改',
      saved: '已保存',
      saveFailed: '宿主没有接受这些值',
      crossOrigin: '宿主拒绝了这次请求',
      invalidNumber: '请填整数。',
      invalidRange: '请填 {min} 到 {max} 之间的值。',
      percent: '%',
      toggleOn: '开',
      toggleOff: '关',
      'group.timing': '何时压缩',
      'group.retention': '保留什么',
      'group.retries': '重试',
      'group.behaviour': '行为',
      'field.thresholdRatio.label': '触发阈值',
      'field.thresholdRatio.hint':
        '上下文窗口用到多少比例时开始压缩。DSH 默认 80%；调低会更早压缩、回复更省。',
      'field.headroomTokens.label': '预留余量（token）',
      'field.headroomTokens.hint': '在路由输出预留之外再留出的空间，避免压缩后一条长回复立刻撑爆上下文。',
      'field.retainTokens.label': '逐字保留最近历史（token）',
      'field.retainTokens.hint': '最新这部分消息原样保留，更早的才可能被摘要；需小于触发点。',
      'field.maxTokens.label': '摘要上限（token）',
      'field.maxTokens.hint': '单次生成的摘要最长多少 token。',
      'field.compactionRetries.label': '压缩重试次数',
      'field.compactionRetries.hint': '一轮摘要失败后额外再试几次。',
      'field.maxOverflowRetries.label': '溢出重试次数',
      'field.maxOverflowRetries.hint': '模型以「请求过长」拒绝后的恢复尝试次数。',
      'field.auto.label': '自动压缩',
      'field.auto.hint': '在步骤之间自动压缩。关掉后历史不会被自动改动。',
      'field.enabled.label': '启用本策略插件',
      'field.enabled.hint': '关闭后本插件完全不动 profile patch，各预设保留出厂压缩设置。',
      'group.route': '摘要',
      'field.summarizationProvider.label': '摘要 provider',
      'field.summarizationProvider.hint':
        '用哪个 provider 生成摘要。两个路由字段都留空即沿用会话自己的模型。',
      'field.summarizationProvider.placeholder': '跟随会话',
      'field.summarizationModel.label': '摘要模型',
      'field.summarizationModel.hint': '用哪个模型生成摘要。它必须支持下面的思考档位；两个路由字段需同时填写或同时留空。',
      'field.summarizationModel.placeholder': '跟随会话',
      'field.reasoningEffort.label': '摘要思考档位',
      'field.reasoningEffort.hint':
        '只随摘要调用发送，不影响你自己的回合。DSH 自带的压缩本来不传档位，所以以前用哪个档位取决于 provider 的默认值。档位必须是写摘要的模型声明过的，否则压缩会报错并点名模型；「跟随端点默认」就是重新不传。',
      'route.pair': '两个路由字段要么都填，要么都留空。',
      'effort.inherit': '跟随端点默认',
      'invalidChoice': '请从列表里选一个档位。',
      'presets.label': '覆盖的预设',
      'presets.hint': '用逗号分隔的预设 id。保持默认即覆盖所有带压缩组的预设。',
      'presets.placeholder': 'standard, ptc, minimal, cordis',
      'status.title': '上次运行覆盖情况',
      'status.applied': '已更新：{list}',
      'status.skipped': '已跳过：{list}',
      'status.none': '还没有写入任何预设。',
      'status.managed': '托管块已在 {path} 中',
      'status.unmanaged': '还没有托管块——插件下次启动时写入。',
      'status.effective': '已保存到插件设置文件；patch 已重新生成，下次启动生效。',
      'status.settings': '设置文件：{path}',
      'status.pinned': '由 profile YAML 固定',
      'status.pinnedHint': '该字段在 profile patch 中显式设置，优先级高于本页；想在这里修改请先删掉那边的一行。',
      'status.lastRun': '上次生成：{when}',
      'status.error': '上次生成失败：{error}',
      'formula': '触发点：每条路由 min(W × {ratio}%, W − 输出 − {headroom}) token。',
    };

    /** Substitute `{name}` placeholders. */
    function format(text, params) {
      if (!params) return text;
      return text.replace(/\{(\w+)\}/g, function (whole, key) {
        return params[key] === undefined ? whole : String(params[key]);
      });
    }

    /** The stylesheet, rendered as an element so unmounting removes it. */
    var CSS = [
      '.dcp-page{display:flex;flex-direction:column;gap:24px;max-width:760px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
      '.dcp-head{display:flex;flex-direction:column;gap:6px}',
      '.dcp-title{margin:0;font-size:15px;font-weight:600;line-height:22px}',
      '.dcp-desc{margin:0;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:19px}',
      '.dcp-group{display:flex;flex-direction:column;gap:2px}',
      '.dcp-groupTitle{margin:0 0 6px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;letter-spacing:.02em;text-transform:uppercase}',
      '.dcp-row{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.dcp-row:last-of-type{border-bottom:0}',
      '.dcp-rowText{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
      '.dcp-label{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:500}',
      '.dcp-badge{border:.5px solid var(--dsw-alias-border-l2);border-radius:4px;color:var(--dsw-alias-label-secondary);padding:0 5px;font-size:10px;line-height:16px;font-weight:400}',
      '.dcp-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      '.dcp-fieldError{margin:2px 0 0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}',
      '.dcp-control{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;flex:none}',
      '.dcp-input{border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);height:30px;width:132px;font:inherit;color:var(--dsw-alias-label-primary);outline:none;padding:0 9px;text-align:right;font-variant-numeric:tabular-nums}',
      '.dcp-input:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-brand-primary)}',
      '.dcp-input[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}',
      '.dcp-input:disabled{opacity:.55}',
      '.dcp-select{width:150px;text-align:left;padding:0 6px;cursor:pointer}',
      '.dcp-unit{color:var(--dsw-alias-label-secondary);font-size:12px;min-width:12px}',
      '.dcp-switch{border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);width:40px;height:22px;cursor:pointer;padding:2px;display:inline-flex;align-items:center;transition:background .14s,border-color .14s}',
      '.dcp-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.dcp-knob{background:var(--dsw-alias-bg-layer-1);border-radius:999px;width:16px;height:16px;transition:transform .14s;box-shadow:0 1px 2px rgba(0,0,0,.25)}',
      '.dcp-switch[aria-checked="true"] .dcp-knob{transform:translateX(18px)}',
      '.dcp-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dcp-link{border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;padding:0;text-decoration:underline;text-underline-offset:2px}',
      '.dcp-link:hover{color:var(--dsw-alias-label-primary)}',
      '.dcp-foot{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding-top:4px}',
      '.dcp-btn{border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);height:30px;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;padding:0 12px}',
      '.dcp-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.dcp-btn:disabled{opacity:.5;cursor:default}',
      '.dcp-btnPrimary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:500}',
      '.dcp-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);filter:brightness(1.06)}',
      '.dcp-status{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      '.dcp-status[data-kind="ok"]{color:var(--dsw-alias-state-success-primary)}',
      '.dcp-status[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.dcp-status[data-kind="warn"]{color:var(--dsw-alias-state-warn-primary)}',
      '.dcp-note{display:flex;flex-direction:column;gap:8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px}',
      '.dcp-noteTitle{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.dcp-noteLine{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}',
      '.dcp-noteLine code{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11.5px}',
    ].join('');

    /**
     * Register the settings page and its dictionary.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      var react;
      try {
        react = require('react');
      } catch (error) {
        console.error('[compaction-policy] settings page skipped: ' + error);
        return;
      }
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, 'compaction-policy: dictionaries');
      var t = ctx.locale.bind(NS);
      var Page = createPage(react, t);
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          {
            name: 'settings.section',
            id: 'compaction-policy',
            order: 26,
            label: function () {
              return t('title');
            },
            locale: NS,
          },
          Page,
        );
      });
    }

    /**
     * Build the page component.
     * @param react - the host module table's React.
     * @param t - the bound dictionary reader.
     * @returns the React component the settings section renders.
     */
    function createPage(react, t) {
      var h = react.createElement;

      /** Turn one snapshot value into the text a field shows. */
      function toDraft(field, value) {
        if (field.kind === 'ratio') return String(Math.round(Number(value) * 1000) / 10);
        if (field.kind === 'boolean') return value === true;
        if (field.kind === 'text') return value === undefined || value === null ? '' : String(value);
        if (field.kind === 'choice') return value === undefined || value === null ? '' : String(value);
        return String(value);
      }

      /** Read one field's current value, wherever that field is stored. */
      function valueOf(state, field) {
        if (field.scope === 'summarization') {
          return state.values.summarization === undefined ? undefined : state.values.summarization[field.key];
        }
        return state.values[field.key];
      }

      /** Read one field's shipped default, wherever that field is stored. */
      function defaultOf(state, field) {
        if (field.scope === 'summarization') {
          return state.defaults.summarization === undefined ? undefined : state.defaults.summarization[field.key];
        }
        return state.defaults[field.key];
      }

      /** Build the whole editable draft from a snapshot. */
      function draftOf(state) {
        var draft = { presets: (state.values.presets || []).join(', ') };
        for (var i = 0; i < FIELDS.length; i += 1) {
          var field = FIELDS[i];
          draft[field.key] = toDraft(field, valueOf(state, field));
        }
        return draft;
      }

      /** Parse one draft value, returning `{ value }` or `{ error }`. */
      function parseField(field, draft) {
        if (field.kind === 'boolean') return { value: draft[field.key] === true };
        var raw = String(draft[field.key] === undefined ? '' : draft[field.key]).trim();
        if (field.kind === 'choice') {
          if (field.choices.indexOf(raw) < 0) return { error: t('invalidChoice') };
          return { value: raw };
        }
        if (field.kind === 'text') return { value: raw };
        var text = raw.replace(/,/g, '');
        if (text === '') return { error: t('invalidNumber') };
        if (!/^-?\d+(\.\d+)?$/.test(text)) return { error: t('invalidNumber') };
        var number = Number(text);
        if (field.kind === 'integer' && !Number.isInteger(number)) return { error: t('invalidNumber') };
        if (field.min !== undefined && number < field.min) {
          return { error: format(t('invalidRange'), { min: field.min, max: field.max === undefined ? '∞' : field.max }) };
        }
        if (field.max !== undefined && number > field.max) {
          return { error: format(t('invalidRange'), { min: field.min, max: field.max }) };
        }
        return { value: field.kind === 'ratio' ? number / 100 : number };
      }

      /** Whole-form parse: `{ policy, summarization, presets, errors }`. */
      function parseDraft(draft) {
        var policy = {};
        var summarization = {};
        var errors = {};
        for (var i = 0; i < FIELDS.length; i += 1) {
          var field = FIELDS[i];
          var parsed = parseField(field, draft);
          if (parsed.error !== undefined) errors[field.key] = parsed.error;
          else if (field.scope === 'summarization') summarization[field.key] = parsed.value;
          else policy[field.key] = parsed.value;
        }
        var presets = String(draft.presets === undefined ? '' : draft.presets)
          .split(',')
          .map(function (item) {
            return item.trim().toLowerCase();
          })
          .filter(function (item) {
            return item !== '';
          });
        if (!presets.length) errors.presets = t('invalidNumber');
        if ((policy.summarizationProvider === '') !== (policy.summarizationModel === '')) {
          errors[policy.summarizationProvider === '' ? 'summarizationProvider' : 'summarizationModel'] = t('route.pair');
        }
        return { policy: policy, summarization: summarization, presets: presets, errors: errors };
      }

      return function ConfigPage(props) {
        var snapshot = react.useState({ phase: 'loading', state: null, error: null });
        var loaded = snapshot[0];
        var setLoaded = snapshot[1];
        var draftRef = react.useState(null);
        var draft = draftRef[0];
        var setDraft = draftRef[1];
        var busy = react.useState(false);
        var saving = busy[0];
        var setSaving = busy[1];
        var note = react.useState(null);
        var status = note[0];
        var setStatus = note[1];

        react.useEffect(function () {
          var cancelled = false;
          fetch(ENDPOINT, { credentials: 'same-origin', headers: { accept: 'application/json' } })
            .then(function (response) {
              return response.json().then(function (body) {
                return { response: response, body: body };
              });
            })
            .then(function (result) {
              if (cancelled) return;
              if (!result.body || result.body.ok !== true) {
                setLoaded({ phase: 'error', state: null, error: (result.body && result.body.error) || String(result.response.status) });
                return;
              }
              setLoaded({ phase: 'ready', state: result.body, error: null });
              setDraft(draftOf(result.body));
            })
            .catch(function (error) {
              if (!cancelled) setLoaded({ phase: 'error', state: null, error: String(error && error.message ? error.message : error) });
            });
          return function () {
            cancelled = true;
          };
        }, []);

        if (loaded.phase === 'loading') {
          return h('div', { className: 'dcp-page' }, h('style', null, CSS), h('p', { className: 'dcp-status' }, t('loading')));
        }
        if (loaded.phase === 'error') {
          return h(
            'div',
            { className: 'dcp-page' },
            h('style', null, CSS),
            h(
              'div',
              { className: 'dcp-note', role: 'alert' },
              h('p', { className: 'dcp-noteTitle' }, t('loadFailed')),
              h('p', { className: 'dcp-noteLine' }, String(loaded.error)),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dcp-btn',
                  onClick: function () {
                    window.location.reload();
                  },
                },
                t('retry'),
              ),
            ),
          );
        }

        var state = loaded.state;
        // The draft is absent for the one render that first sees the snapshot;
        // falling back to the snapshot keeps every control controlled.
        var view = draft || draftOf(state);
        var parsed = parseDraft(view);
        var hasErrors = Object.keys(parsed.errors).length > 0;

        /** Canonical form of one draft, for dirty detection. */
        function canonical(candidate) {
          var parse = parseDraft(candidate);
          return JSON.stringify({ policy: parse.policy, summarization: parse.summarization, presets: parse.presets });
        }

        var dirty = canonical(view) !== canonical(draftOf(state));

        /** Edit one field. */
        function edit(key, value) {
          var next = {};
          for (var name in view) next[name] = view[name];
          next[key] = value;
          setDraft(next);
          setStatus(null);
        }

        /** Reset one field to the shipped default. */
        function resetField(field) {
          edit(field.key, toDraft(field, defaultOf(state, field)));
        }

        /** Replace the whole draft with the shipped defaults. */
        function resetAll() {
          var next = { presets: (state.defaults.presets || []).join(', ') };
          for (var i = 0; i < FIELDS.length; i += 1) {
            var field = FIELDS[i];
            next[field.key] = toDraft(field, defaultOf(state, field));
          }
          setDraft(next);
          setStatus(null);
        }

        /** Send the draft to the Host. */
        function save() {
          if (saving || hasErrors) return;
          setSaving(true);
          setStatus(null);
          // `enabled` gates the plugin itself, so it travels beside the policy
          // rather than inside it; the summary's thinking level rides beside the
          // policy for the same reason, since it is not a `compaction-basic` key.
          var body = { policy: {}, enabled: parsed.policy.enabled !== false, presets: parsed.presets, summarization: parsed.summarization };
          for (var i = 0; i < FIELDS.length; i += 1) {
            var field = FIELDS[i];
            if (field.key === 'enabled' || field.scope === 'summarization') continue;
            body.policy[field.key] = parsed.policy[field.key];
          }
          fetch(ENDPOINT, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(body),
          })
            .then(function (response) {
              return response.json().then(function (body) {
                return { response: response, body: body };
              });
            })
            .then(function (result) {
              if (!result.body || result.body.ok !== true) {
                setStatus({ kind: 'error', text: (result.body && result.body.error) || t('saveFailed') });
                return;
              }
              setLoaded({ phase: 'ready', state: result.body, error: null });
              setDraft(draftOf(result.body));
              setStatus({ kind: 'ok', text: t('saved') + ' · ' + t('status.effective') });
            })
            .catch(function (error) {
              setStatus({ kind: 'error', text: String(error && error.message ? error.message : error) });
            })
            .then(function () {
              setSaving(false);
            });
        }

        var rows = [];
        for (var groupIndex = 0; groupIndex < GROUPS.length; groupIndex += 1) {
          var group = GROUPS[groupIndex];
          var groupRows = [];
          for (var fieldIndex = 0; fieldIndex < FIELDS.length; fieldIndex += 1) {
            var field = FIELDS[fieldIndex];
            if (field.group !== group) continue;
            groupRows.push(renderField(field));
          }
          if (group === 'behaviour') groupRows.push(renderPresets());
          rows.push(
            h(
              'section',
              { className: 'dcp-group', key: group },
              h('h3', { className: 'dcp-groupTitle' }, t('group.' + group)),
              groupRows,
            ),
          );
        }

        /** One editable row. */
        function renderField(field) {
          var id = 'dcp-' + field.key;
          var overridden = (state.overridden || []).indexOf(field.key) >= 0;
          var pinned = (state.pinned || []).indexOf(field.key) >= 0;
          var error = parsed.errors[field.key];
          var control;
          if (field.kind === 'boolean') {
            control = h(
              'button',
              {
                type: 'button',
                role: 'switch',
                id: id,
                'aria-checked': view[field.key] === true ? 'true' : 'false',
                'aria-label': t('field.' + field.key + '.label'),
                className: 'dcp-switch',
                disabled: saving || pinned,
                onClick: function () {
                  edit(field.key, view[field.key] !== true);
                },
              },
              h('span', { className: 'dcp-knob' }),
            );
          } else if (field.kind === 'choice') {
            control = h(
              'span',
              { className: 'dcp-control' },
              h(
                'select',
                {
                  id: id,
                  className: 'dcp-input dcp-select',
                  value: view[field.key] === undefined ? '' : String(view[field.key]),
                  'aria-invalid': error === undefined ? 'false' : 'true',
                  disabled: saving || pinned,
                  onChange: function (event) {
                    edit(field.key, event.target.value);
                  },
                },
                field.choices.map(function (choice) {
                  return h(
                    'option',
                    { key: choice === '' ? 'inherit' : choice, value: choice },
                    choice === '' ? t('effort.inherit') : choice,
                  );
                }),
              ),
            );
          } else if (field.kind === 'text') {
            control = h(
              'span',
              { className: 'dcp-control' },
              h('input', {
                id: id,
                className: 'dcp-input',
                type: 'text',
                style: { width: '220px', textAlign: 'left' },
                placeholder: t('field.' + field.key + '.placeholder'),
                value: view[field.key] === undefined ? '' : String(view[field.key]),
                'aria-invalid': error === undefined ? 'false' : 'true',
                disabled: saving || pinned,
                onChange: function (event) {
                  edit(field.key, event.target.value);
                },
              }),
            );
          } else {
            control = h(
              'span',
              { className: 'dcp-control' },
              h('input', {
                id: id,
                className: 'dcp-input',
                type: 'text',
                inputMode: 'decimal',
                value: view[field.key] === undefined ? '' : String(view[field.key]),
                'aria-invalid': error === undefined ? 'false' : 'true',
                disabled: saving || pinned,
                onChange: function (event) {
                  edit(field.key, event.target.value);
                },
              }),
              field.kind === 'ratio' ? h('span', { className: 'dcp-unit' }, t('percent')) : null,
            );
          }
          return h(
            'div',
            { className: 'dcp-row', key: field.key },
            h(
              'div',
              { className: 'dcp-rowText' },
              h(
                'label',
                { className: 'dcp-label', htmlFor: id },
                t('field.' + field.key + '.label'),
                pinned ? h('span', { className: 'dcp-badge' }, t('status.pinned')) : overridden ? h('span', { className: 'dcp-badge' }, t('overridden')) : null,
              ),
              h('p', { className: 'dcp-hint' }, t('field.' + field.key + '.hint')),
              error === undefined ? null : h('p', { className: 'dcp-fieldError' }, error),
            ),
            h(
              'div',
              { className: 'dcp-control' },
              field.kind === 'boolean' ? h('span', { className: 'dcp-unit' }, view[field.key] === true ? t('toggleOn') : t('toggleOff')) : null,
              control,
              overridden && !pinned
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dcp-link',
                      disabled: saving,
                      onClick: function () {
                        resetField(field);
                      },
                    },
                    t('reset'),
                  )
                : null,
            ),
          );
        }

        /** The preset list row, which is a text field rather than a number. */
        function renderPresets() {
          var overridden = (state.overridden || []).indexOf('presets') >= 0;
          var pinned = (state.pinned || []).indexOf('presets') >= 0;
          return h(
            'div',
            { className: 'dcp-row', key: 'presets' },
            h(
              'div',
              { className: 'dcp-rowText' },
              h('label', { className: 'dcp-label', htmlFor: 'dcp-presets' }, t('presets.label')),
              h('p', { className: 'dcp-hint' }, t('presets.hint')),
              parsed.errors.presets === undefined ? null : h('p', { className: 'dcp-fieldError' }, parsed.errors.presets),
            ),
            h(
              'div',
              { className: 'dcp-control' },
              h('input', {
                id: 'dcp-presets',
                className: 'dcp-input',
                type: 'text',
                style: { width: '220px', textAlign: 'left' },
                placeholder: t('presets.placeholder'),
                value: view.presets === undefined ? '' : String(view.presets),
                'aria-invalid': parsed.errors.presets === undefined ? 'false' : 'true',
                disabled: saving || pinned,
                onChange: function (event) {
                  edit('presets', event.target.value);
                },
              }),
            ),
          );
        }

        var run = state.lastRun !== null && typeof state.lastRun === 'object' ? state.lastRun : {};
        var statusKind = status ? status.kind : dirty ? 'warn' : undefined;
        var statusText = status
          ? status.text
          : dirty
            ? t('unsaved')
            : t('status.effective');

        return h(
          'div',
          { className: 'dcp-page' },
          h('style', null, CSS),
          h(
            'header',
            { className: 'dcp-head' },
            h('h2', { className: 'dcp-title' }, t('title')),
            h('p', { className: 'dcp-desc' }, t('description')),
          ),
          (state.pinned || []).length
            ? h('div', { className: 'dcp-note' }, h('p', { className: 'dcp-noteLine' }, t('status.pinnedHint')))
            : null,
          rows,
          h(
            'div',
            { className: 'dcp-foot' },
            h(
              'button',
              {
                type: 'button',
                className: 'dcp-btn dcp-btnPrimary',
                disabled: saving || hasErrors || !dirty,
                onClick: save,
              },
              saving ? t('saving') : t('save'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dcp-btn',
                disabled: saving || !dirty,
                onClick: function () {
                  setDraft(draftOf(state));
                  setStatus(null);
                },
              },
              t('discard'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dcp-btn',
                disabled: saving,
                onClick: resetAll,
              },
              t('resetAll'),
            ),
            h('p', { className: 'dcp-status', 'data-kind': statusKind, 'aria-live': 'polite' }, statusText),
          ),
          h(
            'div',
            { className: 'dcp-note' },
            h('p', { className: 'dcp-noteTitle' }, t('status.title')),
            h(
              'p',
              { className: 'dcp-noteLine' },
              format(t('formula'), {
                ratio: Math.round(Number(state.values.thresholdRatio) * 100),
                headroom: state.values.headroomTokens,
              }),
            ),
            h(
              'p',
              { className: 'dcp-noteLine' },
              (run.applied || []).length ? format(t('status.applied'), { list: run.applied.join(', ') }) : t('status.none'),
            ),
            (run.skipped || []).length
              ? h('p', { className: 'dcp-noteLine' }, format(t('status.skipped'), { list: run.skipped.join(', ') }))
              : null,
            run.error === undefined ? null : h('p', { className: 'dcp-fieldError' }, format(t('status.error'), { error: run.error })),
            run.at === undefined ? null : h('p', { className: 'dcp-noteLine' }, format(t('status.lastRun'), { when: run.at })),
            h(
              'p',
              { className: 'dcp-noteLine' },
              format(state.managed ? t('status.managed') : t('status.unmanaged'), { path: state.patchPath }),
            ),
            h('p', { className: 'dcp-noteLine' }, format(t('status.settings'), { path: state.settingsPath })),
          ),
        );
      };
    }

    exports.apply = apply;
    exports.inject = ['slots', 'locale'];
    exports.NS = NS;
    return module.exports;
  },
});
