import * as path from 'path';

export function fixFilenameEncoding(originalname: string): string {
  return Buffer.from(originalname, 'latin1').toString('utf8');
}

export function getFileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const typeMap: Record<string, string> = {
    '.pdf': 'pdf',
    '.xlsx': 'excel',
    '.xls': 'excel',
    '.csv': 'excel',
    '.png': 'image',
    '.jpg': 'image',
    '.jpeg': 'image',
    '.gif': 'image',
    '.webp': 'image',
  };
  return typeMap[ext] || 'text';
}
