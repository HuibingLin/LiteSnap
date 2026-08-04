import Picker, { EmojiStyle, Theme } from 'emoji-picker-react'
import type { EmojiClickData } from 'emoji-picker-react'

interface EmojiPickerProps {
  style?: React.CSSProperties
  onPick: (emoji: string) => void
}

function EmojiPicker({ style, onPick }: EmojiPickerProps): React.JSX.Element {
  const handlePick = (data: EmojiClickData): void => {
    onPick(data.emoji)
  }

  return (
    <div className="emoji-picker-panel" style={style} onMouseDown={(e) => e.stopPropagation()}>
      <Picker
        onEmojiClick={handlePick}
        width={320}
        height={380}
        theme={Theme.LIGHT}
        emojiStyle={EmojiStyle.NATIVE}
        lazyLoadEmojis={false}
        searchPlaceholder="Search emoji…"
        previewConfig={{ showPreview: false }}
      />
    </div>
  )
}

export default EmojiPicker
