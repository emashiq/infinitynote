import { protocol } from 'electron';
import { ATTACHMENT_SCHEME, DOCUMENT_SCHEME, HTML_DOCUMENT_SCHEME, RENDERER_SCHEME } from '../../shared/app-identity';

// Must run before app 'ready'. Imported first by main/index.ts.
protocol.registerSchemesAsPrivileged([
  { scheme: RENDERER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: ATTACHMENT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false, stream: true } },
  // Viewers fetch document bytes (with ranges) from the renderer origin, so this scheme takes part in CORS (D-118).
  { scheme: DOCUMENT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: HTML_DOCUMENT_SCHEME, privileges: { standard: true, secure: true, stream: true } },
]);
