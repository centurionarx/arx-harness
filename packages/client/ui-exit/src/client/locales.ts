/** Exit-seat dictionaries: the foot row and its confirmation. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '退出',
  'confirm.title': '退出 arx Harness？',
  'confirm.description': '服务器将停止，所有已连接的会话随之断开。会话记录已持久化，重启后可继续。',
  'confirm.cancel': '取消',
  'confirm.stop': '停止服务器',
  'close': '关闭',
  'stopping': '正在停止…',
  'unavailable': '此部署未提供退出方式',
} satisfies Record<string, string>

/** The exit namespace key union. */
export type ExitKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Exit',
  'confirm.title': 'Exit arx Harness?',
  'confirm.description': 'The server stops and every attached session disconnects. Session logs are durable, so a restart resumes them.',
  'confirm.cancel': 'Cancel',
  'confirm.stop': 'Stop the server',
  'close': 'Close',
  'stopping': 'Stopping…',
  'unavailable': 'This deployment offers no way to exit',
} satisfies Record<ExitKey, string>
