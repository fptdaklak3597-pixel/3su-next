/**
 * Beep POS — Web Audio, không file. Tôn trọng settings.soundOn.
 */
export type PosSound = 'scan-ok' | 'scan-miss' | 'sale'

const TONE: Record<PosSound, { hz: number; ms: number }> = {
  'scan-ok': { hz: 880, ms: 70 },
  'scan-miss': { hz: 220, ms: 120 },
  sale: { hz: 660, ms: 140 },
}

export function playPosSound(
  kind: PosSound,
  soundOn: boolean,
  beep?: (hz: number, ms: number) => void,
): boolean {
  if (!soundOn) return false
  const t = TONE[kind]
  if (beep) {
    beep(t.hz, t.ms)
    return true
  }
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return false
    const ctx = new AC()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = t.hz
    gain.gain.value = 0.08
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + t.ms / 1000)
    osc.onended = () => { void ctx.close() }
    return true
  } catch {
    return false
  }
}
