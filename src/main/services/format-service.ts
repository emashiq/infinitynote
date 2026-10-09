import { LOCK_MESSAGES } from '../../shared/contracts/locks';
import type { NoteContentResponseType, NoteConvertRequestType } from '../../shared/contracts/notes';
import { extractPlainText } from '../../shared/text/plain-text';
import { textToDoc } from '../../shared/text/textarea-doc';
import { storedContent } from '../db/repositories/notes-repo';
import { AppError } from './app-error';
import type { ContentOps } from './content-ops';
import type { IdGenerator } from './ids';
import type { VersionService } from './version-service';

/**
 * Converts a note between rich and plain text (INF-EDIT-04/05). The previous content is always kept as a
 * `conversion` version first, so a lossy rich-to-plain conversion can be undone with "Restore formatted version".
 */
export class FormatService {
  constructor(private readonly deps: { ids: IdGenerator; ops: ContentOps; versions: VersionService }) {}

  convert(req: NoteConvertRequestType): NoteContentResponseType {
    return this.deps.ops.run(req, (row, now) => {
      // A conversion keeps the previous content as a version, which a locked note never has (D-112).
      if (row.locked === 1) throw new AppError('VALIDATION_FAILED', LOCK_MESSAGES.noConvert);
      if (row.format === req.targetFormat) throw new AppError('VALIDATION_FAILED', `This note is already ${row.format === 'rich' ? 'rich text' : 'plain text'}`);
      const versionId = this.deps.versions.snapshot(row, 'conversion', now);
      const content =
        req.targetFormat === 'plain'
          ? extractPlainText('rich', storedContent(row))
          : // Block IDs are persisted from the start so references can target them.
            textToDoc(String(storedContent(row)), { id: () => this.deps.ids.uuid() });
      return { format: req.targetFormat, content, versionId };
    });
  }
}
