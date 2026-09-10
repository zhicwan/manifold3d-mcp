import type { Locale } from './types.js';

export const enMarks = {
  markLocationNote: 'Location note',
  markAnnotationNote: 'Annotation note',
  markAddNote: 'Add a note...',
  markCancelEdit: 'Cancel edit',
  markCancelShortcut: 'Cancel (Esc)',
  markSaveNote: 'Save note',
  markSaveShortcut: 'Save (Enter)',
  markCloseNote: 'Close note',
  markCloseShortcut: 'Close (Esc)',
  markLocationLabel: (locale: Locale, number: number, partLabel: string) =>
    `Location ${new Intl.NumberFormat(locale).format(number)}: ${partLabel}`,
  markNoteLabel: (locale: Locale, number: number, partLabel: string) =>
    `Note ${new Intl.NumberFormat(locale).format(number)}: ${partLabel}`,
  cubeRight: 'RIGHT',
  cubeLeft: 'LEFT',
  cubeBack: 'BACK',
  cubeFront: 'FRONT',
  cubeTop: 'TOP',
  cubeBottom: 'BOT',
  cubeNavigation: 'View cube',
  cubeFace: (_locale: Locale, face: string) => `View cube: ${face}`,
};

export const zhMarks = {
  markLocationNote: '位置说明',
  markAnnotationNote: '批注内容',
  markAddNote: '添加批注…',
  markCancelEdit: '取消编辑',
  markCancelShortcut: '取消 (Esc)',
  markSaveNote: '保存批注',
  markSaveShortcut: '保存 (Enter)',
  markCloseNote: '关闭批注',
  markCloseShortcut: '关闭 (Esc)',
  markLocationLabel: (locale: Locale, number: number, partLabel: string) =>
    `位置 ${new Intl.NumberFormat(locale).format(number)}：${partLabel}`,
  markNoteLabel: (locale: Locale, number: number, partLabel: string) =>
    `批注 ${new Intl.NumberFormat(locale).format(number)}：${partLabel}`,
  cubeRight: '右',
  cubeLeft: '左',
  cubeBack: '后',
  cubeFront: '前',
  cubeTop: '顶',
  cubeBottom: '底',
  cubeNavigation: '视图立方体',
  cubeFace: (_locale: Locale, face: string) => `视图立方体：${face}`,
} satisfies typeof enMarks;
