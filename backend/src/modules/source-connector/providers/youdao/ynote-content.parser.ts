import { Injectable } from '@nestjs/common';

const MAX_PARSE_BYTES = 200 * 1024;
const MAX_OUTPUT_CHARS = 50_000;
const MAX_FIELD_CHARS = 8_000;

@Injectable()
export class YnoteContentParser {
  parse(raw: string | Buffer, title: string): string {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
    if (buf.length === 0) return '';

    const slice = buf.length > MAX_PARSE_BYTES ? buf.subarray(0, MAX_PARSE_BYTES) : buf;
    const text = slice.toString('utf8');
    if (!text.trim()) return '';

    if (text.includes('<note') || text.includes('<?xml') || text.startsWith('<')) {
      return this.limitOutput(this.parseXmlNote(text, title));
    }

    const fields = this.extractEightFields(text);
    if (fields.length > 0) {
      const lines = title ? [`# ${title}`, ...fields] : fields;
      return this.limitOutput(lines.join('\n\n'));
    }

    const plain = text.trim();
    if (plain.length > 50) {
      return this.limitOutput(title ? `# ${title}\n\n${plain}` : plain);
    }

    return title ? `# ${title}\n\n[未能解析笔记正文]` : '';
  }

  private limitOutput(text: string): string {
    if (text.length <= MAX_OUTPUT_CHARS) return text;
    return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[内容已截断]`;
  }

  /** 线性扫描提取有道 JSON 中 "8" 字段，避免 JSON.parse / 灾难性正则回溯 */
  private extractEightFields(text: string): string[] {
    const out: string[] = [];
    let i = 0;

    while (i < text.length && out.length < 200) {
      const pos = text.indexOf('"8"', i);
      if (pos < 0) break;

      let j = pos + 3;
      while (j < text.length && text[j] !== ':') j++;
      if (j >= text.length) break;
      j++;
      while (j < text.length && (text[j] === ' ' || text[j] === '\n' || text[j] === '\r')) j++;
      if (text[j] !== '"') {
        i = pos + 3;
        continue;
      }
      j++;

      const chars: string[] = [];
      while (j < text.length) {
        const c = text[j];
        if (c === '\\' && j + 1 < text.length) {
          chars.push(text[j + 1]);
          j += 2;
          continue;
        }
        if (c === '"') break;
        chars.push(c);
        j++;
        if (chars.length > MAX_FIELD_CHARS) break;
      }

      const val = chars.join('').trim();
      if (val && val.length <= MAX_FIELD_CHARS && !out.includes(val)) {
        out.push(val);
      }
      i = j + 1;
    }

    return out;
  }

  private parseXmlNote(xml: string, title: string): string {
    const lines: string[] = [];
    if (title) lines.push(`# ${title}`);

    let pos = 0;
    while (pos < xml.length && lines.length < 200) {
      const start = xml.indexOf('<![CDATA[', pos);
      if (start < 0) break;
      const end = xml.indexOf(']]>', start);
      if (end < 0) break;
      const inner = xml.slice(start + 9, end).trim();
      if (inner && inner.length <= MAX_FIELD_CHARS) lines.push(inner);
      pos = end + 3;
    }

    return lines.join('\n\n').trim();
  }
}
