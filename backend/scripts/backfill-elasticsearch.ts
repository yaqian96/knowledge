/**
 * 将已有 DocumentVector 全量写入 Elasticsearch
 * 用法: npx ts-node scripts/backfill-elasticsearch.ts
 */
import { PrismaClient } from '@prisma/client';
import { Client } from '@elastic/elasticsearch';

const prisma = new PrismaClient();
const node = process.env.ELASTICSEARCH_NODE || 'http://localhost:9200';
const index = process.env.ELASTICSEARCH_INDEX || 'knowledge_chunks';
const batchSize = 200;

interface BackfillRow {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  userId: string;
  filename: string;
  fileType: string;
  sourceProvider: string;
  createdAt: Date;
}

async function main() {
  const client = new Client({ node });
  await client.ping();
  console.log(`Connected to ES: ${node}`);

  const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count FROM "DocumentVector"
  `;
  const total = Number(countResult[0].count);
  console.log(`Total chunks to index: ${total}`);

  let offset = 0;
  let indexed = 0;

  while (offset < total) {
    const rows = await prisma.$queryRaw<BackfillRow[]>`
      SELECT dv."id", dv."documentId", dv."chunkIndex", dv."content",
             kd."userId", kd."filename", kd."fileType", kd."sourceProvider", kd."createdAt"
      FROM "DocumentVector" dv
      JOIN "KnowledgeDocument" kd ON dv."documentId" = kd."id"
      ORDER BY dv."id"
      OFFSET ${offset} LIMIT ${batchSize}
    `;

    if (rows.length === 0) break;

    const operations = rows.flatMap((row) => [
      { index: { _index: index, _id: row.id } },
      {
        chunkId: row.id,
        documentId: row.documentId,
        chunkIndex: row.chunkIndex,
        userId: row.userId,
        filename: row.filename,
        content: row.content,
        fileType: row.fileType,
        sourceProvider: row.sourceProvider,
        createdAt: new Date(row.createdAt).toISOString(),
      },
    ]);

    const result = await client.bulk({ refresh: false, operations });
    if (result.errors) {
      console.warn('Bulk had errors, check cluster');
    }

    indexed += rows.length;
    offset += batchSize;
    console.log(`Indexed ${indexed}/${total}`);
  }

  await client.indices.refresh({ index });
  console.log('Backfill complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
