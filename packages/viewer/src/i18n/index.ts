import { enUi, zhUi } from './ui.js';
import { enMarks, zhMarks } from './marks.js';
import { enActions, zhActions } from './actions.js';
import { enXr, zhXr } from './xr.js';
import type { LanguagePreference, Locale } from './types.js';

export type { LanguagePreference, Locale } from './types.js';

export const catalogs = {
  en: { ...enUi, ...enMarks, ...enActions, ...enXr },
  'zh-CN': { ...zhUi, ...zhMarks, ...zhActions, ...zhXr },
};
type Messages = typeof catalogs.en;
export type MessageKey = keyof Messages;
type MessageArguments<T> = T extends (locale: Locale, ...args: infer A) => string ? A : [];
type MessageArgs<K extends MessageKey> = MessageArguments<Messages[K]>;

export function negotiateLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    let parsed: Intl.Locale;
    try {
      parsed = new Intl.Locale(language);
    } catch {
      continue;
    }
    if (parsed.language === 'en') {
      return 'en';
    }
    if (parsed.language === 'zh') {
      // An explicit script takes precedence over region (e.g. zh-Hant-CN).
      const script = parsed.script ?? parsed.maximize().script;
      if (script === 'Hans') {
        return 'zh-CN';
      }
    }
  }
  return 'en';
}

function browserLanguages(): readonly string[] {
  return typeof navigator === 'undefined'
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
}

export function createViewerI18n(initialPreference: LanguagePreference = 'auto', languages = browserLanguages()) {
  let preference = initialPreference;
  let automaticLocale = negotiateLocale(languages);
  const listeners = new Set<() => void>();
  const locale = (): Locale => (preference === 'auto' ? automaticLocale : preference);
  const emit = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getLocale: locale,
    getSnapshot: (): string => `${preference}:${locale()}`,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setPreference(next: LanguagePreference): void {
      if (next === preference) {
        return;
      }
      preference = next;
      emit();
    },
    refreshBrowserLanguages(next: readonly string[] = browserLanguages()): void {
      const previous = locale();
      automaticLocale = negotiateLocale(next);
      if (locale() !== previous) {
        emit();
      }
    },
    t<K extends MessageKey>(key: K, ...args: MessageArgs<K>): string {
      const message = catalogs[locale()][key];
      // The public signature enforces each key's arguments; indexed access
      // cannot retain that correlation through the heterogeneous catalog.
      return typeof message === 'string'
        ? message
        : (message as (locale: Locale, ...args: MessageArgs<MessageKey>) => string)(locale(), ...args);
    },
    number(value: number, options?: Intl.NumberFormatOptions): string {
      return Number.isFinite(value) ? new Intl.NumberFormat(locale(), options).format(value) : '-';
    },
  };
}

export type ViewerI18n = ReturnType<typeof createViewerI18n>;
