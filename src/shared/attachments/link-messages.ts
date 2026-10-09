// String constants only. Imported by the preload, so it must stay free of zod and Node.

/** What the app says about linked files (D-108, D-115). */
export const LINK_MESSAGES = {
  notFound: (path: string): string => `File not found at ${path}`,
  unavailable: 'This linked file is no longer available',
  notAFile: 'Only files can be linked, not folders.',
  imageNotLinked: 'Images are always copied into Infinity Notes.',
  networkLocation: 'Files on a network location cannot be linked. Copy the file into Infinity Notes instead.',
  noPath: 'Only a file dropped or pasted from this computer can be linked.',
} as const;
