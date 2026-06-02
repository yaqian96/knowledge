import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { AxiosError } from 'axios';

export function wrapYoudaoApiError(err: unknown): never {
  if (err instanceof BadRequestException || err instanceof BadGatewayException) {
    throw err;
  }

  const axiosErr = err as AxiosError;
  if (axiosErr?.code === 'ECONNREFUSED' && String(axiosErr.message).includes('7897')) {
    throw new BadGatewayException(
      '访问有道云笔记失败：检测到系统代理(127.0.0.1:7897)未启动。请关闭代理环境变量，或启动本地代理后重试。',
    );
  }

  if (axiosErr?.code === 'ECONNREFUSED' || axiosErr?.code === 'ENOTFOUND') {
    throw new BadGatewayException(
      `访问有道云笔记失败：${axiosErr.message}。请检查网络或系统代理设置。`,
    );
  }

  if (
    axiosErr?.response?.status === 400 ||
    axiosErr?.response?.status === 401 ||
    axiosErr?.response?.status === 403
  ) {
    throw new BadRequestException(
      '有道云笔记 Cookie/cstk 无效或已过期，请重新登录 note.youdao.com 后复制',
    );
  }

  const msg = err instanceof Error ? err.message : String(err);
  throw new BadGatewayException(`访问有道云笔记失败：${msg}`);
}
