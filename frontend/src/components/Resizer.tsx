import { useCallback, useRef, useState } from 'react'

type Props = {
  onDrag: (deltaX: number) => void
  className?: string
}

export function Resizer({ onDrag, className }: Props) {
  const active = useRef(false)
  const [dragging, setDragging] = useState(false)

  const end = useCallback(() => {
    active.current = false
    setDragging(false)
  }, [])

  return (
    <div
      className={`resizer${dragging ? ' active' : ''}${className ? ` ${className}` : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize AI chat panel"
      onPointerDown={(e) => {
        active.current = true
        setDragging(true)
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onPointerMove={(e) => {
        if (!active.current) return
        onDrag(e.movementX)
      }}
    />
  )
}
