import { computed, ref, shallowRef } from 'vue'
import { clamp } from '../../../shared/math'
import type { Sample, Voyage } from '../../../shared/race'
import { archiveVoyages } from '../../archive/model/archiveData'
import { sampleAt } from '../lib/replay'
import { loadVoyages, saveVoyages } from '../lib/storage'

export function useLogbook() {
  const saved = shallowRef(loadVoyages())
  const samples = shallowRef<Sample[]>([])
  const selected = shallowRef<Voyage | null>(null)
  const cursor = ref(0)
  const notice = ref('')
  const voyages = computed<Voyage[]>(() => [...archiveVoyages, ...saved.value])
  function record(frame: Sample, force = false) {
    const last = samples.value.at(-1)
    if (!force && last && frame.time - last.time < .19) return
    samples.value = last?.time === frame.time ? [...samples.value.slice(0, -1), frame] : [...samples.value, frame]
  }
  function archive(result: Omit<Voyage, 'samples' | 'id' | 'date'>) {
    const voyage: Voyage = { ...result, id: crypto.randomUUID(), date: new Date().toISOString(), samples: samples.value }
    const next = [voyage, ...saved.value].slice(0, 12)
    saved.value = next
    notice.value = saveVoyages(next) ? '' : '存储已满或不可用，本航次仅保留在当前页面。'
  }
  function open(id: string) {
    const voyage = voyages.value.find(item => item.id === id)
    if (voyage) { selected.value = voyage; cursor.value = voyage.duration }
  }
  function seek(time: number) {
    cursor.value = clamp(time, 0, selected.value?.duration ?? 0)
  }
  const frame = computed(() => selected.value ? sampleAt(selected.value.samples, cursor.value) : null)
  return { voyages, samples, selected, cursor, frame, notice, record, archive, open, seek }
}
