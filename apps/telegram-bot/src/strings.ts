/** Bot texts. Telegram tells us each user's language; Russian speakers get Russian, everyone else English. */
export interface Strings {
  buttons: { read: string; text: string; photo: string; chats: string; pc: string; status: string };
  commands: { new: string; chats: string; stop: string; status: string; pc: string; unlink: string; help: string };
  notLinked: string;
  badCode: string;
  linking: string;
  linked: (name: string, pc: string | undefined) => string;
  linkFailed: (reason: string) => string;
  unlinked: string;
  noComputer: string;
  macOffline: string;
  pcOffline: (pc: string) => string;
  empty: (pc: string) => string;
  reading: (pc: string) => string;
  copied: (pc: string) => string;
  sendText: string;
  sendPhoto: string;
  onlyImages: string;
  pickPc: string;
  pcSet: (pc: string) => string;
  failed: (reason: string) => string;
  notCopied: string;
  noChat: string;
  newChat: (title: string) => string;
  nowIn: (title: string) => string;
  chats: string;
  noChats: string;
  newChatButton: string;
  stopped: string;
  nothingRunning: string;
  waiting: string;
  emptyReply: string;
  macWentOffline: string;
  permission: (tool: string) => string;
  allow: string;
  allowSession: string;
  deny: string;
  allowed: string;
  allowedSession: string;
  denied: string;
  resolvedElsewhere: string;
  status: (s: { user: string; owner: boolean; macOnline: boolean; claude: string | undefined; computers: { name: string; online: boolean; current: boolean; clipboard: boolean }[] }) => string;
  help: string;
}

const en: Strings = {
  buttons: { read: '📋 Clipboard → here', text: '📥 Text → clipboard', photo: '🖼 Photo → clipboard', chats: '💬 Chats', pc: '🖥 Computer', status: 'ℹ️ Status' },
  commands: { new: 'New chat with Claude', chats: 'Pick a chat', stop: 'Stop the current reply', status: 'Mac and computers', pc: 'Pick the clipboard computer', unlink: 'Unlink this Telegram account', help: 'What the buttons do' },
  notLinked: 'This bot is not linked to your Pocket yet.\nOn the phone open Settings → Telegram → Link, then tap the link it opens.',
  badCode: 'That link has expired or is not a Pocket link. Make a new one on the phone: Settings → Telegram → Link.',
  linking: 'Linking with the Mac…',
  linked: (name, pc) => `Linked as ${name}.\n${pc ? `Clipboard computer: ${pc}.` : 'No computer shares its clipboard yet: run PocketClipboard on it and add it from the phone.'}`,
  linkFailed: (reason) => `Could not link: ${reason}`,
  unlinked: 'Unlinked. The Mac has forgotten this Telegram account.',
  noComputer: 'No computer shares its clipboard. Run PocketClipboard on it and add it from the phone (chat → phone icon → Add a computer).',
  macOffline: 'The Mac is offline.',
  pcOffline: (pc) => `${pc} is offline.`,
  empty: (pc) => `The clipboard on ${pc} is empty.`,
  reading: (pc) => `Reading the clipboard on ${pc}…`,
  copied: (pc) => `Copied to ${pc}.`,
  sendText: 'Send me the text and it goes to the clipboard.',
  sendPhoto: 'Send me a photo or an image file and it goes to the clipboard.',
  onlyImages: 'Only text and pictures can go to the clipboard for now.',
  pickPc: 'Which computer?',
  pcSet: (pc) => `Using ${pc}.`,
  failed: (reason) => `Did not work: ${reason}`,
  notCopied: 'Not copied: the computer did not answer.',
  noChat: 'No chat yet. /new starts a chat with Claude; to copy text to the PC tap “📥 Text → clipboard” first.',
  newChat: (title) => `New chat: ${title}. Write to Claude here.`,
  nowIn: (title) => `Chat: ${title}`,
  chats: 'Your chats',
  noChats: 'No chats yet.',
  newChatButton: '➕ New chat',
  stopped: 'Stopped.',
  nothingRunning: 'Nothing is running.',
  waiting: '…',
  emptyReply: '(no reply)',
  macWentOffline: 'The Mac went offline.',
  permission: (tool) => `🔐 Claude wants to run ${tool}:`,
  allow: '✅ Allow',
  allowSession: '✅ Always in this chat',
  deny: '❌ Deny',
  allowed: '✅ Allowed',
  allowedSession: '✅ Allowed for this chat',
  denied: '❌ Denied',
  resolvedElsewhere: 'Answered on another device.',
  status: (s) =>
    [
      `You: ${s.user}${s.owner ? ' (owner)' : ''}`,
      `Mac: ${s.macOnline ? 'online' : 'offline'}${s.claude ? `, Claude Code ${s.claude}` : ''}`,
      s.computers.length ? 'Computers:' : 'Computers: none',
      ...s.computers.map((c) => `  ${c.online ? '●' : '○'} ${c.name}${c.current ? ' ✓' : ''}${c.clipboard ? '' : ' (no clipboard)'}`),
    ].join('\n'),
  help: 'Buttons below: get what is on the PC clipboard, or put text and photos there. /new starts a chat with Claude; then plain messages and photos go to it. /chats, /stop, /status, /pc, /unlink.',
};

const ru: Strings = {
  buttons: { read: '📋 Буфер → сюда', text: '📥 Текст → в буфер', photo: '🖼 Фото → в буфер', chats: '💬 Чаты', pc: '🖥 Компьютер', status: 'ℹ️ Статус' },
  commands: { new: 'Новый чат с Claude', chats: 'Выбрать чат', stop: 'Остановить текущий ответ', status: 'Mac и компьютеры', pc: 'Выбрать компьютер для буфера', unlink: 'Отвязать этот Telegram', help: 'Что делают кнопки' },
  notLinked: 'Бот ещё не привязан к твоему Pocket.\nНа телефоне: Настройки → Telegram → Link, затем нажми на открывшуюся ссылку.',
  badCode: 'Ссылка устарела или это не ссылка Pocket. Сделай новую на телефоне: Настройки → Telegram → Link.',
  linking: 'Привязываю к Mac…',
  linked: (name, pc) => `Привязано: ${name}.\n${pc ? `Буфер обмена: ${pc}.` : 'Пока ни один компьютер не делится буфером: запусти на нём PocketClipboard и добавь его с телефона.'}`,
  linkFailed: (reason) => `Не удалось привязать: ${reason}`,
  unlinked: 'Отвязано. Mac забыл этот Telegram-аккаунт.',
  noComputer: 'Ни один компьютер не делится буфером. Запусти на нём PocketClipboard и добавь его с телефона (чат → значок телефона → Add a computer).',
  macOffline: 'Mac не в сети.',
  pcOffline: (pc) => `${pc} не в сети.`,
  empty: (pc) => `Буфер обмена на ${pc} пуст.`,
  reading: (pc) => `Читаю буфер на ${pc}…`,
  copied: (pc) => `Скопировано на ${pc}.`,
  sendText: 'Пришли текст — он попадёт в буфер обмена.',
  sendPhoto: 'Пришли фото или файл с картинкой — оно попадёт в буфер обмена.',
  onlyImages: 'В буфер пока можно положить только текст и картинки.',
  pickPc: 'Какой компьютер?',
  pcSet: (pc) => `Теперь ${pc}.`,
  failed: (reason) => `Не получилось: ${reason}`,
  notCopied: 'Не скопировано: компьютер не ответил.',
  noChat: 'Чата ещё нет. /new начинает чат с Claude; чтобы положить текст в буфер ПК, сначала нажми «📥 Текст → в буфер».',
  newChat: (title) => `Новый чат: ${title}. Пиши Claude сюда.`,
  nowIn: (title) => `Чат: ${title}`,
  chats: 'Твои чаты',
  noChats: 'Чатов пока нет.',
  newChatButton: '➕ Новый чат',
  stopped: 'Остановлено.',
  nothingRunning: 'Ничего не выполняется.',
  waiting: '…',
  emptyReply: '(без ответа)',
  macWentOffline: 'Mac ушёл в офлайн.',
  permission: (tool) => `🔐 Claude хочет выполнить ${tool}:`,
  allow: '✅ Разрешить',
  allowSession: '✅ Всегда в этом чате',
  deny: '❌ Запретить',
  allowed: '✅ Разрешено',
  allowedSession: '✅ Разрешено для этого чата',
  denied: '❌ Запрещено',
  resolvedElsewhere: 'Решено на другом устройстве.',
  status: (s) =>
    [
      `Ты: ${s.user}${s.owner ? ' (владелец)' : ''}`,
      `Mac: ${s.macOnline ? 'в сети' : 'не в сети'}${s.claude ? `, Claude Code ${s.claude}` : ''}`,
      s.computers.length ? 'Компьютеры:' : 'Компьютеры: нет',
      ...s.computers.map((c) => `  ${c.online ? '●' : '○'} ${c.name}${c.current ? ' ✓' : ''}${c.clipboard ? '' : ' (без буфера)'}`),
    ].join('\n'),
  help: 'Кнопки внизу: забрать то, что в буфере на ПК, или положить туда текст и фото. /new начинает чат с Claude — дальше обычные сообщения и фото идут ему. /chats, /stop, /status, /pc, /unlink.',
};

export const STRINGS: Record<'en' | 'ru', Strings> = { en, ru };

export function stringsFor(languageCode: string | undefined): Strings {
  return languageCode?.toLowerCase().startsWith('ru') ? ru : en;
}

export type ButtonAction = keyof Strings['buttons'];

/** Which button a message text is, in any language. */
export function buttonFor(text: string): ButtonAction | undefined {
  const t = text.trim();
  for (const s of Object.values(STRINGS)) {
    for (const [action, label] of Object.entries(s.buttons)) if (label === t) return action as ButtonAction;
  }
  return undefined;
}
