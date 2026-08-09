import type { Messages } from './en'

export const zh: Messages = {
  toolbar: {
    rectangle: '矩形',
    ellipse: '椭圆',
    emojiSticker: '表情贴纸',
    arrow: '箭头',
    pen: '画笔',
    highlight: '高亮笔',
    mosaic: '马赛克',
    text: '文字',
    color: '颜色',
    translate: '翻译',
    ocr: '提取文字 (OCR)',
    search: '搜索',
    scrollCapture: '滚动截图',
    undo: '撤销',
    save: '保存',
    pin: '贴图',
    cancel: '取消',
    done: '完成 (复制)'
  },
  hints: {
    dragToSelect: '拖动选择区域 · Esc 取消',
    loading: '正在加载截图…',
    capturing: '正在捕获屏幕…',
    working: '处理中…',
    adjustRegion: '拖动控制点可调整大小 · 拖动内部可移动 · 选择工具开始标注'
  },
  scrollCapture: {
    capture: '捕获下一帧',
    cancel: '取消',
    done: '完成',
    capturing: '捕获中…',
    failed: '滚动截图失败',
    preview: '实时预览',
    previewEmpty: '滚动页面以生成长图…',
    scrollPreviewHint: '在此区域滚动可预览完整长图'
  },
  ocr: {
    title: '提取的文字',
    copy: '复制文字',
    close: '关闭',
    noTextFound: '未找到文字。',
    noTextDetected: '（未检测到文字）'
  },
  errors: {
    decodeFailed: '截图解码失败',
    captureFailed: '屏幕捕获失败',
    loadFailed: '截图加载失败'
  },
  settings: {
    title: '设置',
    language: '语言',
    shortcut: '截图快捷键',
    shortcutHint: '点击下方输入框，按下想要的组合键，然后保存。',
    changeShortcut: '更改快捷键',
    pressShortcut: '请按下快捷键…',
    save: '保存',
    cancel: '取消',
    saved: '快捷键已保存。',
    shortcutInvalid: '快捷键无效。请至少使用一个修饰键（⌥、⌘、Ctrl、⇧）加一个按键。',
    shortcutInUse: '该快捷键已被其他应用占用。',
    shortcutPressNow: '请按下新的组合键，然后点击保存。',
    saving: '保存中…'
  },
  textEditor: {
    drag: '拖动移动',
    placeholder: '输入文字…',
    done: '完成',
    cancel: '取消',
    moveHint: '拖动文字可移动 · 双击可再编辑',
    emojiMoveHint: '拖动可移动 · 拖动右下角可调整大小 · Backspace 可删除'
  }
}
