import type { ReactElement } from 'react'

import type { ShownTexture } from '../../runtime'
import type { Pivot } from '../../runtime/formats/meta-schema'

/**
 * The frame boundaries and the pivot, drawn over the canvas.
 *
 * These are annotations *about* a texture rather than part of it — no shipped
 * game draws a frame guide — so they belong to the editor rather than to the
 * runtime, and drawing them in SVG keeps a line one pixel wide at any zoom.
 *
 * What makes them honest is not where they are drawn but where their numbers
 * come from: every rectangle here is one the renderer actually cut, and the
 * placement is the one it actually drew at, both reported back by
 * `runtime/preview/texture-view.ts`. Nothing on this side recomputes either.
 * Guides that describe frames the runtime would not produce would be worse than
 * no guides at all, because their whole job is to answer that one question.
 */

interface TextureOverlayProps {
  shown: ShownTexture
  pivot: Pivot
}

export function TextureOverlay({ shown, pivot }: TextureOverlayProps): ReactElement {
  const { placement } = shown
  const toScreen = (imageX: number, imageY: number): [number, number] => [
    placement.x + imageX * placement.scale,
    placement.y + imageY * placement.scale,
  ]

  const [imageLeft, imageTop] = toScreen(0, 0)
  const imageWidth = shown.width * placement.scale
  const imageHeight = shown.height * placement.scale

  // The pivot is a fraction of a *frame*, which is what it means to a sprite at
  // runtime. Drawn on the first frame, with the caption saying it applies to
  // every one of them — a crosshair per frame on a twenty-by-twenty sheet is
  // four hundred crosshairs.
  const pivotFrame = shown.frames[0] ?? { x: 0, y: 0, width: shown.width, height: shown.height }
  const [pivotX, pivotY] = toScreen(
    pivotFrame.x + pivot.x * pivotFrame.width,
    pivotFrame.y + pivot.y * pivotFrame.height,
  )

  const uncoveredWidth = shown.uncoveredRight * placement.scale
  const uncoveredHeight = shown.uncoveredBottom * placement.scale

  return (
    <svg className="viewport__overlay" data-testid="texture-overlay" aria-hidden="true">
      <rect
        className="viewport__bounds"
        data-testid="texture-bounds"
        x={imageLeft}
        y={imageTop}
        width={imageWidth}
        height={imageHeight}
      />

      {/*
       * The strip no frame reaches. Shaded rather than divided up, because the
       * point being made is that these pixels are in no frame at all — drawing
       * a guide across them would depict a stunted frame that nothing will ever
       * cut, which is showing something false in order to make a problem
       * visible.
       */}
      {uncoveredWidth > 0 && (
        <rect
          className="viewport__uncovered"
          data-testid="texture-uncovered-right"
          x={imageLeft + imageWidth - uncoveredWidth}
          y={imageTop}
          width={uncoveredWidth}
          height={imageHeight}
        />
      )}
      {uncoveredHeight > 0 && (
        <rect
          className="viewport__uncovered"
          data-testid="texture-uncovered-bottom"
          x={imageLeft}
          y={imageTop + imageHeight - uncoveredHeight}
          width={imageWidth - uncoveredWidth}
          height={uncoveredHeight}
        />
      )}

      {/* Only drawn when there is more than one, since a lone frame's edge is
          the image's edge and is already outlined. */}
      {shown.frames.length > 1 &&
        shown.frames.map((frame, index) => {
          const [x, y] = toScreen(frame.x, frame.y)
          return (
            <rect
              key={`${frame.x},${frame.y}`}
              className="viewport__frame"
              data-testid="texture-frame"
              data-frame-index={index}
              x={x}
              y={y}
              width={frame.width * placement.scale}
              height={frame.height * placement.scale}
            />
          )
        })}

      <g
        className="viewport__pivot"
        data-testid="texture-pivot"
        data-pivot-x={pivotX}
        data-pivot-y={pivotY}
      >
        <line x1={pivotX - 7} y1={pivotY} x2={pivotX + 7} y2={pivotY} />
        <line x1={pivotX} y1={pivotY - 7} x2={pivotX} y2={pivotY + 7} />
        <circle cx={pivotX} cy={pivotY} r={2.5} />
      </g>
    </svg>
  )
}

/**
 * What the picture is, in one line: its size, how it is cut up, and — the part
 * that earns the caption — how many pixels the grid does not reach.
 *
 * Said in words as well as shown in shading, because "the frame size does not
 * divide this image" is a thing a human needs to be able to read rather than
 * infer from a stripe down one side.
 */
export function describeShown(shown: ShownTexture): string {
  const size = `${shown.width}×${shown.height}`

  if (shown.frames.length === 0) {
    return `${size} — no frame of that size fits, so nothing is cut.`
  }

  if (shown.frames.length === 1 && shown.uncoveredRight === 0 && shown.uncoveredBottom === 0) {
    return `${size}, one frame.`
  }

  const first = shown.frames[0]
  const frames = `${shown.frames.length} ${shown.frames.length === 1 ? 'frame' : 'frames'} of ${first?.width}×${first?.height}`
  const leftovers: string[] = []
  if (shown.uncoveredRight > 0) leftovers.push(`${shown.uncoveredRight}px of the width`)
  if (shown.uncoveredBottom > 0) leftovers.push(`${shown.uncoveredBottom}px of the height`)

  if (leftovers.length === 0) return `${size}, ${frames}.`
  return `${size}, ${frames} — ${leftovers.join(' and ')} not covered.`
}
