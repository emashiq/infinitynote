import fs from 'node:fs';
import { collectAttachmentRefs } from '../../shared/editor/doc-schema';
import { DAY_MS } from '../../shared/versions/retention';
import type { Db } from '../db/driver';
import { AttachmentsRepo } from '../db/repositories/attachments-repo';
import { DraftsRepo } from '../db/repositories/drafts-repo';
import { LinkedFilesRepo } from '../db/repositories/linked-files-repo';
import { VersionsRepo } from '../db/repositories/versions-repo';
import { errorDetail } from './app-error';
import { containedAttachmentFile } from './attachment-files';
import type { Clock } from './clock';
import type { Logger } from './logger';
import { ATTACHMENT_GC_GRACE_MS, MAX_OPEN_LEASE_LOST_DRAFTS, RESOLVED_DRAFT_KEEP_MS } from './retention-policy';
import type { SettingsService } from './settings-service';
import type { TrashService } from './trash-service';
import type { VersionService } from './version-service';
import type { DocumentService } from '../documents/document-service';
import type { DocumentStore } from '../documents/document-store';

export interface MaintenanceDeps {
  db: Db;
  clock: Clock;
  logger: Logger;
  /** `<userData>/data`; attachment files live under it. */
  dataDir: string;
  settings: Pick<SettingsService, 'getInternal'>;
  trash: Pick<TrashService, 'purgeDeletedBefore'>;
  versions: Pick<VersionService, 'pruneAutoVersions'>;
  documents: Pick<DocumentService, 'pruneVersions'>;
  documentStore: Pick<DocumentStore, 'collect'>;
  /** True while a backup, restore, export or import runs: attachment files are then left alone. */
  isBusy(): boolean;
}

export interface MaintenanceReport {
  trashedNotesPurged: number;
  versionsPruned: number;
  draftsCapped: number;
  draftsDeleted: number;
  attachmentsDeleted: number;
  /** Link records (D-108) that nothing used for the grace period; the linked files themselves are never touched. */
  linkedFilesDeleted: number;
  /** Document versions beyond the retention, and stored document bytes nothing used for the grace period (D-118). */
  documentVersionsPruned: number;
  documentBlobsDeleted: number;
}

/**
 * Retention and garbage collection (INF-PORT-07, INF-PORT-08, F-03-4), run at startup and every few hours: empties
 * Trash after the configured days (never by default), prunes automatic versions to the configured age and count,
 * caps open `lease_lost` drafts, deletes old resolved drafts and deletes attachment files, link records and document
 * bytes nobody uses any more; document versions follow the version retention.
 * Each step is independent; a failure is logged and the others still run.
 */
export class MaintenanceService {
  private readonly attachments: AttachmentsRepo;
  private readonly drafts: DraftsRepo;
  private readonly versionRows: VersionsRepo;
  private readonly links: LinkedFilesRepo;

  constructor(private readonly deps: MaintenanceDeps) {
    this.attachments = new AttachmentsRepo(deps.db);
    this.links = new LinkedFilesRepo(deps.db);
    this.drafts = new DraftsRepo(deps.db);
    this.versionRows = new VersionsRepo(deps.db);
  }

  private step<T>(name: string, fallback: T, fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      this.deps.logger.error(`maintenance: ${name} failed ${errorDetail(err)}`);
      return fallback;
    }
  }

  async run(): Promise<MaintenanceReport> {
    const now = this.deps.clock.now();
    const trashDays = this.deps.settings.getInternal('retention.trashDays');
    const report: MaintenanceReport = {
      trashedNotesPurged: this.step('trash', 0, () => (trashDays === null ? 0 : (this.deps.trash.purgeDeletedBefore(now - trashDays * DAY_MS)?.notes ?? 0))),
      versionsPruned: this.step('versions', 0, () => this.deps.versions.pruneAutoVersions(now)),
      draftsCapped: this.step('drafts', 0, () => this.drafts.capOpenLeaseLost(MAX_OPEN_LEASE_LOST_DRAFTS, now)),
      draftsDeleted: this.step('drafts', 0, () => this.drafts.deleteResolvedBefore(now - RESOLVED_DRAFT_KEEP_MS)),
      attachmentsDeleted: 0,
      linkedFilesDeleted: this.step('links', 0, () => this.links.deleteUnreferencedSince(now - ATTACHMENT_GC_GRACE_MS, now)),
      documentVersionsPruned: this.step('document versions', 0, () => this.deps.documents.pruneVersions(now)),
      documentBlobsDeleted: 0,
    };
    try {
      report.attachmentsDeleted = await this.collectAttachments(now);
    } catch (err) {
      this.deps.logger.error(`maintenance: attachment GC failed ${errorDetail(err)}`);
    }
    try {
      report.documentBlobsDeleted = this.deps.isBusy() ? 0 : await this.deps.documentStore.collect(now);
    } catch (err) {
      this.deps.logger.error(`maintenance: document GC failed ${errorDetail(err)}`);
    }
    this.deps.logger.info(`maintenance: ${JSON.stringify(report)}`);
    return report;
  }

  /** Attachments used only by open drafts still count as used, so a draft restore never loses its images. */
  private draftAttachmentIds(): string[] {
    const ids = new Set<string>();
    for (const draft of this.drafts.openContents()) {
      if (draft.format !== 'rich') continue;
      try {
        for (const ref of collectAttachmentRefs(JSON.parse(draft.content))) ids.add(ref.attachmentId);
      } catch {
        // An unreadable draft references nothing that can be restored.
      }
    }
    return [...ids];
  }

  /**
   * Deletes attachments that no note (live or trashed), version or open draft has used for the whole grace period.
   * The rows go in one transaction that re-checks the references; the files are removed after it commits.
   */
  async collectAttachments(now: number): Promise<number> {
    if (this.deps.isBusy()) return 0;
    const expired = this.deps.db.transaction(() => {
      this.attachments.reconcileReferences([...this.versionRows.referencedAttachmentIds(), ...this.draftAttachmentIds()], now);
      const rows = this.attachments.unreferencedSince(now - ATTACHMENT_GC_GRACE_MS);
      this.attachments.deleteRows(rows.map((r) => r.id));
      return rows;
    }, 'immediate');
    for (const row of expired) {
      const file = await containedAttachmentFile(this.deps.dataDir, row.managed_relative_path).catch(() => null);
      if (file) await fs.promises.rm(file, { force: true });
    }
    return expired.length;
  }
}
