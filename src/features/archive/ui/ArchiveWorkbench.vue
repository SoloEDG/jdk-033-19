<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AlertTriangle, CheckCircle2, Crosshair, Layers, Link2, Map as MapIcon,
  RotateCcw, Trash2, X,
} from 'lucide-vue-next'
import { CourseChart, course } from '../../chart'
import { pathFor } from '../../chart/lib/chartMarks'
import BoatGlyph from '../../chart/ui/BoatGlyph.vue'
import { clock } from '../../../shared/format'
import { distance } from '../../../shared/math'
import type { Point, Sample } from '../../../shared/race'
import { sampleAt } from '../../logbook/lib/replay'
import {
  archiveVoyages, defaultShorePairs, findArchiveChart, PX_TO_METRES,
  type ArchiveVoyage, type ShorePair,
} from '../model/archiveData'
import {
  applyAffine, classifyTrack, fitProjection, pairResidual, transformHeading,
  type ProjectionHypothesis,
} from '../lib/projection'

const props = defineProps<{ voyage: ArchiveVoyage; time: number }>()
const emit = defineEmits<{ seek: [time: number]; exit: []; open: [id: string] }>()

const raceNumber = computed(() => props.voyage.archive.raceNumber)
const numberInput = ref(props.voyage.archive.raceNumber)
const lookupNumber = ref(props.voyage.archive.raceNumber)
const chart = computed(() => findArchiveChart(lookupNumber.value))
const pairs = ref<ShorePair[]>([])
const pickStage = ref<'idle' | 'old' | 'new'>('idle')
const draftOld = ref<Point | null>(null)

function resetPairs() {
  pairs.value = chart.value ? (defaultShorePairs[chart.value.number] ?? []).map(pair => ({ ...pair })) : []
}

watch(() => props.voyage.id, () => {
  numberInput.value = props.voyage.archive.raceNumber
  lookupNumber.value = props.voyage.archive.raceNumber
  resetPairs()
  pickStage.value = 'idle'
  draftOld.value = null
}, { immediate: true })

function lookupChart() {
  lookupNumber.value = numberInput.value.trim()
  resetPairs()
}

const trustedPairs = computed(() => pairs.value.filter(pair => pair.included && pair.status !== 'suspect'))
const activePairs = computed(() => pairs.value.filter(pair => pair.included))
const primaryTransform = computed(() => fitProjection(trustedPairs.value))
const alternateTransform = computed(() => {
  if (!pairs.value.some(pair => pair.included && pair.status === 'suspect')) return null
  return fitProjection(activePairs.value)
})

const hypotheses = computed<ProjectionHypothesis[]>(() => {
  if (!primaryTransform.value) return []
  const result: ProjectionHypothesis[] = [
    { id: 'trusted', label: '排除疑似配对', transform: primaryTransform.value },
  ]
  if (alternateTransform.value) {
    result.push({ id: 'all-pairs', label: '保留疑似配对', transform: alternateTransform.value })
  }
  return result
})

const diagnostics = computed(() => {
  if (!primaryTransform.value) return null
  const transform = primaryTransform.value
  return {
    rotation: Math.atan2(transform.d, transform.a) * 180 / Math.PI,
    scale: Math.hypot(transform.a, transform.d),
  }
})

const residualRows = computed(() => pairs.value.map(pair => ({
  pair,
  residual: primaryTransform.value ? pairResidual(primaryTransform.value, pair) : null,
})))

const rawFrame = computed<Sample>(() => sampleAt(props.voyage.samples, props.time) ?? props.voyage.samples[0])
const projectedFrame = computed<Sample>(() => {
  const raw = rawFrame.value
  if (!primaryTransform.value) return raw
  return {
    ...raw,
    boat: {
      ...raw.boat,
      position: applyAffine(primaryTransform.value, raw.boat.position),
      heading: transformHeading(primaryTransform.value, raw.boat.heading),
    },
  }
})
const currentOld = computed<Point>(() => rawFrame.value.boat.position)
const currentNew = computed<Point | null>(() => primaryTransform.value ? applyAffine(primaryTransform.value, currentOld.value) : null)
const candidateCurrent = computed(() => hypotheses.value.map(hypothesis => ({
  id: hypothesis.id,
  label: hypothesis.label,
  point: applyAffine(hypothesis.transform, currentOld.value),
})))

const trackInputs = computed(() => props.voyage.samples.map(sample => ({ time: sample.time, oldPoint: sample.boat.position })))
const segments = computed(() => chart.value ? classifyTrack(trackInputs.value, hypotheses.value, 16) : [])
const oldTrailPath = computed(() => pathFor(props.voyage.samples.map(sample => sample.boat.position)))
const rawTrailPath = oldTrailPath

const nearestMeasurement = computed(() => {
  const rows = props.voyage.archive.markDistances.map(record => ({
    ...record,
    delta: Math.abs(record.time - props.time),
  }))
  return rows.sort((a, b) => a.delta - b.delta)[0] ?? null
})
const atMeasurement = computed(() => Boolean(nearestMeasurement.value && nearestMeasurement.value.delta <= 4))
const measuredNewMark = computed(() => {
  if (!chart.value || !nearestMeasurement.value) return null
  return chart.value.marks.find(mark => mark.id === nearestMeasurement.value?.markId)?.newPoint ?? null
})
const newMarkDistance = computed(() => {
  if (!currentNew.value || !measuredNewMark.value) return null
  return distance(currentNew.value, measuredNewMark.value) * PX_TO_METRES
})

function pointFromEvent(event: MouseEvent, svgOverride?: SVGSVGElement): Point | null {
  const svg = svgOverride ?? event.currentTarget as SVGSVGElement
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const svgPoint = svg.createSVGPoint()
  svgPoint.x = event.clientX
  svgPoint.y = event.clientY
  const point = svgPoint.matrixTransform(ctm.inverse())
  return { x: point.x, y: point.y }
}
function onOldChartClick(event: MouseEvent) {
  if (pickStage.value !== 'old') return
  const point = pointFromEvent(event)
  if (!point) return
  draftOld.value = point
  pickStage.value = 'new'
}
function onNewChartClick(event: MouseEvent) {
  if (pickStage.value !== 'new' || !draftOld.value) return
  const svg = (event.currentTarget as HTMLElement).querySelector('svg')
  if (!svg) return
  const point = pointFromEvent(event, svg)
  if (!point) return
  pairs.value.push({
    id: `custom-${Date.now()}`,
    name: `岸物 ${pairs.value.length + 1}`,
    oldPoint: draftOld.value,
    newPoint: point,
    status: 'custom',
    included: true,
  })
  draftOld.value = null
  pickStage.value = 'idle'
}
function startPicking() {
  draftOld.value = null
  pickStage.value = 'old'
}
function cancelPicking() {
  draftOld.value = null
  pickStage.value = 'idle'
}
function toggleIncluded(id: string) {
  pairs.value = pairs.value.map(pair => pair.id === id ? { ...pair, included: !pair.included } : pair)
}
function toggleSuspect(id: string) {
  pairs.value = pairs.value.map(pair => pair.id === id
    ? { ...pair, status: pair.status === 'suspect' ? 'stable' : 'suspect' }
    : pair)
}
function removePair(id: string) {
  pairs.value = pairs.value.filter(pair => pair.id !== id)
}
function seekFromInput(event: Event) {
  emit('seek', Number((event.target as HTMLInputElement).value))
}
function seek(time: number) {
  emit('seek', time)
}
function selectVoyage(event: Event) {
  emit('open', (event.target as HTMLSelectElement).value)
}
function pairColor(pair: ShorePair): string {
  return pair.status === 'suspect' ? '#d85b3f' : pair.status === 'custom' ? '#e0a92f' : '#2f8079'
}
</script>

<template>
  <section class="archive-workbench" aria-label="旧海图校勘工作台" data-testid="archive-workbench">
    <header class="archive-header">
      <div class="archive-title">
        <Layers :size="21" />
        <div>
          <h2>旧海图完赛航迹 · 新版校勘对照</h2>
          <p>
            <span>旧航次只有赛道编号 <b data-testid="archive-race-number">{{ raceNumber }}</b></span>
            <label class="number-lookup" for="archive-number-input">
              查同号底图
              <input
                id="archive-number-input"
                data-testid="race-number-input"
                v-model="numberInput"
                inputmode="numeric"
                @keydown.enter.prevent="lookupChart"
              >
            </label>
            <button type="button" class="lookup-button" data-testid="find-chart-button" @click="lookupChart">查找</button>
            <select class="archive-case-select" aria-label="选择旧档航次" data-testid="archive-case-select" :value="voyage.id" @change="selectVoyage">
              <option v-for="item in archiveVoyages" :key="item.id" :value="item.id">
                切换赛道 {{ item.archive.raceNumber }} · {{ item.status === 'finished' ? '完赛' : '未完赛' }}
              </option>
            </select>
          </p>
        </div>
      </div>
      <button type="button" class="archive-exit" @click="emit('exit')"><MapIcon :size="15" />返回新版海图</button>
    </header>

    <div v-if="!chart" class="archive-alert" data-testid="chart-missing" data-projection="unavailable">
      <AlertTriangle :size="25" />
      <div>
        <span class="projection-badge" data-testid="projection-unavailable">无法投影</span>
        <h3>未找到与编号 {{ lookupNumber || '（空）' }} 一致的存档底图</h3>
        <p>{{ voyage.archive.sourceNote }}。以下只允许回看原坐标与旧裁判记录；新版位置不做猜测。</p>
      </div>
    </div>

    <template v-else>
      <div class="archive-found" data-testid="chart-found">
        <CheckCircle2 :size="17" />
        <div>
          已按编号匹配 <b>{{ chart.number }} 号存档底图</b>：{{ chart.title }}（{{ chart.edition }}）
          <span v-if="diagnostics" class="transform-note">
            新图基准稳定；旧图相对偏转 {{ diagnostics.rotation.toFixed(1) }}°、尺度 {{ diagnostics.scale.toFixed(3) }}
          </span>
        </div>
        <button type="button" class="pair-add" data-testid="add-shore-pair" :aria-pressed="pickStage !== 'idle'" @click="startPicking">
          <Link2 :size="15" />标记同一固定岸物
        </button>
      </div>
      <div v-if="pickStage !== 'idle'" class="pick-banner" data-testid="pick-banner">
        <Crosshair :size="15" />
        <span v-if="pickStage === 'old'">① 请在左侧旧图点击固定岸物</span>
        <span v-else>② 请在右侧新版图点击同一岸物</span>
        <button type="button" @click="cancelPicking"><X :size="14" />取消</button>
      </div>
    </template>

    <div class="archive-maps" :class="{ 'is-missing': !chart }">
      <article v-if="chart" class="map-card old-chart-card">
        <header><span>旧版图 · 原坐标</span><small>点击取点后，岸物编号会同步到右表</small></header>
        <svg
          class="archive-svg old-svg"
          :viewBox="`0 0 ${chart.size.x} ${chart.size.y}`"
          role="img"
          aria-label="旧海图与原始航迹"
          data-testid="old-chart"
          :class="{ picking: pickStage === 'old' }"
          @click="onOldChartClick"
        >
          <defs>
            <pattern id="archive-grid" width="42" height="42" patternUnits="userSpaceOnUse">
              <path d="M42 0H0V42" fill="none" stroke="#8b7b52" stroke-opacity=".22" />
            </pattern>
          </defs>
          <rect width="960" height="570" fill="#e7d6aa" />
          <rect width="960" height="570" fill="url(#archive-grid)" />
          <text v-for="depth in chart.soundings" :key="`old-depth-${depth.join('-')}`" :x="depth[0]" :y="depth[1]" fill="#766744" opacity=".62" class="depth">{{ depth[2] }}</text>
          <g v-for="land in chart.lands" :key="`old-land-${land.id}`">
            <circle :cx="land.oldCenter.x" :cy="land.oldCenter.y" :r="land.radius" :fill="land.kind === 'shore' ? '#b9a675' : '#9e9a76'" stroke="#76653f" stroke-width="1.7" />
            <text :x="land.oldCenter.x" :y="land.oldCenter.y + 5" text-anchor="middle" fill="#3f3a2b" class="water-text">{{ land.id }}</text>
          </g>
          <path :d="oldTrailPath" fill="none" stroke="#7c3428" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />
          <g v-for="mark in chart.marks" :key="`old-mark-${mark.id}`">
            <circle :cx="mark.oldPoint.x" :cy="mark.oldPoint.y" r="8.5" fill="#a33f2b" stroke="#f4e7c4" stroke-width="2" />
            <text :x="mark.oldPoint.x + 12" :y="mark.oldPoint.y - 10" fill="#4d3428" class="water-text">{{ mark.id }} {{ mark.name }}</text>
          </g>
          <g v-for="(pair, index) in pairs" :key="`old-pair-${pair.id}`" :transform="`translate(${pair.oldPoint.x} ${pair.oldPoint.y})`">
            <circle r="13" :fill="pairColor(pair)" stroke="#fff4d2" stroke-width="2.4" />
            <text y="4.5" text-anchor="middle" font-size="12" font-weight="700" fill="#fff8df">{{ index + 1 }}</text>
          </g>
          <circle v-if="draftOld" :cx="draftOld.x" :cy="draftOld.y" r="16" fill="none" stroke="#2f8079" stroke-width="2.4" stroke-dasharray="5 4" />
          <BoatGlyph :boat="rawFrame.boat" />
        </svg>
      </article>

      <article v-if="chart" class="map-card new-chart-card">
        <header><span>校勘后新版图 · 投影航迹</span><small>绿色/黄色为可定位段；红色虚线为另一解释</small></header>
        <div class="new-chart-host" :class="{ picking: pickStage === 'new' }" data-testid="new-chart-click-host" @click="onNewChartClick">
          <CourseChart :course="course" :frame="projectedFrame" :trail="[]" :replay="true" :focus="currentNew" :show-boat="Boolean(primaryTransform)">
            <template #overlay>
              <g data-testid="projected-segments">
                <path
                  v-for="segment in segments"
                  :key="`seg-${segment.id}`"
                  :d="pathFor(segment.points)"
                  fill="none"
                  :stroke="segment.status === 'located' ? '#7dffb6' : '#ffd455'"
                  :stroke-width="segment.status === 'located' ? 4.5 : 4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  :opacity=".92"
                />
                <template v-for="segment in segments.filter(item => item.status === 'ambiguous')" :key="`cand-${segment.id}`">
                  <path
                    v-for="candidate in segment.candidates.filter(item => item.id !== 'trusted')"
                    :key="candidate.id"
                    :d="pathFor(candidate.points)"
                    fill="none"
                    stroke="#ff6b4a"
                    stroke-width="3.2"
                    stroke-dasharray="9 7"
                    stroke-linecap="round"
                  />
                </template>
                <g v-for="(pair, index) in pairs" :key="`new-pair-${pair.id}`" :transform="`translate(${pair.newPoint.x} ${pair.newPoint.y})`">
                  <circle r="12.5" :fill="pairColor(pair)" stroke="#f8f1d6" stroke-width="2.2" />
                  <text y="4.5" text-anchor="middle" font-size="12" font-weight="700" fill="#fff8df">{{ index + 1 }}</text>
                </g>
                <g v-for="candidate in candidateCurrent.slice(1)" :key="`candidate-current-${candidate.id}`" :transform="`translate(${candidate.point.x} ${candidate.point.y})`">
                  <circle r="10" fill="none" stroke="#ff6b4a" stroke-width="2.4" stroke-dasharray="4 3" />
                </g>
              </g>
            </template>
          </CourseChart>
          <div v-if="!primaryTransform" class="projection-insufficient" data-testid="projection-insufficient">
            <AlertTriangle :size="18" />至少需要两对有效岸物才能投影；请继续在两版图上标记同一固定岸物。
          </div>
          <div v-if="pickStage === 'new'" class="new-click-catcher" aria-hidden="true"></div>
        </div>
      </article>

      <article v-else class="map-card raw-coordinate-card">
        <header><span>原坐标回看</span><small>无投影、无新版位置推断</small></header>
        <svg class="archive-svg raw-svg" viewBox="0 0 760 520" role="img" aria-label="缺失底图时的原始坐标轨迹" data-testid="raw-coordinate-chart">
          <rect width="760" height="520" fill="#efe4c5" />
          <path d="M40 40V480H720" fill="none" stroke="#9c8d64" stroke-width="1.4" />
          <path :d="rawTrailPath" fill="none" stroke="#7c3428" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
          <g v-for="event in voyage.events" :key="`raw-event-${event.id}`">
            <circle :cx="event.position.x" :cy="event.position.y" r="6" :fill="event.kind === 'finish' ? '#2f8079' : '#a33f2b'" stroke="#fff4d2" stroke-width="2" />
          </g>
          <circle :cx="currentOld.x" :cy="currentOld.y" r="10" fill="#20272c" stroke="#ffd455" stroke-width="3" />
        </svg>
      </article>
    </div>

    <section v-if="chart" class="segment-panel" aria-label="航迹定位分段">
      <h3>定位分段</h3>
      <p class="segment-explain">稳定岸物给出唯一投影；第 5 对「东岸固定物」配对疑似标错，因此东段同时保留排除与保留该配对的位置解释。</p>
      <ul class="segment-list" data-testid="segment-list">
        <li v-for="segment in segments" :key="segment.id" :data-status="segment.status">
          <button type="button" @click="seek(segment.startTime)">
            <CheckCircle2 v-if="segment.status === 'located'" :size="18" />
            <AlertTriangle v-else :size="18" />
            <span class="segment-copy">
              <b>{{ segment.status === 'located' ? '确能定位' : '仍有多个位置解释' }} · 航段 {{ segment.index + 1 }}</b>
              <small>
                {{ clock(segment.startTime) }}–{{ clock(segment.endTime) }} ·
                <template v-if="segment.status === 'located'">候选投影一致</template>
                <template v-else>两种解释最多相差 {{ (segment.maxSpread * PX_TO_METRES).toFixed(0) }} m</template>
              </small>
            </span>
            <span class="segment-spread">{{ segment.maxSpread.toFixed(1) }} px</span>
          </button>
        </li>
        <li v-if="!segments.length" class="segment-empty">至少需要两对有效且不重合的岸物配对，才能计算投影。</li>
      </ul>
    </section>

    <section class="archive-inspector" aria-label="擦标位置与原始距离">
      <div class="inspector-block scrub-block">
        <label for="archive-playhead">拖动时间轴到擦标 / 绕标时刻</label>
        <input
          id="archive-playhead"
          data-testid="archive-scrubber"
          type="range"
          min="0"
          :max="voyage.duration"
          step=".01"
          :value="time"
          :aria-valuetext="clock(time)"
          @input="seekFromInput"
        >
        <div class="coordinate-grid">
          <div data-testid="old-coordinate">
            <span>原坐标</span>
            <output>x {{ currentOld.x.toFixed(1) }} · y {{ currentOld.y.toFixed(1) }}</output>
          </div>
          <div data-testid="new-position" :data-projection="currentNew ? 'projected' : 'unavailable'">
            <span>新版位置</span>
            <output v-if="currentNew">x {{ currentNew.x.toFixed(1) }} · y {{ currentNew.y.toFixed(1) }}</output>
            <output v-else class="unprojectable">无法投影（缺底图/有效配对不足）</output>
          </div>
        </div>
      </div>

      <div class="inspector-block distance-block" data-testid="mark-distance-panel" :data-at-mark="atMeasurement">
        <h3><Crosshair :size="16" />擦标核对</h3>
        <template v-if="nearestMeasurement">
          <button type="button" class="measurement-jump" data-testid="jump-to-mark" @click="seek(nearestMeasurement.time)">
            {{ clock(nearestMeasurement.time) }} · {{ nearestMeasurement.label }} {{ nearestMeasurement.markName }}
          </button>
          <p class="original-distance" data-testid="original-mark-distance">
            船到旧标的原始距离
            <strong>{{ nearestMeasurement.distanceM.toFixed(1) }} m</strong>
          </p>
          <p v-if="newMarkDistance !== null" class="new-distance" data-testid="new-mark-distance">
            新版图算距离（仅核对）：{{ newMarkDistance.toFixed(1) }} m
          </p>
          <p v-else class="new-distance unprojectable">新版距离：无法投影</p>
        </template>
        <p v-else class="empty-note">本航次没有擦标测距记录。</p>
      </div>

      <div class="inspector-block result-block" data-testid="old-jury-result">
        <h3>成绩口径</h3>
        <strong class="result-time" data-testid="archive-result-time">{{ clock(voyage.duration + voyage.penalty) }}</strong>
        <p>继续使用旧裁判记录，不按校勘投影后的轨迹重算。</p>
        <small>原始时长 {{ clock(voyage.duration) }} · 罚时 +{{ voyage.penalty }} s</small>
      </div>
    </section>

    <section v-if="chart" class="pair-panel" aria-label="固定岸物配对列表">
      <div class="pair-panel-heading">
        <h3>两版海图的同一固定岸物</h3>
        <button type="button" class="reset-pairs" data-testid="reset-pairs" @click="resetPairs"><RotateCcw :size="14" />恢复示例配对</button>
      </div>
      <ul class="pair-list" data-testid="pair-list">
        <li v-for="(pair, index) in residualRows" :key="pair.pair.id" :data-status="pair.pair.status">
          <span class="pair-number" :style="{ background: pairColor(pair.pair) }">{{ index + 1 }}</span>
          <div class="pair-copy">
            <b>{{ pair.pair.name }}</b>
            <small v-if="pair.residual !== null">
              稳定投影残差 {{ pair.residual.toFixed(1) }} px
              <template v-if="pair.residual > 22"> · 配对疑似标错</template>
            </small>
            <p v-if="pair.pair.note">{{ pair.pair.note }}</p>
          </div>
          <label class="pair-include"><input type="checkbox" :checked="pair.pair.included" @change="toggleIncluded(pair.pair.id)">启用</label>
          <button type="button" class="suspect-button" :aria-pressed="pair.pair.status === 'suspect'" @click="toggleSuspect(pair.pair.id)">
            {{ pair.pair.status === 'suspect' ? '取消疑似' : '标为疑似' }}
          </button>
          <button type="button" class="pair-delete" title="删除配对" :aria-label="`删除配对 ${pair.pair.name}`" @click="removePair(pair.pair.id)"><Trash2 :size="15" /></button>
        </li>
      </ul>
    </section>

    <section class="archive-jury" aria-label="旧裁判记录">
      <h3>旧裁判记录</h3>
      <div class="archive-event-list" data-testid="archive-event-list">
        <button v-for="event in voyage.events" :key="event.id" type="button" :data-kind="event.kind" @click="seek(event.time)">
          <time>{{ clock(event.time) }}</time>
          <span>{{ event.label }}</span>
          <b v-if="event.penalty">+{{ event.penalty }} s</b>
        </button>
      </div>
    </section>
  </section>
</template>
