import { useEffect, useState } from 'react'
import ScreenshotOverlay from './components/ScreenshotOverlay'
import ShortcutPanel from './components/ShortcutPanel'
import ScrollCaptureControl from './components/ScrollCaptureControl'
import PinImage from './components/PinImage'
import { getMessages, I18nContext, type Language } from './i18n'

function App(): React.JSX.Element {
  const hash =
    new URLSearchParams(window.location.search).get('view') ?? window.location.hash.replace('#', '')
  const [language, setLanguage] = useState<Language>('en')

  useEffect(() => {
    document.title = 'LiteSnap'
  }, [])

  useEffect(() => {
    void window.api.getSettings().then((settings) => setLanguage(settings.language))
    return window.api.onSettingsChanged((settings) => setLanguage(settings.language))
  }, [])

  let content: React.JSX.Element
  if (hash === 'shortcut') content = <ShortcutPanel />
  else if (hash === 'scroll-capture') content = <ScrollCaptureControl />
  else if (hash === 'pin') content = <PinImage />
  else content = <ScreenshotOverlay />

  return (
    <I18nContext.Provider value={{ language, t: getMessages(language) }}>
      {content}
    </I18nContext.Provider>
  )
}

export default App
