import type { Locale } from './types.js';

export const enXr = {
  xrActive: 'VR session active',
  xrStarting: 'Starting VR',
  xrEnter: 'Enter VR preview',
  xrNotAllowed: 'VR access was not allowed. Check the browser and headset permission prompt.',
  xrNotSupported: 'This browser or connected headset cannot start an immersive VR session.',
  xrInvalidState: 'A VR session is already active or still shutting down.',
  xrUnableToEnter: 'Unable to enter VR.',
  xrErrorDetail: (_locale: Locale, detail: string) => `Unable to enter VR: ${detail}`,
};

export const zhXr = {
  xrActive: 'VR 会话进行中',
  xrStarting: '正在启动 VR',
  xrEnter: '进入 VR 预览',
  xrNotAllowed: '未获准访问 VR。请检查浏览器和头显的权限提示。',
  xrNotSupported: '此浏览器或连接的头显无法启动沉浸式 VR 会话。',
  xrInvalidState: 'VR 会话已在运行或尚未关闭。',
  xrUnableToEnter: '无法进入 VR。',
  xrErrorDetail: (_locale: Locale, detail: string) => `无法进入 VR：${detail}`,
} satisfies typeof enXr;
