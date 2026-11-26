import type { Point } from '../../../shared/race'
import { distance } from '../../../shared/math'

export interface AffineTransform {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export interface ProjectionPair {
  oldPoint: Point
  newPoint: Point
}

export interface ProjectionHypothesis {
  id: string
  label: string
  transform: AffineTransform
}

export type SegmentStatus = 'located' | 'ambiguous'

export interface TrackSegment {
  id: string
  index: number
  startIndex: number
  endIndex: number
  startTime: number
  endTime: number
  status: SegmentStatus
  maxSpread: number
  points: Point[]
  candidates: { id: string; label: string; points: Point[] }[]
}

export const IDENTITY_TRANSFORM: AffineTransform = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 }

export function applyAffine(transform: AffineTransform, point: Point): Point {
  return {
    x: transform.a * point.x + transform.b * point.y + transform.c,
    y: transform.d * point.x + transform.e * point.y + transform.f,
  }
}

export function invertAffine(transform: AffineTransform): AffineTransform {
  const det = transform.a * transform.e - transform.b * transform.d
  if (Math.abs(det) < 1e-10) return IDENTITY_TRANSFORM
  return {
    a: transform.e / det,
    b: -transform.b / det,
    c: (transform.b * transform.f - transform.c * transform.e) / det,
    d: -transform.d / det,
    e: transform.a / det,
    f: (transform.c * transform.d - transform.a * transform.f) / det,
  }
}

function solve3(matrix: number[][], rhs: number[]): number[] | null {
  const rows = matrix.map((row, i) => [...row, rhs[i]])
  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row
    }
    if (Math.abs(rows[pivot][col]) < 1e-9) return null
    ;[rows[col], rows[pivot]] = [rows[pivot], rows[col]]
    for (let row = col + 1; row < 3; row++) {
      const factor = rows[row][col] / rows[col][col]
      for (let k = col; k < 4; k++) rows[row][k] -= factor * rows[col][k]
    }
  }
  const answer = [0, 0, 0]
  for (let row = 2; row >= 0; row--) {
    let value = rows[row][3]
    for (let col = row + 1; col < 3; col++) value -= rows[row][col] * answer[col]
    answer[row] = value / rows[row][row]
  }
  return answer
}

/** Least-squares affine map. Three non-collinear pairs give an exact fit. */
export function fitAffine(pairs: ProjectionPair[]): AffineTransform | null {
  if (pairs.length < 3) return null
  const normal = Array.from({ length: 3 }, () => [0, 0, 0])
  const rhsX = [0, 0, 0]
  const rhsY = [0, 0, 0]
  for (const pair of pairs) {
    const terms = [pair.oldPoint.x, pair.oldPoint.y, 1]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) normal[i][j] += terms[i] * terms[j]
      rhsX[i] += terms[i] * pair.newPoint.x
      rhsY[i] += terms[i] * pair.newPoint.y
    }
  }
  const x = solve3(normal, rhsX)
  const y = solve3(normal, rhsY)
  if (!x || !y) return null
  return { a: x[0], b: x[1], c: x[2], d: y[0], e: y[1], f: y[2] }
}

/** Similarity transform for exactly two reliable pairs. */
export function fitSimilarity(pairs: ProjectionPair[]): AffineTransform | null {
  if (pairs.length < 2) return null
  const [first, second] = pairs
  const oldVector = { x: second.oldPoint.x - first.oldPoint.x, y: second.oldPoint.y - first.oldPoint.y }
  const newVector = { x: second.newPoint.x - first.newPoint.x, y: second.newPoint.y - first.newPoint.y }
  const denominator = oldVector.x ** 2 + oldVector.y ** 2
  if (denominator < 1e-9) return null
  const q = (oldVector.x * newVector.x + oldVector.y * newVector.y) / denominator
  const r = (oldVector.x * newVector.y - oldVector.y * newVector.x) / denominator
  return {
    a: q,
    b: -r,
    c: first.newPoint.x - (q * first.oldPoint.x - r * first.oldPoint.y),
    d: r,
    e: q,
    f: first.newPoint.y - (r * first.oldPoint.x + q * first.oldPoint.y),
  }
}

export function fitProjection(pairs: ProjectionPair[]): AffineTransform | null {
  if (pairs.length >= 3) return fitAffine(pairs)
  if (pairs.length === 2) return fitSimilarity(pairs)
  return null
}

export function transformHeading(transform: AffineTransform, heading: number): number {
  const radians = heading * Math.PI / 180
  const x = Math.cos(radians)
  const y = Math.sin(radians)
  return Math.atan2(transform.d * x + transform.e * y, transform.a * x + transform.b * y) * 180 / Math.PI
}

export function pairResidual(transform: AffineTransform, pair: ProjectionPair): number {
  return distance(applyAffine(transform, pair.oldPoint), pair.newPoint)
}

export function candidateSpread(point: Point, hypotheses: ProjectionHypothesis[]): number {
  if (hypotheses.length < 2) return 0
  const projected = hypotheses.map(hypothesis => applyAffine(hypothesis.transform, point))
  let worst = 0
  for (let i = 0; i < projected.length; i++) {
    for (let j = i + 1; j < projected.length; j++) worst = Math.max(worst, distance(projected[i], projected[j]))
  }
  return worst
}

/**
 * Group consecutive track edges by whether all plausible projections agree.
 * An edge is ambiguous when any endpoint has candidate positions farther apart
 * than the tolerance.
 */
export function classifyTrack(
  samples: { time: number; oldPoint: Point }[],
  hypotheses: ProjectionHypothesis[],
  tolerancePx = 16,
): TrackSegment[] {
  if (samples.length < 2 || hypotheses.length === 0) return []
  const spreads = samples.map(sample => candidateSpread(sample.oldPoint, hypotheses))
  const edgeStatus = samples.slice(0, -1).map((_, index) =>
    Math.max(spreads[index], spreads[index + 1]) > tolerancePx ? 'ambiguous' as const : 'located' as const)

  const segments: TrackSegment[] = []
  let startEdge = 0
  for (let edge = 1; edge <= edgeStatus.length; edge++) {
    if (edge < edgeStatus.length && edgeStatus[edge] === edgeStatus[startEdge]) continue
    const endEdge = edge - 1
    const startIndex = startEdge
    const endIndex = endEdge + 1
    const status = edgeStatus[startEdge]
    const slice = samples.slice(startIndex, endIndex + 1)
    segments.push({
      id: `segment-${segments.length + 1}`,
      index: segments.length,
      startIndex,
      endIndex,
      startTime: samples[startIndex].time,
      endTime: samples[endIndex].time,
      status,
      maxSpread: Math.max(...spreads.slice(startIndex, endIndex + 1)),
      points: slice.map(sample => applyAffine(hypotheses[0].transform, sample.oldPoint)),
      candidates: hypotheses.map(hypothesis => ({
        id: hypothesis.id,
        label: hypothesis.label,
        points: slice.map(sample => applyAffine(hypothesis.transform, sample.oldPoint)),
      })),
    })
    startEdge = edge
  }
  return segments
}
