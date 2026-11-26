import { course } from '../../chart/model/course'
import { buoyPosition } from '../../chart/lib/geometry'
import type { EventKind, Point, RaceEvent, Sample, Voyage, WindMode } from '../../../shared/race'
import { invertAffine, type AffineTransform } from '../lib/projection'

/** Archival survey -> corrected modern chart. The old sheet is rotated/skewed. */
export const OLD_TO_NEW_07: AffineTransform = { a: 0.96, b: -0.25, c: 82, d: 0.22, e: 1.03, f: -48 }

function applyTransform(transform: AffineTransform, point: Point): Point {
  return {
    x: transform.a * point.x + transform.b * point.y + transform.c,
    y: transform.d * point.x + transform.e * point.y + transform.f,
  }
}

const toOld07 = (point: Point): Point => applyTransform(invertAffine(OLD_TO_NEW_07), point)

export const PX_TO_METRES = 100 / 96

export interface ArchiveLand {
  id: string
  oldCenter: Point
  radius: number
  kind: 'shore' | 'reef'
}

export interface ArchiveChartMark {
  id: string
  name: string
  oldPoint: Point
  newPoint: Point
}

export interface ArchiveChart {
  number: string
  title: string
  edition: string
  size: Point
  lands: ArchiveLand[]
  marks: ArchiveChartMark[]
  soundings: [number, number, number][]
}

export type PairStatus = 'stable' | 'suspect' | 'custom'

export interface ShorePair {
  id: string
  name: string
  oldPoint: Point
  newPoint: Point
  status: PairStatus
  included: boolean
  note?: string
}

export interface MarkDistanceRecord {
  time: number
  markId: string
  markName: string
  distanceM: number
  label: string
}

export interface ArchiveInfo {
  raceNumber: string
  sourceNote: string
  markDistances: MarkDistanceRecord[]
}

export interface ArchiveVoyage extends Voyage {
  archive: ArchiveInfo
}

function headingBetween(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI
}

interface Waypoint {
  time: number
  point: Point
  nextGate: number
  penalty?: number
  knots?: number
}

function makeOldSamples(waypoints: Waypoint[]): Sample[] {
  return waypoints.map((waypoint, index) => {
    const next = waypoints[index + 1]?.point ?? waypoint.point
    const previous = waypoints[index - 1]?.point ?? waypoint.point
    const heading = headingBetween(toOld07(previous), toOld07(next))
    return {
      time: waypoint.time,
      boat: {
        position: toOld07(waypoint.point),
        heading,
        knots: waypoint.knots ?? (index === 0 ? 0 : 6.4),
        sheet: 74,
        rudder: 0,
      },
      wind: { bearing: 24, knots: 11 },
      nextGate: waypoint.nextGate,
      penalty: waypoint.penalty ?? 0,
    }
  })
}

function oldEvent(id: string, time: number, kind: EventKind, label: string, newPoint: Point, penalty = 0): RaceEvent {
  return { id, time, kind, label, penalty, position: toOld07(newPoint) }
}

const buoy01 = buoyPosition(course.gates[0])
const buoy02 = buoyPosition(course.gates[1])
const buoy03 = buoyPosition(course.gates[2])
const close01 = { x: buoy01.x + 0.6, y: buoy01.y + 0.4 }
const close02 = { x: buoy02.x - 0.5, y: buoy02.y + 0.6 }
const close03 = { x: buoy03.x + 0.4, y: buoy03.y - 0.6 }

const race07Waypoints: Waypoint[] = [
  { time: 0, point: { x: 125, y: 469 }, nextGate: 0, knots: 0 },
  { time: 12, point: { x: 151, y: 454 }, nextGate: 0 },
  { time: 26, point: { x: 198, y: 424 }, nextGate: 0 },
  { time: 40, point: { x: 241, y: 397 }, nextGate: 0 },
  { time: 52.4, point: close01, nextGate: 0, knots: 5.8 },
  { time: 64, point: { x: 315, y: 356 }, nextGate: 1 },
  { time: 82, point: { x: 382, y: 314 }, nextGate: 1 },
  { time: 88.6, point: { x: 407, y: 298 }, nextGate: 1, penalty: 3 },
  { time: 98, point: { x: 444, y: 276 }, nextGate: 1, penalty: 3 },
  { time: 112, point: { x: 486, y: 236 }, nextGate: 1, penalty: 3 },
  { time: 126, point: close02, nextGate: 1, knots: 5.9, penalty: 3 },
  { time: 140, point: { x: 548, y: 246 }, nextGate: 2, penalty: 3 },
  { time: 158, point: { x: 594, y: 284 }, nextGate: 2, penalty: 3 },
  { time: 176, point: { x: 640, y: 306 }, nextGate: 2, penalty: 3 },
  { time: 194, point: { x: 662, y: 344 }, nextGate: 2, penalty: 3 },
  { time: 207.6, point: close03, nextGate: 2, knots: 5.7, penalty: 3 },
  { time: 224, point: { x: 714, y: 362 }, nextGate: 3, penalty: 3 },
  { time: 244, point: { x: 758, y: 397 }, nextGate: 3, penalty: 3 },
  { time: 264, point: { x: 802, y: 425 }, nextGate: 3, penalty: 3 },
  { time: 282, point: { x: 835, y: 441 }, nextGate: 3, penalty: 3 },
  { time: 294.6, point: { x: 847, y: 445 }, nextGate: 4, penalty: 3 },
]

const race07Events: RaceEvent[] = [
  oldEvent('a-start', 0, 'start', '出发', { x: 125, y: 469 }),
  oldEvent('a-mark-01', 52.4, 'mark', '擦标通过 · 岬角标', close01),
  oldEvent('a-dev', 88.6, 'deviation', '偏离航段 · 外湾', { x: 407, y: 298 }, 3),
  oldEvent('a-mark-02', 126, 'mark', '通过 外湾标', close02),
  oldEvent('a-mark-03', 207.6, 'mark', '通过 礁口标', close03),
  oldEvent('a-finish', 294.6, 'finish', '冲过终点', { x: 847, y: 445 }),
]

const missingRaw: [number, number, number?][] = [
  [0, 176, 0], [14, 214, 0], [31, 268, 0], [48, 318, 0], [66, 354, 0],
  [82, 371, 0], [104, 421, 1], [126, 454, 1], [148, 438, 1], [172, 482, 2],
  [196, 526, 2], [220, 501, 2], [244, 548, 3], [268.2, 604, 3],
]
// The tuple is [time, x, nextGate]; y values are supplied by a parallel raw track below.
const missingCoordinates: Point[] = [
  { x: 176, y: 438 }, { x: 214, y: 414 }, { x: 268, y: 382 }, { x: 318, y: 350 },
  { x: 354, y: 326 }, { x: 371, y: 318 }, { x: 421, y: 286 }, { x: 454, y: 252 },
  { x: 438, y: 214 }, { x: 482, y: 188 }, { x: 526, y: 206 }, { x: 501, y: 258 },
  { x: 548, y: 318 }, { x: 604, y: 372 },
]

function makeMissingSamples(): Sample[] {
  return missingRaw.map(([time, , nextGate = 0], index) => {
    const position = missingCoordinates[index]
    const next = missingCoordinates[index + 1] ?? position
    const previous = missingCoordinates[index - 1] ?? position
    return {
      time,
      boat: { position, heading: headingBetween(previous, next), knots: index === 0 ? 0 : 6.2, sheet: 72, rudder: 0 },
      wind: { bearing: 352, knots: 12 },
      nextGate,
      penalty: 0,
    }
  })
}

const missingEvents: RaceEvent[] = [
  { id: 'b-start', time: 0, kind: 'start', label: '出发', position: missingCoordinates[0], penalty: 0 },
  { id: 'b-mark', time: 82, kind: 'mark', label: '擦标通过 · 一号标', position: missingCoordinates[5], penalty: 0 },
  { id: 'b-finish', time: 268.2, kind: 'finish', label: '冲过终点', position: missingCoordinates.at(-1)!, penalty: 0 },
]

export const archiveCharts: ArchiveChart[] = [
  {
    number: '07',
    title: '针岬湾旧测图',
    edition: '1976 测 · 1978 晒印',
    size: { x: 960, y: 570 },
    lands: course.hazards.map((hazard): ArchiveLand => ({
      id: hazard.id,
      oldCenter: toOld07(hazard.center),
      radius: hazard.radius * 0.985,
      kind: hazard.radius > 100 ? 'shore' : 'reef',
    })),
    marks: course.gates.map((gate): ArchiveChartMark => {
      const newPoint = buoyPosition(gate)
      return { id: gate.id, name: gate.name, newPoint, oldPoint: toOld07(newPoint) }
    }),
    soundings: [
      [245, 112, 18], [341, 258, 25], [447, 284, 38], [564, 298, 29], [630, 248, 32],
      [195, 283, 13], [267, 444, 28], [342, 427, 35], [611, 393, 18], [733, 471, 23],
    ].map(([x, y, depth]) => {
      const old = toOld07({ x, y })
      return [old.x, old.y, depth] as [number, number, number]
    }),
  },
]

const pairNewPoints = {
  lighthouse: { x: 118, y: 96 },
  northMark: { x: 382, y: 78 },
  southBeacon: { x: 540, y: 485 },
  westPier: { x: 96, y: 430 },
  eastTower: { x: 902, y: 206 },
}

export const defaultShorePairs: Record<string, ShorePair[]> = {
  '07': [
    { id: 'pair-1', name: '针岬灯塔', newPoint: pairNewPoints.lighthouse, oldPoint: toOld07(pairNewPoints.lighthouse), status: 'stable', included: true },
    { id: 'pair-2', name: '北嘴石标', newPoint: pairNewPoints.northMark, oldPoint: toOld07(pairNewPoints.northMark), status: 'stable', included: true },
    { id: 'pair-3', name: '潮音礁灯桩', newPoint: pairNewPoints.southBeacon, oldPoint: toOld07(pairNewPoints.southBeacon), status: 'stable', included: true },
    { id: 'pair-4', name: '西码头角', newPoint: pairNewPoints.westPier, oldPoint: toOld07(pairNewPoints.westPier), status: 'stable', included: true },
    {
      id: 'pair-5',
      name: '东岸固定物',
      newPoint: pairNewPoints.eastTower,
      // Deliberate archival mis-pair: the clerk selected the old windmill base,
      // 46/32 chart units away from the tower shown on the corrected sheet.
      oldPoint: (() => {
        const correct = toOld07(pairNewPoints.eastTower)
        return { x: correct.x - 46, y: correct.y + 32 }
      })(),
      status: 'suspect',
      included: true,
      note: '旧注记同时出现“望台”和“风车基址”',
    },
  ],
}

export const archiveVoyages: ArchiveVoyage[] = [
  {
    id: 'archive-1978-07',
    date: '1978-08-19T10:30:00.000Z',
    courseId: course.id,
    windMode: 'steady' as WindMode,
    status: 'finished',
    duration: 294.6,
    penalty: 3,
    samples: makeOldSamples(race07Waypoints),
    events: race07Events,
    archive: {
      raceNumber: '07',
      sourceNote: '航次资料只记录赛道编号；时间、罚时与擦标距离来自纸质裁判卡',
      markDistances: [
        { time: 52.4, markId: '01', markName: '岬角标', distanceM: 0.8, label: '擦标最近距离' },
        { time: 126, markId: '02', markName: '外湾标', distanceM: 2.1, label: '绕标最近距离' },
        { time: 207.6, markId: '03', markName: '礁口标', distanceM: 1.4, label: '绕标最近距离' },
      ],
    },
  },
  {
    id: 'archive-1983-12',
    date: '1983-07-09T11:05:00.000Z',
    courseId: 'unknown-harbour-number',
    windMode: 'shifting' as WindMode,
    status: 'finished',
    duration: 268.2,
    penalty: 0,
    samples: makeMissingSamples(),
    events: missingEvents,
    archive: {
      raceNumber: '12',
      sourceNote: '航次资料只记录原始坐标、赛道编号与纸质裁判卡',
      markDistances: [
        { time: 82, markId: '1', markName: '一号标', distanceM: 1.1, label: '擦标最近距离' },
      ],
    },
  },
]

export function findArchiveChart(raceNumber: string, charts: ArchiveChart[] = archiveCharts): ArchiveChart | null {
  const normalized = raceNumber.trim()
  return charts.find(chart => chart.number === normalized || chart.number.padStart(2, '0') === normalized.padStart(2, '0')) ?? null
}
