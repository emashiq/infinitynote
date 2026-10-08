export const APP_ID = 'com.infinitynotes.desktop';
export const PRODUCT_NAME = 'Infinity Notes';
export const NPM_NAME = 'infinity-notes';
export const LINUX_EXECUTABLE = 'infinity-notes';
export const RENDERER_SCHEME = 'infinity-app';
export const RENDERER_HOST = 'renderer';
export const ATTACHMENT_SCHEME = 'infinity-attachment';
export const APP_VERSION = '0.1.0';

/** The only URL form under which the renderer loads a stored image (INF-FND-08). */
export const attachmentUrl = (attachmentId: string): string => `${ATTACHMENT_SCHEME}://${attachmentId}`;
