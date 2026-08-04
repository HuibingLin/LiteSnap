import { createContext, useContext } from 'react'
import { en, type Messages } from './en'
import { zh } from './zh'
import { zhTW } from './zh-TW'

export type Language = 'en' | 'zh' | 'zh-TW'

const catalogs: Record<Language, Messages> = { en, zh, 'zh-TW': zhTW }

export function getMessages(language: Language): Messages {
  return catalogs[language] ?? en
}

export interface I18nContextValue {
  language: Language
  t: Messages
}

export const I18nContext = createContext<I18nContextValue>({
  language: 'en',
  t: en
})

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
