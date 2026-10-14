import os from 'node:os';
import { questionText, type AiAction } from '../../shared/ai/actions';
import { AI_CLI_LABEL, AI_ENGINE_INFO, AI_PROVIDER_LABEL, type AiCli, type AiEngine, type AiEngineInfo, type AiProvider } from '../../shared/ai/engines';
import { AI_MESSAGES, MAX_AI_MESSAGE_CHARS, MAX_AI_SELECTION_CHARS } from '../../shared/ai/limits';
import { describeAnchor, type CommentAnchorType } from '../../shared/comments/anchors';
import type { AiConfigType, AiFileOptionType, AiFileRefType, AiStatusType, AiTestResponseType } from '../../shared/contracts/ai';
import type { PickFilesResponseType } from '../../shared/contracts/attachments';
import { COMMENT_MESSAGES, type CommentTargetType, type CommentThreadDtoType } from '../../shared/contracts/comments';
import { collectCommentAnchors } from '../../shared/editor/doc-schema';
import type { AiThreadMessage, CommentService } from '../comments/comment-service';
import type { Db } from '../db/driver';
import { DocumentsRepo } from '../db/repositories/documents-repo';
import { NotesRepo, storedContent } from '../db/repositories/notes-repo';
import { AppError, errorDetail, errorMessage } from '../services/app-error';
import type { DialogAdapter } from '../services/dialog-adapter';
import type { FilePicker } from '../services/file-picker';
import type { Logger } from '../services/logger';
import { AI_API_HOSTS, aiRequestFetch, type FetchLike } from '../services/network-guard';
import type { SettingsService } from '../services/settings-service';
import { WHOLE_ITEM_PLACE, type AiContext, type PlacedFile } from './ai-context';
import type { AiKeys } from './ai-keys';
import type { StoredAiMetaType } from './ai-meta';
import { AI_SYSTEM_PROMPT, cliPrompt, deliverFiles, firstQuestionText, type FileDelivery } from './ai-prompt';
import { removeWorkRoot, withWorkDir } from './ai-workdir';
import { checkAnthropicKey, runAnthropic } from './engines/anthropic-api';
import { claudeArgs, parseClaudeOutput } from './engines/claude-code';
import { locateCli } from './engines/cli-locate';
import { CliStartError, NODE_CLI_PROCESS, runCli, type CliProcessDeps } from './engines/cli-process';
import { codexArgs, parseCodexOutput } from './engines/codex';
import { EngineError, outputTail, type EngineAnswer, type EngineBlock, type EngineTurn } from './engines/engine';
import { checkOpenAiKey, runOpenAi } from './engines/openai-api';

/** How long Settings → AI "Test" waits for a tool's version or a key check. */
const TEST_TIMEOUT_MS = 20_000;

/** Why a run was aborted: Stop, or the timeout. */
class RunStopped extends Error {
  constructor(readonly timedOutAfter: number | null) {
    super(timedOutAfter === null ? AI_MESSAGES.stopped : AI_MESSAGES.timedOut(timedOutAfter));
    this.name = 'RunStopped';
  }
}

interface Run {
  controller: AbortController;
  done: Promise<void>;
}

/** What a run adds to its thread. */
interface RunResult {
  role: 'assistant' | 'error';
  body: string;
  meta: Omit<StoredAiMetaType, 'attachments' | 'context'>;
}

/** One turn to run: the conversation, the files of its first question and the session to resume, if any. */
interface Turn {
  threadId: string;
  engine: AiEngine;
  turns: EngineTurn[];
  files: FileDelivery[];
  resume: string | null;
}

export interface AiServiceDeps {
  db: Db;
  logger: Logger;
  settings: SettingsService;
  comments: CommentService;
  context: AiContext;
  keys: AiKeys;
  picker: FilePicker;
  dialog: Pick<DialogAdapter, 'showOpenFile'>;
  /** Where the command-line tools' working folders are made: the user's own `<userData>/ai-work` (D-195). */
  workRoot: string;
  /** How tools start; tests run fake tools through the real process code. */
  processes?: CliProcessDeps;
  /** The transport under the per-request network guard; tests answer from a fake. */
  apiFetch?: FetchLike;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** The length of a timeout minute; tests shorten it. */
  minuteMs?: number;
}

/**
 * AI actions on a selected part (F4, D-190..D-193). Main checks everything a renderer asks: the feature is on, the
 * notice was confirmed, the item may be sent (live, never locked, a rich note, a PDF or a web page), and the files
 * belong to it. An action becomes an AI thread with its question at once; the engine answers in the background and
 * `wait` resolves when it has. Stop and the timeout end the run (and a tool's whole process tree); the answer or what
 * went wrong is added to the thread either way.
 */
export class AiService {
  private readonly runs = new Map<string, Run>();
  /** Threads whose follow-up is being prepared: reserved before the first await, so a second one is refused (D-195). */
  private readonly starting = new Set<string>();
  private readonly notes: NotesRepo;
  private readonly documents: DocumentsRepo;

  constructor(private readonly deps: AiServiceDeps) {
    this.notes = new NotesRepo(deps.db);
    this.documents = new DocumentsRepo(deps.db);
  }

  isRunning(threadId: string): boolean {
    return this.runs.has(threadId);
  }

  // Status and Settings ------------------------------------------------------------------------------------------------

  async status(): Promise<AiStatusType> {
    const engine = this.deps.settings.getInternal('ai.engine');
    return {
      enabled: this.deps.settings.getInternal('ai.enabled'),
      engine,
      acknowledged: this.deps.settings.getInternal('ai.acknowledged').includes(engine),
      problem: await this.problem(engine),
    };
  }

  /** The first-use notice of an engine was confirmed (from any window). */
  async acknowledge(engine: AiEngine): Promise<AiStatusType> {
    const seen = this.deps.settings.getInternal('ai.acknowledged');
    if (!seen.includes(engine)) this.deps.settings.setInternal('ai.acknowledged', [...seen, engine]);
    return this.status();
  }

  config(): AiConfigType {
    const { keys } = this.deps;
    return { keys: { anthropic: keys.has('anthropic'), openai: keys.has('openai') }, keyStorage: keys.canStore(), cliPaths: this.deps.settings.getInternal('ai.cliPaths') };
  }

  setKey(provider: AiProvider, key: string | null): AiConfigType {
    this.deps.keys.set(provider, key);
    return this.config();
  }

  /** "Choose…" picks the tool's program in main's dialog; "Use PATH" forgets it. */
  async cliPath(cli: AiCli, action: 'pick' | 'clear', ctx: { webContentsId: number }): Promise<AiConfigType> {
    const paths = this.deps.settings.getInternal('ai.cliPaths');
    if (action === 'clear') {
      this.deps.settings.setInternal('ai.cliPaths', { ...paths, [cli]: null });
      return this.config();
    }
    const windows = this.platform() === 'win32';
    const chosen = await this.deps.dialog.showOpenFile({
      webContentsId: ctx.webContentsId,
      title: `Choose the ${AI_CLI_LABEL[cli]} program`,
      filters: windows ? [{ name: 'Programs', extensions: ['exe', 'cmd', 'bat'] }] : undefined,
    });
    if (chosen === null) return this.config();
    if ((await locateCli(cli, chosen, this.env(), this.platform())) === null) throw new AppError('VALIDATION_FAILED', `This is not a program ${AI_CLI_LABEL[cli]} can run from`);
    this.deps.settings.setInternal('ai.cliPaths', { ...paths, [cli]: chosen });
    this.deps.logger.info(`ai: program chosen cli=${cli}`);
    return this.config();
  }

  /** Settings → AI "Test": a tool's version, or whether a key works with the chosen model. */
  async test(engine: AiEngine): Promise<AiTestResponseType> {
    const info = AI_ENGINE_INFO[engine];
    const signal = AbortSignal.timeout(TEST_TIMEOUT_MS);
    try {
      if (info.kind === 'cli') {
        const file = await this.cli(info.cli);
        const out = await runCli({ file, args: ['--version'], cwd: os.tmpdir(), stdin: '', signal, env: this.env() }, this.processes());
        const version = outputTail(out.stdout);
        if (out.code !== 0 || version === '') throw new EngineError(`${AI_CLI_LABEL[info.cli]} did not start${outputTail(out.stderr) ? `: ${outputTail(out.stderr)}` : ''}`);
        return { ok: true, message: `${AI_CLI_LABEL[info.cli]} ${version}` };
      }
      const apiKey = this.key(info.provider);
      const guard = aiRequestFetch(AI_API_HOSTS[info.provider], this.deps.logger, this.deps.apiFetch);
      try {
        const message =
          info.provider === 'anthropic'
            ? await checkAnthropicKey({ apiKey, model: this.deps.settings.getInternal('ai.anthropicModel'), fetch: guard.fetch, signal })
            : await checkOpenAiKey({ apiKey, model: this.deps.settings.getInternal('ai.openaiModel'), fetch: guard.fetch, signal });
        return { ok: true, message };
      } finally {
        guard.close();
      }
    } catch (err) {
      return { ok: false, message: this.failureText(err) };
    }
  }

  // Actions --------------------------------------------------------------------------------------------------------------

  /** The files of a note the Ask AI panel offers. */
  async fileOptions(target: CommentTargetType): Promise<{ files: AiFileOptionType[] }> {
    this.sendable(target);
    return { files: await this.deps.context.options(target) };
  }

  pickFiles(ctx: { webContentsId: number }): Promise<PickFilesResponseType> {
    return this.deps.picker.pickForAi(ctx);
  }

  /** Runs an action: the thread is made with its question and returned at once; the answer follows (`wait`). */
  async ask(
    req: {
      target: CommentTargetType;
      anchor: CommentAnchorType;
      quote: string;
      selection: string;
      action: AiAction;
      prompt: string;
      wholeItem: boolean;
      files: AiFileRefType[];
      picked: { pickId: string; indexes: number[] } | null;
    },
    ctx: { webContentsId: number },
  ): Promise<{ thread: CommentThreadDtoType }> {
    const engine = await this.readyEngine();
    this.sendable(req.target);
    const pickedPaths = req.picked ? [...new Set(req.picked.indexes)].map((index) => this.deps.picker.claim({ pickId: req.picked!.pickId, index }, 'ai', ctx).path) : [];
    const files = await this.deps.context.gather(req.target, req.files, pickedPaths);
    const { whole, wholeFile } = await this.whole(req.target, req.wholeItem || this.needsDocument(req.target, req.selection));
    const all = withWhole(files, wholeFile);
    const meta: StoredAiMetaType = {
      ...this.engineMeta(engine),
      attachments: all.map(({ file }) => ({ name: file.name, sizeBytes: file.sizeBytes })),
      context: { action: req.action, prompt: req.prompt, wholeItem: req.wholeItem, files: req.files },
    };
    const { thread } = this.deps.comments.createAi({ target: req.target, anchor: req.anchor, quote: req.quote, body: questionText(req.action, req.prompt), meta });
    const deliveries = deliverFiles(all, AI_ENGINE_INFO[engine].kind);
    const first = firstQuestionText({
      item: this.deps.context.describe(req.target),
      place: describeAnchor(req.anchor),
      selection: req.selection.slice(0, MAX_AI_SELECTION_CHARS),
      whole,
      files: deliveries,
      action: req.action,
      prompt: req.prompt,
    });
    this.start({ threadId: thread.id, engine, turns: [{ role: 'user', text: first }], files: deliveries, resume: null });
    this.deps.logger.info(`ai: action started thread=${thread.id} engine=${engine} action=${req.action} files=${all.length}`);
    return this.deps.comments.get(thread.id);
  }

  /**
   * A follow-up question (D-194): a tool resumes its session when the engine is the one that answered last; otherwise (an
   * API, another engine, an imported thread) the conversation is sent again with the part, the item and the files as
   * they are now (files picked from disk are not kept, so they are not sent again).
   */
  async followUp(req: { threadId: string; prompt: string }): Promise<{ thread: CommentThreadDtoType }> {
    if (this.runs.has(req.threadId) || this.starting.has(req.threadId)) throw new AppError('CONFLICT', AI_MESSAGES.running);
    this.starting.add(req.threadId);
    try {
      return await this.startFollowUp(req);
    } finally {
      this.starting.delete(req.threadId);
    }
  }

  private async startFollowUp(req: { threadId: string; prompt: string }): Promise<{ thread: CommentThreadDtoType }> {
    const engine = await this.readyEngine();
    const { target } = this.deps.comments.threadTarget(req.threadId);
    this.sendable(target);
    const history = this.deps.comments.aiHistory(req.threadId);
    const context = history.messages[0]?.meta?.context ?? { action: 'custom' as const, prompt: history.messages[0]?.body ?? '', wholeItem: false, files: [] };
    const files = await this.deps.context.gather(target, context.files, [], { skipMissing: true });
    const selection = this.anchoredText(target, req.threadId, history.quote);
    const { whole, wholeFile } = await this.whole(target, context.wholeItem || this.needsDocument(target, selection));
    const deliveries = deliverFiles(withWhole(files, wholeFile), AI_ENGINE_INFO[engine].kind);
    const first = firstQuestionText({
      item: this.deps.context.describe(target),
      place: describeAnchor(history.anchor),
      selection,
      whole,
      files: deliveries,
      action: context.action,
      prompt: context.prompt,
    });
    const turns = conversation(first, history.messages.slice(1), req.prompt);
    const resume = AI_ENGINE_INFO[engine].kind === 'cli' ? lastSession(history.messages, engine) : null;
    const { thread } = this.deps.comments.appendAi(req.threadId, { role: 'user', body: req.prompt, meta: { ...this.engineMeta(engine), attachments: [] } });
    this.start({ threadId: thread.id, engine, turns, files: deliveries, resume });
    this.deps.logger.info(`ai: follow-up started thread=${thread.id} engine=${engine} resume=${resume !== null}`);
    return this.deps.comments.get(thread.id);
  }

  /** Resolves when the thread's run has ended (at once when none runs), with the thread as it is then. */
  async wait(threadId: string): Promise<{ thread: CommentThreadDtoType }> {
    this.deps.comments.aiHistory(threadId);
    await this.runs.get(threadId)?.done;
    return this.deps.comments.get(threadId);
  }

  stop(threadId: string): { stopped: boolean } {
    const run = this.runs.get(threadId);
    run?.controller.abort(new RunStopped(null));
    return { stopped: run !== undefined };
  }

  thread(threadId: string): { thread: CommentThreadDtoType } {
    this.deps.comments.aiHistory(threadId);
    return this.deps.comments.get(threadId);
  }

  /** Deletes an AI thread; a run of it is stopped first and its answer dropped. */
  async deleteThread(threadId: string): Promise<{ deleted: true }> {
    this.deps.comments.aiHistory(threadId);
    const run = this.runs.get(threadId);
    if (run) {
      run.controller.abort(new RunStopped(null));
      await run.done;
    }
    return this.deps.comments.deleteThread(threadId);
  }

  /**
   * Stops every run as the app quits: each ends its tool's process tree, and the working folders go at once, since the
   * runs cannot clean up after the process is gone (D-195). What a tool still holds is left to the next start.
   */
  stopAll(): void {
    if (this.runs.size === 0) return;
    for (const run of this.runs.values()) run.controller.abort(new RunStopped(null));
    this.clearWorkRoot('at quit');
  }

  /** At startup: removes the working folders a quit, crash or power cut during a run left, with their copies (D-195). */
  removeLeftoverWorkDirs(): void {
    const removed = this.clearWorkRoot('at start');
    if (removed > 0) this.deps.logger.info(`ai: removed ${removed} leftover working folder(s)`);
  }

  private clearWorkRoot(when: string): number {
    try {
      return removeWorkRoot(this.deps.workRoot);
    } catch (err) {
      this.deps.logger.warn(`ai: working folders not removed ${when}: ${errorMessage(err)}`);
      return 0;
    }
  }

  // Runs -----------------------------------------------------------------------------------------------------------------

  private start(turn: Turn): void {
    const controller = new AbortController();
    const minutes = this.deps.settings.getInternal('ai.timeoutMinutes');
    const meta = this.engineMeta(turn.engine);
    const timer = setTimeout(() => controller.abort(new RunStopped(minutes)), minutes * (this.deps.minuteMs ?? 60_000));
    const done = this.execute(turn, controller.signal)
      .then(
        (answer): RunResult => ({ role: 'assistant', body: answerBody(answer), meta: { ...meta, model: answer.model, sessionId: answer.sessionId, costUsd: answer.costUsd } }),
        (err: unknown): RunResult => ({ role: 'error', body: this.failureText(err), meta }),
      )
      .then((result) => this.record(turn, result))
      .finally(() => {
        clearTimeout(timer);
        this.runs.delete(turn.threadId);
      });
    this.runs.set(turn.threadId, { controller, done });
  }

  /** Adds the answer or the failure; a thread deleted, trashed or locked meanwhile keeps nothing. */
  private record(turn: Turn, message: RunResult): void {
    try {
      this.deps.comments.appendAi(turn.threadId, { ...message, meta: { ...message.meta, attachments: [] } });
      this.deps.logger.info(`ai: ${message.role === 'assistant' ? 'answered' : 'failed'} thread=${turn.threadId} engine=${turn.engine}`);
    } catch (err) {
      this.deps.logger.warn(`ai: result dropped thread=${turn.threadId} reason=${errorMessage(err)}`);
    }
  }

  private async execute(turn: Turn, signal: AbortSignal): Promise<EngineAnswer> {
    const info = AI_ENGINE_INFO[turn.engine];
    if (info.kind === 'cli') return this.executeCli(turn, info, signal);
    const blocks: EngineBlock[] = turn.files.flatMap((d) => (d.how === 'block' && d.file.kind !== 'text' ? [{ kind: d.file.kind, name: d.file.name, mime: d.file.mime, bytes: d.file.bytes }] : []));
    const apiKey = this.key(info.provider);
    const guard = aiRequestFetch(AI_API_HOSTS[info.provider], this.deps.logger, this.deps.apiFetch);
    try {
      return info.provider === 'anthropic'
        ? await runAnthropic({
            apiKey,
            model: this.deps.settings.getInternal('ai.anthropicModel'),
            effort: this.deps.settings.getInternal('ai.anthropicEffort'),
            system: AI_SYSTEM_PROMPT,
            turns: turn.turns,
            blocks,
            fetch: guard.fetch,
            signal,
          })
        : await runOpenAi({ apiKey, model: this.deps.settings.getInternal('ai.openaiModel'), system: AI_SYSTEM_PROMPT, turns: turn.turns, blocks, fetch: guard.fetch, signal });
    } finally {
      guard.close();
    }
  }

  private async executeCli(turn: Turn, info: Extract<AiEngineInfo, { kind: 'cli' }>, signal: AbortSignal): Promise<EngineAnswer> {
    const file = await this.cli(info.cli);
    const model = this.cliModel(info.cli);
    const prompt = turn.resume ? turn.turns[turn.turns.length - 1]!.text : cliPrompt(turn.turns);
    const images = turn.resume ? [] : turn.files.flatMap((d) => (d.how === 'folder' && d.file.kind === 'image' ? [d.workName] : []));
    const args = info.cli === 'claude' ? claudeArgs({ model, sessionId: turn.resume }) : codexArgs({ model, sessionId: turn.resume, images });
    return withWorkDir(this.deps.workRoot, turn.threadId, turn.files, async (cwd) => {
      const out = await runCli({ file, args, cwd, stdin: prompt, signal, env: this.env() }, this.processes());
      return info.cli === 'claude' ? parseClaudeOutput(out) : parseCodexOutput(out, model);
    });
  }

  // Checks ---------------------------------------------------------------------------------------------------------------

  /** The engine to run, after the switch, the notice and its setup; FORBIDDEN or VALIDATION_FAILED otherwise. */
  private async readyEngine(): Promise<AiEngine> {
    const status = await this.status();
    if (!status.enabled) throw new AppError('FORBIDDEN', AI_MESSAGES.off);
    if (!status.acknowledged) throw new AppError('FORBIDDEN', AI_MESSAGES.notice);
    if (status.problem) throw new AppError('VALIDATION_FAILED', status.problem);
    return status.engine;
  }

  /** What must be set up before an engine runs, or null. */
  private async problem(engine: AiEngine): Promise<string | null> {
    const info = AI_ENGINE_INFO[engine];
    if (info.kind === 'api') return this.deps.keys.has(info.provider) ? null : AI_MESSAGES.noKey(AI_PROVIDER_LABEL[info.provider]);
    return (await this.locate(info.cli)) === null ? AI_MESSAGES.noCli(AI_CLI_LABEL[info.cli]) : null;
  }

  /** An item may be sent: live, not locked (never, not even while unlocked), a rich note, a PDF or a web page. */
  private sendable(target: CommentTargetType): void {
    if (target.kind === 'note') {
      const note = this.notes.getContentRow(target.id);
      if (!note || note.deleted_at !== null) throw new AppError('NOT_FOUND', COMMENT_MESSAGES.itemMissing);
      if (note.locked === 1) throw new AppError('FORBIDDEN', AI_MESSAGES.locked);
      if (note.format !== 'rich') throw new AppError('VALIDATION_FAILED', AI_MESSAGES.plainNote);
      return;
    }
    const document = this.documents.get(target.id);
    if (!document || document.deleted_at !== null) throw new AppError('NOT_FOUND', COMMENT_MESSAGES.itemMissing);
    if (document.locked === 1) throw new AppError('FORBIDDEN', AI_MESSAGES.locked);
    if (document.kind !== 'pdf' && document.kind !== 'html') throw new AppError('VALIDATION_FAILED', AI_MESSAGES.documentKind);
  }

  /** A PDF page without selected text is sent as the PDF itself. */
  private needsDocument(target: CommentTargetType, selection: string): boolean {
    return target.kind === 'document' && selection.trim() === '' && this.documents.get(target.id)?.kind === 'pdf';
  }

  private async whole(target: CommentTargetType, wanted: boolean): Promise<{ whole: string | null; wholeFile: PlacedFile | null }> {
    if (!wanted) return { whole: null, wholeFile: null };
    const item = await this.deps.context.wholeItem(target);
    return 'text' in item ? { whole: item.text, wholeFile: null } : { whole: null, wholeFile: { file: item.file, place: WHOLE_ITEM_PLACE } };
  }

  /** The part a note's thread is anchored to now (its marked text), else the quote kept with the thread. */
  private anchoredText(target: CommentTargetType, threadId: string, quote: string): string {
    if (target.kind !== 'note') return quote;
    const row = this.notes.getContentRow(target.id);
    if (!row || row.format !== 'rich') return quote;
    return collectCommentAnchors(storedContent(row), MAX_AI_SELECTION_CHARS).get(threadId)?.quote ?? quote;
  }

  private engineMeta(engine: AiEngine): Omit<StoredAiMetaType, 'attachments' | 'context'> {
    return { engine, model: this.configuredModel(engine), sessionId: null, costUsd: null };
  }

  private configuredModel(engine: AiEngine): string | null {
    const info = AI_ENGINE_INFO[engine];
    if (info.kind === 'cli') return this.cliModel(info.cli) || null;
    return this.deps.settings.getInternal(info.provider === 'anthropic' ? 'ai.anthropicModel' : 'ai.openaiModel');
  }

  private cliModel(cli: AiCli): string {
    return this.deps.settings.getInternal(cli === 'claude' ? 'ai.claudeModel' : 'ai.codexModel');
  }

  private locate(cli: AiCli): Promise<string | null> {
    return locateCli(cli, this.deps.settings.getInternal('ai.cliPaths')[cli], this.env(), this.platform());
  }

  private async cli(cli: AiCli): Promise<string> {
    const file = await this.locate(cli);
    if (file === null) throw new EngineError(AI_MESSAGES.noCli(AI_CLI_LABEL[cli]));
    return file;
  }

  private key(provider: AiProvider): string {
    const key = this.deps.keys.get(provider);
    if (key === null) throw new EngineError(AI_MESSAGES.noKey(AI_PROVIDER_LABEL[provider]));
    return key;
  }

  /** What the thread or the Test result says about a failure; an unexpected one is logged and named generally. */
  private failureText(err: unknown): string {
    if (err instanceof RunStopped || err instanceof EngineError || err instanceof AppError) return err.message;
    if (err instanceof CliStartError) return `The tool could not be started. Check it in Settings → AI.${err.code ? ` (${err.code})` : ''}`;
    this.deps.logger.error(`ai: run failed ${errorDetail(err)}`);
    return `Something went wrong: ${errorMessage(err).slice(0, 200)}`;
  }

  private processes(): CliProcessDeps {
    return this.deps.processes ?? NODE_CLI_PROCESS;
  }

  private env(): NodeJS.ProcessEnv {
    return this.deps.env ?? process.env;
  }

  private platform(): NodeJS.Platform {
    return this.deps.platform ?? process.platform;
  }
}

/** An action's files: the gathered ones, then the whole document when it goes as a file. */
function withWhole(files: PlacedFile[], wholeFile: PlacedFile | null): PlacedFile[] {
  return wholeFile ? [...files, wholeFile] : files;
}

/** The answer as stored: cut at the limit, with what the engine said about it. */
function answerBody(answer: EngineAnswer): string {
  const notes = [answer.text.length > MAX_AI_MESSAGE_CHARS ? AI_MESSAGES.cut : null, answer.notice].filter((n): n is string => n !== null);
  const suffix = notes.length > 0 ? `\n\n_${notes.join(' ')}_` : '';
  return answer.text.slice(0, MAX_AI_MESSAGE_CHARS - suffix.length) + suffix;
}

/**
 * The conversation for a follow-up: the first question (rebuilt), then the thread's answers and questions without its
 * errors, then the new question. Turns of the same role in a row (a question whose answer failed) are joined, so the
 * roles alternate as the APIs expect.
 */
export function conversation(first: string, later: readonly AiThreadMessage[], question: string): EngineTurn[] {
  const turns: EngineTurn[] = [{ role: 'user', text: first }];
  for (const m of [...later.filter((m) => m.role !== 'error'), { role: 'user' as const, body: question, meta: null }]) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const last = turns[turns.length - 1]!;
    if (last.role === role) last.text = `${last.text}\n\n${m.body}`;
    else turns.push({ role, text: m.body });
  }
  return turns;
}

/** The session of the last answer when that engine answered it; a tool resumes only its own session. */
export function lastSession(messages: readonly AiThreadMessage[], engine: AiEngine): string | null {
  const answer = [...messages].reverse().find((m) => m.role === 'assistant');
  return answer?.meta?.engine === engine ? (answer.meta.sessionId ?? null) : null;
}
