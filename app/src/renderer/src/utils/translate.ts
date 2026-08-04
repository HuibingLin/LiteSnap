import type { Language } from '../i18n'

export function translateTargetLanguage(language: Language): string {
  if (language === 'zh') return 'zh-CN'
  if (language === 'zh-TW') return 'zh-TW'
  return 'en'
}

export function buildTranslateUrl(text: string, language: Language): string {
  const target = translateTargetLanguage(language)
  return `https://translate.google.com/?sl=auto&tl=${target}&text=${encodeURIComponent(text)}`
}
