import { Injectable, BadRequestException } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { SourceAccount } from '@prisma/client';
import {
  ConnectorCapabilities,
  DocumentConnector,
  FetchedDocument,
  RemoteTarget,
} from '../../types/connector.interface';
import { CredentialService } from '../../credential.service';
import { YnoteContentParser } from './ynote-content.parser';

interface YoudaoFileEntry {
  fileId?: string;
  id?: string;
  name?: string;
  title?: string;
  version?: number;
  modifyTime?: number;
  createTime?: number;
  filePath?: string;
  subdir?: boolean;
  dir?: boolean;
  type?: number;
  fileEntry?: YoudaoFileEntry;
}

interface YoudaoCredentials {
  cookie: string;
  cstk: string;
}

@Injectable()
export class YoudaoCookieConnector implements DocumentConnector {
  readonly provider = 'youdao' as const;

  readonly capabilities: ConnectorCapabilities = {
    oauth: false,
    manualCredential: true,
    listTargets: true,
    incremental: true,
  };

  constructor(
    private credentialService: CredentialService,
    private contentParser: YnoteContentParser,
  ) {}

  private getClient(creds: YoudaoCredentials): AxiosInstance {
    return axios.create({
      baseURL: 'https://note.youdao.com',
      proxy: false,
      headers: {
        Cookie: creds.cookie,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://note.youdao.com/web/',
      },
      timeout: 30000,
    });
  }

  private parseEntries(data: unknown): YoudaoFileEntry[] {
    if (!data || typeof data !== 'object') return [];
    const obj = data as Record<string, unknown>;
    const raw = obj.entries ?? obj.data ?? obj.children;
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => this.flattenEntry(item as YoudaoFileEntry));
  }

  private flattenEntry(entry: YoudaoFileEntry): YoudaoFileEntry {
    if (entry.fileEntry) {
      return { ...entry.fileEntry, fileEntry: entry.fileEntry };
    }
    return entry;
  }

  private extractRootId(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const obj = data as Record<string, unknown>;
    const fileEntry = obj.fileEntry as Record<string, unknown> | undefined;
    const id = fileEntry?.id ?? obj.id ?? obj.fileId;
    return id != null ? String(id) : undefined;
  }

  private resolveCreds(account: SourceAccount): YoudaoCredentials {
    const payload = this.credentialService.getPayload(account) as unknown as YoudaoCredentials;
    if (!payload.cookie) {
      throw new BadRequestException('缺少 Cookie 凭据');
    }

    // If cstk is not stored, try to extract from cookie string
    let cstk = payload.cstk;
    if (!cstk) {
      cstk = this.extractCstkFromCookie(payload.cookie);
    }

    if (!cstk) {
      throw new BadRequestException('Cookie 中缺少 cstk，请重新连接');
    }

    return { cookie: payload.cookie, cstk };
  }

  /**
   * Extract cstk from cookie string
   * Cookie format: YNOTE_SESS=...; YNOTE_CSTK=xxx; ...
   * Or from request params: keyfrom=web&cstk=xxx
   */
  private extractCstkFromCookie(cookie: string): string | undefined {
    // Try to find YNOTE_CSTK in cookie
    const cstkMatch = cookie.match(/YNOTE_CSTK=([^;]+)/);
    if (cstkMatch) {
      return cstkMatch[1];
    }

    // Try to find cstk in URL-encoded format
    const urlCstkMatch = cookie.match(/cstk=([^;&]+)/);
    if (urlCstkMatch) {
      return urlCstkMatch[1];
    }

    return undefined;
  }

  /**
   * Parse a raw cookie string and extract both cookie and cstk
   * Used by the login endpoint to auto-extract cstk
   */
  static parseCookieAndCstK(rawCookie: string): { cookie: string; cstk: string } {
    const cstk = rawCookie.match(/YNOTE_CSTK=([^;]+)/)?.[1]
      ?? rawCookie.match(/cstk=([^;&]+)/)?.[1];

    if (!cstk) {
      throw new BadRequestException(
        '无法从 Cookie 中提取 cstk，请确保 Cookie 包含 YNOTE_CSTK 字段。' +
        '请在浏览器 Network 中复制完整的 Cookie 值。',
      );
    }

    return { cookie: rawCookie.trim(), cstk };
  }

  private async fetchRootId(client: AxiosInstance, cstk: string): Promise<string> {
    const rootRes = await client.post(
      `/yws/api/personal/file?method=getByPath&keyfrom=web&cstk=${encodeURIComponent(cstk)}`,
      new URLSearchParams({
        path: '/',
        entire: 'true',
        purge: 'false',
        cstk,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    const rootId = this.extractRootId(rootRes.data);
    if (!rootId) {
      throw new BadRequestException(
        '无法获取有道云笔记根目录，请检查 Cookie/cstk 是否过期',
      );
    }
    return rootId;
  }

  async listTargets(account: SourceAccount, parentId?: string): Promise<RemoteTarget[]> {
    const creds = this.resolveCreds(account);
    const client = this.getClient(creds);

    if (!parentId) {
      parentId = await this.fetchRootId(client, creds.cstk);
    }

    const listRes = await client.get(`/yws/api/personal/file/${parentId}`, {
      params: {
        all: true,
        f: true,
        len: 1000,
        sort: 1,
        isReverse: false,
        method: 'listPageByParentId',
        keyfrom: 'web',
        cstk: creds.cstk,
      },
    });

    return this.parseEntries(listRes.data).map((entry) => this.mapEntry(entry));
  }

  async listAllNotes(account: SourceAccount): Promise<RemoteTarget[]> {
    const creds = this.resolveCreds(account);
    const client = this.getClient(creds);
    const rootId = await this.fetchRootId(client, creds.cstk);

    const notes: RemoteTarget[] = [];
    await this.walkDir(account, client, creds, rootId, notes);
    return notes.filter((n) => !n.isFolder && n.externalId);
  }

  private async walkDir(
    account: SourceAccount,
    client: AxiosInstance,
    creds: YoudaoCredentials,
    dirId: string,
    notes: RemoteTarget[],
  ): Promise<void> {
    const children = await this.listTargets(account, dirId);
    for (const child of children) {
      if (child.isFolder) {
        await this.walkDir(account, client, creds, child.externalId, notes);
      } else {
        notes.push(child);
      }
    }
  }

  private mapEntry(entry: YoudaoFileEntry): RemoteTarget {
    const fe = entry.fileEntry ?? entry;
    const externalId = String(fe.id ?? fe.fileId ?? entry.id ?? entry.fileId ?? '');
    const isFolder = Boolean(fe.dir ?? entry.dir ?? entry.subdir);
    const modifyTime = (fe as YoudaoFileEntry & { modifyTimeForSort?: number }).modifyTimeForSort
      ?? fe.modifyTime
      ?? entry.modifyTime;
    const modifiedAt = modifyTime ? new Date(modifyTime) : undefined;
    const title = fe.name ?? entry.name ?? entry.title ?? '未命名';

    return {
      externalId,
      title,
      mimeType: isFolder ? 'folder' : 'note',
      modifiedAt,
      isFolder,
      url: fe.filePath
        ? `https://note.youdao.com${fe.filePath}`
        : `https://note.youdao.com/yws/public/note/${externalId}`,
    };
  }

  async fetchDocument(
    account: SourceAccount,
    target: RemoteTarget,
  ): Promise<FetchedDocument> {
    if (target.isFolder) {
      throw new BadRequestException('不能拉取文件夹内容');
    }

    const creds = this.resolveCreds(account);
    const client = this.getClient(creds);

    const downloadRes = await client.post(
      '/yws/api/personal/sync?method=download&_system=macos&_platform=web&_appName=ynote' +
        `&keyfrom=web&cstk=${encodeURIComponent(creds.cstk)}`,
      new URLSearchParams({
        method: 'download',
        fileId: target.externalId,
        version: '-1',
        convert: 'true',
        editorType: '1',
        keyfrom: 'web',
        cstk: creds.cstk,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        responseType: 'arraybuffer',
        validateStatus: (s) => s < 500,
      },
    );

    if (downloadRes.status >= 400) {
      throw new BadRequestException(
        `下载笔记失败(${downloadRes.status})，请检查 Cookie 是否过期`,
      );
    }

    let raw = Buffer.from(downloadRes.data);
    if (raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
      if (raw.length > 5 * 1024 * 1024) {
        throw new BadRequestException(`笔记「${target.title}」压缩包过大，已跳过`);
      }
      raw = gunzipSync(raw);
      if (raw.length > 3 * 1024 * 1024) {
        throw new BadRequestException(`笔记「${target.title}」解压后过大，已跳过`);
      }
    }

    const maxBytes = 1024 * 1024;
    if (raw.length > maxBytes) {
      throw new BadRequestException(
        `笔记「${target.title}」过大(${(raw.length / 1024 / 1024).toFixed(1)}MB)，已跳过`,
      );
    }

    const parseBuf =
      raw.length > 200 * 1024 ? raw.subarray(0, 200 * 1024) : raw;
    const content = this.contentParser.parse(parseBuf, target.title);
    const contentHash = createHash('md5').update(raw).digest('hex');

    return {
      externalId: target.externalId,
      title: target.title,
      content,
      contentHash,
      externalUrl: target.url,
      mimeType: 'markdown',
    };
  }
}
