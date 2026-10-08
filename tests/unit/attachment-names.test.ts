import { describe, expect, it } from 'vitest';
import { fileTooLarge, imageTooLarge, tooLargeMessage } from '../../src/shared/attachments/limits';
import { documentMime, extensionFor, formatBytes, sanitizeOriginalName } from '../../src/shared/attachments/names';

describe('attachment names', () => {
  it('keeps the last path segment without unsafe characters', () => {
    expect(sanitizeOriginalName('report final.pdf')).toBe('report final.pdf');
    expect(sanitizeOriginalName('C:\\Users\\me\\..\\secret\\plan.docx')).toBe('plan.docx');
    expect(sanitizeOriginalName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeOriginalName('a<b>:c"d|e?f*g\u0001.txt')).toBe('abcdefg.txt');
    expect(sanitizeOriginalName('বাংলা নথি.pdf')).toBe('বাংলা নথি.pdf');
    expect(sanitizeOriginalName('dir/')).toBeNull();
    expect(sanitizeOriginalName('..')).toBeNull();
    expect(sanitizeOriginalName('x'.repeat(300))).toHaveLength(255);
  });

  it('derives a safe lower-case extension and a recorded MIME type', () => {
    expect(extensionFor('report final.PDF')).toBe('pdf');
    expect(extensionFor('setup.exe')).toBe('exe');
    expect(extensionFor('archive.tar.gz')).toBe('gz');
    expect(extensionFor('no-extension')).toBe('bin');
    expect(extensionFor('weird.ex e')).toBe('bin');
    expect(extensionFor('long.abcdefghijk')).toBe('bin');
    expect(extensionFor(null)).toBe('bin');
    expect(documentMime('pdf')).toBe('application/pdf');
    expect(documentMime('exe')).toBe('application/octet-stream');
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024 + 512 * 1024)).toBe('5.5 MB');
  });

  it('builds the exact size-limit messages', () => {
    expect(imageTooLarge(20)).toBe('This image is larger than 20 MB. Use a smaller image.');
    expect(fileTooLarge(50)).toBe('This file is larger than 50 MB. Use a smaller file.');
    expect(tooLargeMessage('image', 1)).toBe('This image is larger than 1 MB. Use a smaller image.');
    expect(tooLargeMessage('document', 2)).toBe('This file is larger than 2 MB. Use a smaller file.');
  });
});
