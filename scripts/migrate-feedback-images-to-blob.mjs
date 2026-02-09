#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { kv } from '@vercel/kv';
import { put } from '@vercel/blob';
import { nanoid } from 'nanoid';

const FEEDBACK_LIST_KEY = 'feedback:list';
const FEEDBACK_MESSAGES_KEY = (feedbackId) => `feedback:messages:${feedbackId}`;

const IMAGE_EXTENSION_MAP = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const args = new Set(process.argv.slice(2));
const isExecute = args.has('--execute');
const isVerbose = args.has('--verbose');

function sanitizeEnvValue(value) {
  if (!value) return '';

  return value
    .replace(/\\r\\n|\\n|\\r/g, '')
    .replace(/[\r\n]/g, '')
    .trim();
}

function stripWrappingQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function loadEnvFile(fileName) {
  const fullPath = resolve(process.cwd(), fileName);
  if (!existsSync(fullPath)) {
    return;
  }

  const content = readFileSync(fullPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const index = trimmed.indexOf('=');
    if (index <= 0) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    if (!key || process.env[key]) {
      continue;
    }

    process.env[key] = stripWrappingQuotes(rawValue);
  }
}

function printUsage() {
  console.log('反馈图片迁移脚本（KV base64 -> Vercel Blob）');
  console.log('');
  console.log('用法：');
  console.log('  node scripts/migrate-feedback-images-to-blob.mjs            # 仅预览（不写入）');
  console.log('  node scripts/migrate-feedback-images-to-blob.mjs --execute  # 真正执行迁移');
  console.log('  node scripts/migrate-feedback-images-to-blob.mjs --execute --verbose');
}

function decodeDataUrl(dataUrl) {
  const matched = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!matched) {
    throw new Error('invalid data url');
  }

  const mimeType = matched[1].toLowerCase();
  const bytes = Buffer.from(matched[2], 'base64');
  if (!bytes.length) {
    throw new Error('empty image bytes');
  }

  return { mimeType, bytes };
}

function sanitizeFileName(name) {
  if (typeof name !== 'string') {
    return undefined;
  }

  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-');

  return cleaned ? cleaned.slice(0, 80) : undefined;
}

function buildBlobPath(feedbackId, messageId, role, mimeType, imageName, imageIndex) {
  const ext = IMAGE_EXTENSION_MAP[mimeType] ?? 'bin';
  const dateBucket = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const safeName = sanitizeFileName(imageName);
  const baseName = safeName ? safeName.replace(/\.[^.]+$/, '') : `img-${imageIndex + 1}`;
  const safeRole = role === 'admin' ? 'admin' : 'user';

  return `feedback/${dateBucket}/${feedbackId}/${messageId}-${safeRole}-${nanoid(6)}-${baseName}.${ext}`;
}

function isDataUrl(value) {
  return typeof value === 'string' && /^data:/i.test(value.trim());
}

async function getAllFeedbackIds() {
  const total = await kv.llen(FEEDBACK_LIST_KEY);
  if (total <= 0) {
    return [];
  }

  const uniqueIds = new Set();
  const chunkSize = 200;
  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(total - 1, start + chunkSize - 1);
    const ids = await kv.lrange(FEEDBACK_LIST_KEY, start, end);
    for (const id of ids ?? []) {
      const text = typeof id === 'string' ? id.trim() : '';
      if (text) {
        uniqueIds.add(text);
      }
    }
  }

  return Array.from(uniqueIds);
}

async function migrateOneFeedback(feedbackId, blobToken, summary) {
  const messageKey = FEEDBACK_MESSAGES_KEY(feedbackId);
  const messageTotal = await kv.llen(messageKey);
  if (messageTotal <= 0) {
    return;
  }

  const messages = await kv.lrange(messageKey, 0, messageTotal - 1);
  if (!Array.isArray(messages) || messages.length === 0) {
    return;
  }

  const updates = [];
  let convertedImages = 0;
  let convertedBytes = 0;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object') {
      continue;
    }

    const imageList = Array.isArray(message.images) ? message.images : [];
    if (imageList.length === 0) {
      continue;
    }

    let changed = false;
    const nextImages = [];
    for (let imageIndex = 0; imageIndex < imageList.length; imageIndex += 1) {
      const image = imageList[imageIndex];
      if (!image || typeof image !== 'object') {
        nextImages.push(image);
        continue;
      }

      const rawDataUrl = typeof image.dataUrl === 'string' ? image.dataUrl.trim() : '';
      if (!isDataUrl(rawDataUrl)) {
        nextImages.push(image);
        continue;
      }

      const { mimeType, bytes } = decodeDataUrl(rawDataUrl);
      const messageId =
        typeof message.id === 'string' && message.id.trim()
          ? message.id.trim()
          : `msg-${index}`;

      const pathname = buildBlobPath(
        feedbackId,
        messageId,
        message.role,
        mimeType,
        image.name,
        imageIndex
      );

      let externalUrl = rawDataUrl;
      if (isExecute) {
        const uploadResult = await put(pathname, bytes, {
          access: 'public',
          contentType: mimeType,
          token: blobToken,
          addRandomSuffix: false,
        });
        externalUrl = uploadResult.url;
      }

      nextImages.push({
        ...image,
        dataUrl: externalUrl,
        mimeType,
        size: bytes.byteLength,
        name: sanitizeFileName(image.name),
      });

      convertedImages += 1;
      convertedBytes += bytes.byteLength;
      changed = true;
    }

    if (changed) {
      updates.push({
        index,
        message: {
          ...message,
          images: nextImages,
        },
      });
    }
  }

  if (updates.length === 0) {
    summary.feedbackUntouched += 1;
    return;
  }

  summary.feedbackTouched += 1;
  summary.messagesTouched += updates.length;
  summary.imagesConverted += convertedImages;
  summary.convertedBytes += convertedBytes;

  if (!isExecute) {
    if (isVerbose) {
      console.log(`[dry-run] ${feedbackId}: messages=${updates.length}, images=${convertedImages}`);
    }
    return;
  }

  const currentTotal = await kv.llen(messageKey);
  if (currentTotal !== messageTotal) {
    summary.concurrentSkipped += 1;
    console.warn(`跳过 ${feedbackId}：留言数量发生变化（可能有并发写入）`);
    return;
  }

  const pipeline = kv.pipeline();
  for (const update of updates) {
    pipeline.lset(messageKey, update.index, update.message);
  }
  await pipeline.exec();

  if (isVerbose) {
    console.log(`[migrated] ${feedbackId}: messages=${updates.length}, images=${convertedImages}`);
  }
}

async function main() {
  loadEnvFile('.env.local');
  loadEnvFile('.env.production.local');

  if (args.has('--help') || args.has('-h')) {
    printUsage();
    return;
  }

  const kvUrl = sanitizeEnvValue(process.env.KV_REST_API_URL);
  const kvToken = sanitizeEnvValue(process.env.KV_REST_API_TOKEN);
  if (!kvUrl || !kvToken) {
    throw new Error('缺少 KV 环境变量：KV_REST_API_URL / KV_REST_API_TOKEN');
  }

  const blobToken = sanitizeEnvValue(process.env.BLOB_READ_WRITE_TOKEN);
  if (isExecute && !blobToken) {
    throw new Error('缺少 BLOB_READ_WRITE_TOKEN，无法执行迁移');
  }

  console.log(isExecute ? '模式：执行迁移（会写入 KV）' : '模式：仅预览（不会写入 KV）');

  const feedbackIds = await getAllFeedbackIds();
  console.log(`检测到反馈工单：${feedbackIds.length} 条`);
  if (feedbackIds.length === 0) {
    return;
  }

  const summary = {
    feedbackTouched: 0,
    feedbackUntouched: 0,
    messagesTouched: 0,
    imagesConverted: 0,
    convertedBytes: 0,
    concurrentSkipped: 0,
    failed: 0,
  };

  for (const feedbackId of feedbackIds) {
    try {
      await migrateOneFeedback(feedbackId, blobToken, summary);
    } catch (error) {
      summary.failed += 1;
      console.error(`迁移失败 ${feedbackId}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log('');
  console.log('迁移摘要：');
  console.log(`- 处理工单：${feedbackIds.length}`);
  console.log(`- 变更工单：${summary.feedbackTouched}`);
  console.log(`- 无需变更：${summary.feedbackUntouched}`);
  console.log(`- 变更留言：${summary.messagesTouched}`);
  console.log(`- 外链图片：${summary.imagesConverted}`);
  console.log(`- 图片字节：${summary.convertedBytes}`);
  console.log(`- 并发跳过：${summary.concurrentSkipped}`);
  console.log(`- 失败工单：${summary.failed}`);

  if (!isExecute) {
    console.log('');
    console.log('这是 dry-run 结果；确认无误后请加 --execute 真正写入。');
  }
}

main().catch((error) => {
  console.error('迁移任务失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
