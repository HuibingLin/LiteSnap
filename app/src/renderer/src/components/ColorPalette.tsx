import { STROKE_COLORS } from './AnnotationToolbar'

interface ColorPaletteProps {
  strokeColor: string
  disabled?: boolean
  style?: React.CSSProperties
  onChange: (color: string) => void
}

function ColorPalette({ strokeColor, disabled, style, onChange }: ColorPaletteProps): React.JSX.Element {
  return (
    <div className="color-palette-bar" style={style} onMouseDown={(e) => e.stopPropagation()}>
      {STROKE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`color-swatch${strokeColor === color ? ' is-active' : ''}`}
          style={{ backgroundColor: color }}
          aria-label={color}
          disabled={disabled}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}

export default ColorPalette
