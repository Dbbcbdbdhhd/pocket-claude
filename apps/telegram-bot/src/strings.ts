/** Bot texts. Telegram tells us each user's language; Russian speakers get Russian, everyone else English. */
export interface Strings {
  buttons: { read: string; text: string; photo: string; pc: string; status: string };
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
  status: (s: { user: string; owner: boolean; macOnline: boolean; claude: string | undefined; computers: { name: string; online: boolean; current: boolean; clipboard: boolean }[] }) => string;
  help: string;
}

const en: Strings = {
  buttons: { read: '📋 Clipboard → here', text: '📥 Text → clipboard', photo: '🖼 Photo → clipboard', pc: '🖥 Computer', status: 'ℹ️ Status' },
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
  status: (s) =>
    [
      `You: ${s.user}${s.owner ? ' (owner)' : ''}`,
      `Mac: ${s.macOnline ? 'online' : 'offline'}${s.claude ? `, Claude Code ${s.claude}` : ''}`,
      s.computers.length ? 'Computers:' : 'Computers: none',
      ...s.computers.map((c) => `  ${c.online ? '●' : '○'} ${c.name}${c.current ? ' ✓' : ''}${c.clipboard ? '' : ' (no clipboard)'}`),
    ].join('\n'),
  help: 'Buttons below: get what is on the PC clipboard, or send me text or a photo to put it there. /status, /pc, /unlink.',
};

const ru: Strings = {
  buttons: { read: '📋 Буфер → сюда', text: '📥 Текст → в буфер', photo: '🖼 Фото → в буфер', pc: '🖥 Компьютер', status: 'ℹ️ Статус' },
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
  status: (s) =>
    [
      `Ты: ${s.user}${s.owner ? ' (владелец)' : ''}`,
      `Mac: ${s.macOnline ? 'в сети' : 'не в сети'}${s.claude ? `, Claude Code ${s.claude}` : ''}`,
      s.computers.length ? 'Компьютеры:' : 'Компьютеры: нет',
      ...s.computers.map((c) => `  ${c.online ? '●' : '○'} ${c.name}${c.current ? ' ✓' : ''}${c.clipboard ? '' : ' (без буфера)'}`),
    ].join('\n'),
  help: 'Кнопки внизу: забрать то, что в буфере на ПК, или пришли текст/фото — положу туда. /status, /pc, /unlink.',
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
