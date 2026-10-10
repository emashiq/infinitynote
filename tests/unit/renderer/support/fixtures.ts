/** The part of Node that renderer tests use; they run under Node (Vitest) but are typed for the browser. */
interface NodeFs {
  readFileSync(file: string): Uint8Array;
}

/** The bytes of a sample document under tests/fixtures/documents (D-127). */
export function documentFixture(name: string): Uint8Array {
  const fs = (globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): NodeFs } }).process.getBuiltinModule('node:fs');
  return new Uint8Array(fs.readFileSync(`tests/fixtures/documents/${name}`));
}
