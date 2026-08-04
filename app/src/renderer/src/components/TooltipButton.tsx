import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

interface TooltipButtonProps {
  label: string
  active?: boolean
  disabled?: boolean
  danger?: boolean
  success?: boolean
  onClick?: () => void
  children: ReactNode
}

function TooltipButton({
  label,
  active,
  disabled,
  danger,
  success,
  onClick,
  children
}: TooltipButtonProps): React.JSX.Element {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)

  const showTip = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setTip({ x: rect.left + rect.width / 2, y: rect.top - 6 })
  }, [])

  const hideTip = useCallback(() => setTip(null), [])

  return (
    <>
      <span
        ref={wrapRef}
        className="tb-tooltip-wrap"
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
      >
        <button
          type="button"
          className={[
            'tb-btn',
            active ? 'is-active' : '',
            danger ? 'is-danger' : '',
            success ? 'is-success' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </button>
      </span>
      {tip &&
        createPortal(
          <span
            className="tb-tooltip tb-tooltip--portal"
            style={{ left: tip.x, top: tip.y }}
            role="tooltip"
          >
            {label}
          </span>,
          document.body
        )}
    </>
  )
}

export default TooltipButton
