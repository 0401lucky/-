export interface FarmMaturityEmailInput {
  to: string;
  cropName: string;
  matureAt: number;
  petName?: string | null;
}

export interface FarmWaterReminderEmailInput {
  to: string;
  cropName: string;
  landIndex: number;
  waterDueAt: number;
  petName?: string | null;
}

export interface SendEmailResult {
  sent: boolean;
  skipped?: boolean;
  reason?: string;
}

const RESEND_EMAIL_API_URL = 'https://api.resend.com/emails';

function readEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

export function isFarmMaturityEmailConfigured(): boolean {
  return !!readEnv('RESEND_API_KEY') && !!readEnv('FARM_MAIL_FROM');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatChinaTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export async function sendFarmMaturityEmail(input: FarmMaturityEmailInput): Promise<SendEmailResult> {
  return sendFarmEmail({
    to: input.to,
    subject: `开心农场：${input.cropName} 成熟啦`,
    text: buildMaturityEmailText(input),
    html: buildMaturityEmailHtml(input),
  });
}

export async function sendFarmWaterReminderEmail(input: FarmWaterReminderEmailInput): Promise<SendEmailResult> {
  return sendFarmEmail({
    to: input.to,
    subject: `开心农场：第 ${input.landIndex} 块地该浇水啦`,
    text: buildWaterReminderEmailText(input),
    html: buildWaterReminderEmailHtml(input),
  });
}

async function sendFarmEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<SendEmailResult> {
  const apiKey = readEnv('RESEND_API_KEY');
  const from = readEnv('FARM_MAIL_FROM');
  if (!apiKey || !from) {
    return { sent: false, skipped: true, reason: 'email_not_configured' };
  }

  const response = await fetch(readEnv('RESEND_API_URL') || RESEND_EMAIL_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`邮件发送失败: ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
  }

  return { sent: true };
}

function buildMaturityEmailText(input: FarmMaturityEmailInput): string {
  const matureAt = formatChinaTime(input.matureAt);
  const petLine = input.petName ? `你的宠物 ${input.petName} 已经看到了成熟提醒。` : '你的成年宠物已经看到了成熟提醒。';
  return [
    `${input.cropName} 已经成熟。`,
    `成熟时间：${matureAt}`,
    petLine,
    '请回到开心农场及时收获。',
  ].join('\n');
}

function buildMaturityEmailHtml(input: FarmMaturityEmailInput): string {
  const matureAt = formatChinaTime(input.matureAt);
  const petLine = input.petName ? `你的宠物 ${input.petName} 已经看到了成熟提醒。` : '你的成年宠物已经看到了成熟提醒。';
  return `
    <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.7; color: #1f2937;">
      <h2 style="margin: 0 0 12px; color: #15803d;">${escapeHtml(input.cropName)} 成熟啦</h2>
      <p>成熟时间：<strong>${escapeHtml(matureAt)}</strong></p>
      <p>${escapeHtml(petLine)}</p>
      <p>请回到开心农场及时收获。</p>
    </div>
  `;
}

function buildWaterReminderEmailText(input: FarmWaterReminderEmailInput): string {
  const dueAt = formatChinaTime(input.waterDueAt);
  const petLine = input.petName ? `你的宠物 ${input.petName} 发现作物快缺水了。` : '你的成年宠物发现作物快缺水了。';
  return [
    `第 ${input.landIndex} 块地的 ${input.cropName} 已经可以浇水。`,
    `缺水时间：${dueAt}`,
    petLine,
    '请回到开心农场及时浇水，避免影响收益和品质。',
  ].join('\n');
}

function buildWaterReminderEmailHtml(input: FarmWaterReminderEmailInput): string {
  const dueAt = formatChinaTime(input.waterDueAt);
  const petLine = input.petName ? `你的宠物 ${input.petName} 发现作物快缺水了。` : '你的成年宠物发现作物快缺水了。';
  return `
    <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.7; color: #1f2937;">
      <h2 style="margin: 0 0 12px; color: #0e7490;">第 ${input.landIndex} 块地该浇水啦</h2>
      <p>${escapeHtml(input.cropName)} 已经进入可浇水窗口。</p>
      <p>缺水时间：<strong>${escapeHtml(dueAt)}</strong></p>
      <p>${escapeHtml(petLine)}</p>
      <p>请回到开心农场及时浇水，避免影响收益和品质。</p>
    </div>
  `;
}
