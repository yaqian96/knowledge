import { Injectable } from '@nestjs/common';

export interface RankedId {
  id: string;
  rank: number;
}

@Injectable()
export class RrfService {
  fuse(rankings: RankedId[][], k = 60): Map<string, number> {
    const scores = new Map<string, number>();

    for (const list of rankings) {
      for (const { id, rank } of list) {
        scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
      }
    }

    return scores;
  }

  topIds(scores: Map<string, number>, limit: number): string[] {
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
  }
}
