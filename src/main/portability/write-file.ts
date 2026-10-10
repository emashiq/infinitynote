import fs from 'node:fs';

/** Writes a file the user chose through a `.part` file next to it, so a failed write never leaves half a file. */
export async function writeFileAtomically(file: string, data: string | Uint8Array): Promise<void> {
  const part = `${file}.part`;
  await fs.promises.writeFile(part, data);
  await fs.promises.rename(part, file);
}
