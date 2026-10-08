import { protocol } from 'electron';
import { ATTACHMENT_SCHEME, RENDERER_SCHEME } from '../../shared/app-identity';

// Must run before app 'ready'. Imported first by main/index.ts.
protocol.registerSchemesAsPrivileged([
  { scheme: RENDERER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: ATTACHMENT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false, stream: true } },
]);
