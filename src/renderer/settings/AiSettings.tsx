import { useEffect, useRef, useState } from 'react';
import {
  AI_CLI_LABEL,
  AI_ENGINE_INFO,
  AI_ENGINES,
  AI_PROVIDER_LABEL,
  AI_TIMEOUT_MINUTES,
  ANTHROPIC_EFFORTS,
  ANTHROPIC_MODELS,
  CliModelSchema,
  ModelNameSchema,
  type AiCli,
  type AiEngine,
  type AiProvider,
} from '../../shared/ai/engines';
import type { AiConfigType, AiTestResponseType } from '../../shared/contracts/ai';
import type { SettingValue } from '../../shared/contracts/settings';
import { useServices, useStore } from '../state/use-store';
import { Switch } from '../ui/Switch';
import { NumberField, SelectField, SettingsSection, TextField } from './fields';
import { useSettingValues } from './use-settings';

export const AI_SETTING_LABEL = 'AI actions';
export const AI_SETTING_TEXT =
  'Run an AI action on a selected part of a note, sticky, PDF or web page: Ask AI in the selection toolbar, the note menu, the command palette or Ctrl+Shift+I. Nothing is sent anywhere until you run an action; the selected part and the files you attach go to the engine below. Locked notes and documents are never sent.';
const CLI_TEXT: Readonly<Record<AiCli, string>> = {
  claude: 'Uses the Claude Code you installed and signed in to. It runs without a window in an empty temporary folder that holds only the files you attach, and may only read them.',
  codex: 'Uses the Codex you installed and signed in to. It runs without a window in an empty temporary folder that holds only the files you attach, in its read-only sandbox.',
};
const KEY_TEXT = 'Your key is encrypted by the operating system and kept apart from your notes: never in the database, backups, exports or logs.';

const KEYS = ['ai.enabled', 'ai.engine', 'ai.claudeModel', 'ai.codexModel', 'ai.anthropicModel', 'ai.anthropicEffort', 'ai.openaiModel', 'ai.timeoutMinutes'] as const;

const schemaCheck = (schema: { safeParse(v: unknown): { success: boolean; error?: { issues: Array<{ message: string }> } } }) => (v: string) => {
  const parsed = schema.safeParse(v);
  return parsed.success ? null : (parsed.error?.issues[0]?.message ?? 'Not a valid value');
};

/** The program row of a command-line tool: where it is, Choose… (main's file dialog) and Use PATH. */
function CliProgram({ cli, config, onConfig }: { cli: AiCli; config: AiConfigType; onConfig: (c: AiConfigType) => void }) {
  const { bridge, notices } = useServices();
  const chosen = config.cliPaths[cli];
  const change = async (action: 'pick' | 'clear') => {
    const res = await bridge.ai.cliPath({ cli, action });
    if (res.ok) onConfig(res.data);
    else notices.push(res.error.message, 'error');
  };
  return (
    <div className="form-field">
      <span className="field-label">{AI_CLI_LABEL[cli]} program</span>
      <p className="muted ai-program">{chosen ?? `Found on PATH (${cli})`}</p>
      <div className="button-row">
        <button type="button" className="btn btn-small" onClick={() => void change('pick')}>
          Choose…
        </button>
        {chosen ? (
          <button type="button" className="btn btn-small" onClick={() => void change('clear')}>
            Use PATH
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The API key row: whether one is stored, a field to store a new one, and Remove. The key itself never comes back. */
function ApiKey({ provider, config, onConfig }: { provider: AiProvider; config: AiConfigType; onConfig: (c: AiConfigType) => void }) {
  const { bridge } = useServices();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async (value: string | null) => {
    const res = await bridge.ai.setKey({ provider, key: value });
    if (!res.ok) return setError(res.error.message);
    setError(null);
    setKey('');
    onConfig(res.data);
  };
  const stored = config.keys[provider];
  return (
    <div className="form-field">
      <label className="field-label" htmlFor={`ai-key-${provider}`}>
        {AI_PROVIDER_LABEL[provider]} API key {stored ? <span className="muted">(stored)</span> : null}
      </label>
      <div className="button-row">
        <input
          id={`ai-key-${provider}`}
          type="password"
          className="text-input"
          autoComplete="off"
          spellCheck={false}
          placeholder={stored ? 'Enter a new key to replace it' : 'Paste your key'}
          value={key}
          disabled={!config.keyStorage}
          onChange={(e) => setKey(e.target.value)}
        />
        <button type="button" className="btn btn-small" disabled={key.trim() === ''} onClick={() => void save(key)}>
          Save key
        </button>
        {stored ? (
          <button type="button" className="btn btn-small" onClick={() => void save(null)}>
            Remove key
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
      <p className="muted">{config.keyStorage ? KEY_TEXT : 'This computer cannot keep keys encrypted (no keyring), so a key cannot be stored.'}</p>
    </div>
  );
}

/**
 * Settings > AI (D-190): the switch (off by default), the engine, its program or key, model and effort, the timeout,
 * and Test, which shows a tool's version or whether a key works.
 */
export function AiSettings() {
  const { values, set } = useSettingValues(KEYS);
  const { bridge, ui } = useServices();
  const { focusRequest } = useStore(ui.store);
  const [config, setConfig] = useState<AiConfigType | null>(null);
  const [test, setTest] = useState<{ engine: AiEngine; result: AiTestResponseType | null } | null>(null);
  const aiSwitch = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    void bridge.ai.config().then((res) => res.ok && setConfig(res.data));
  }, [bridge]);
  const shown = values !== null;
  useEffect(() => {
    if (focusRequest?.target !== 'aiSetting' || !shown) return;
    ui.consumeFocus();
    aiSwitch.current?.focus();
  }, [focusRequest, shown, ui]);
  if (!values) return null;
  const engine = values['ai.engine'];
  const info = AI_ENGINE_INFO[engine];
  const runTest = async () => {
    setTest({ engine, result: null });
    const res = await bridge.ai.test({ engine });
    setTest({ engine, result: res.ok ? res.data : { ok: false, message: res.error.message } });
  };
  return (
    <SettingsSection title="AI">
      <Switch label={AI_SETTING_LABEL} checked={values['ai.enabled']} switchRef={aiSwitch} onChange={(next) => set('ai.enabled', next)} />
      <p className="muted">{AI_SETTING_TEXT}</p>
      <SelectField
        label="Engine"
        value={engine}
        options={AI_ENGINES.map((e) => ({ value: e, label: AI_ENGINE_INFO[e].label }))}
        onChange={(v) => set('ai.engine', v as AiEngine)}
      />
      {info.kind === 'cli' ? (
        <>
          <p className="muted">{CLI_TEXT[info.cli]}</p>
          {config ? <CliProgram cli={info.cli} config={config} onConfig={setConfig} /> : null}
          <TextField
            label="Model (empty uses the tool's default)"
            value={values[info.cli === 'claude' ? 'ai.claudeModel' : 'ai.codexModel']}
            check={schemaCheck(CliModelSchema)}
            onCommit={(v) => set(info.cli === 'claude' ? 'ai.claudeModel' : 'ai.codexModel', v)}
          />
        </>
      ) : (
        <>
          {config ? <ApiKey provider={info.provider} config={config} onConfig={setConfig} /> : null}
          {info.provider === 'anthropic' ? (
            <div className="form-row">
              <SelectField
                label="Model"
                value={values['ai.anthropicModel']}
                options={ANTHROPIC_MODELS.map((m) => ({ value: m, label: m }))}
                onChange={(v) => set('ai.anthropicModel', v as SettingValue<'ai.anthropicModel'>)}
              />
              <SelectField
                label="Effort"
                value={values['ai.anthropicEffort']}
                options={ANTHROPIC_EFFORTS.map((e) => ({ value: e, label: e }))}
                onChange={(v) => set('ai.anthropicEffort', v as SettingValue<'ai.anthropicEffort'>)}
              />
            </div>
          ) : (
            <TextField label="Model" value={values['ai.openaiModel']} check={schemaCheck(ModelNameSchema)} onCommit={(v) => set('ai.openaiModel', v)} />
          )}
        </>
      )}
      <NumberField
        label="Stop an action after"
        unit="minutes"
        min={AI_TIMEOUT_MINUTES.min}
        max={AI_TIMEOUT_MINUTES.max}
        value={values['ai.timeoutMinutes']}
        onCommit={(v) => set('ai.timeoutMinutes', v)}
      />
      <div className="button-row">
        <button type="button" className="btn" disabled={test !== null && test.result === null} onClick={() => void runTest()}>
          Test {info.label}
        </button>
      </div>
      {test && test.engine === engine ? (
        <p role="status" className={test.result?.ok === false ? 'field-error' : 'muted'}>
          {test.result === null ? 'Testing…' : test.result.message}
        </p>
      ) : null}
    </SettingsSection>
  );
}
