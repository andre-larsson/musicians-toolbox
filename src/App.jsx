import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import './App.css'

const STRING_SETS = {
  guitar: [
    { note: 'E2', frequency: 82.41 },
    { note: 'A2', frequency: 110.0 },
    { note: 'D3', frequency: 146.83 },
    { note: 'G3', frequency: 196.0 },
    { note: 'B3', frequency: 246.94 },
    { note: 'E4', frequency: 329.63 },
  ],
  bass: [
    { note: 'E1', frequency: 41.2 },
    { note: 'A1', frequency: 55.0 },
    { note: 'D2', frequency: 73.42 },
    { note: 'G2', frequency: 98.0 },
  ],
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function App() {
  const [metronomeBpm, setMetronomeBpm] = useState(120)
  const [metronomeVolume, setMetronomeVolume] = useState(0.18)
  const [beatsPerBar, setBeatsPerBar] = useState(4)
  const [metronomePlaying, setMetronomePlaying] = useState(false)
  const metronomeContextRef = useRef(null)
  const metronomeIntervalRef = useRef(null)
  const beatRef = useRef(0)
  const metronomeWasPlayingRef = useRef(false)
  const metronomePlayingRef = useRef(metronomePlaying)
  const metronomeBpmRef = useRef(metronomeBpm)
  const metronomeVolumeRef = useRef(metronomeVolume)
  const beatsPerBarRef = useRef(beatsPerBar)

  const [tapTimes, setTapTimes] = useState([])

  const [instrument, setInstrument] = useState('bass')
  const [tunerMode, setTunerMode] = useState('tone')
  const [tunerActive, setTunerActive] = useState(false)
  const [tunerState, setTunerState] = useState({
    status: 'Select a string to hear a reference tone',
    frequency: null,
    note: null,
    cents: null,
    clarity: null,
  })
  const tunerContextRef = useRef(null)
  const analyserRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const tunerFrameRef = useRef(null)
  const tunerToneNodesRef = useRef(null)
  const [earReference, setEarReference] = useState(null)

  const [speakerPlaying, setSpeakerPlaying] = useState(false)
  const [speakerFrequency, setSpeakerFrequency] = useState(440)
  const [speakerVolume, setSpeakerVolume] = useState(0.08)
  const [speakerPan, setSpeakerPan] = useState(0)
  const [speakerStatus, setSpeakerStatus] = useState('')
  const speakerContextRef = useRef(null)
  const speakerNodesRef = useRef(null)

  const targetStrings = STRING_SETS[instrument]

  const tapBpm = useMemo(() => getTapBpm(tapTimes), [tapTimes])

  const speakerWarning = useMemo(() => {
    if (speakerFrequency < 40) {
      return {
        level: 'danger',
        title: 'Low-frequency warning',
        text: 'Very low frequencies can stress speakers even when they are barely audible. Start at very low volume.',
      }
    }
    if (speakerFrequency > 12000) {
      return {
        level: 'danger',
        title: 'High-frequency warning',
        text: 'Very high frequencies may be hard to hear but can still be uncomfortable or harmful to young ears and animals.',
      }
    }
    return {
      level: 'notice',
      title: 'Level check',
      text: 'Keep volume low while testing channels and sweep frequencies slowly.',
    }
  }, [speakerFrequency])

  function clearMetronome() {
    if (metronomeIntervalRef.current) {
      window.clearTimeout(metronomeIntervalRef.current)
      metronomeIntervalRef.current = null
    }
  }

  const startMetronome = useEffectEvent(async (fireImmediately = false) => {
    clearMetronome()

    const context = metronomeContextRef.current ?? new AudioContext()
    metronomeContextRef.current = context
    await context.resume()

    if (fireImmediately) {
      beatRef.current = 0
      playMetronomeClick(context, metronomeVolumeRef.current, true)
    }
    const queueNextBeat = () => {
      const intervalMs = 60000 / metronomeBpmRef.current

      metronomeIntervalRef.current = window.setTimeout(() => {
        metronomeIntervalRef.current = null
        if (!metronomePlayingRef.current) {
          return
        }

        beatRef.current += 1
        const currentBeat = (beatRef.current % beatsPerBarRef.current) + 1
        const accented = currentBeat === 1
        playMetronomeClick(context, metronomeVolumeRef.current, accented)
        queueNextBeat()
      }, intervalMs)
    }

    if (!fireImmediately) {
      beatRef.current += 1
      const currentBeat = (beatRef.current % beatsPerBarRef.current) + 1
      const accented = currentBeat === 1
      playMetronomeClick(context, metronomeVolumeRef.current, accented)
    }

    queueNextBeat()
  })

  function handleTap() {
    const now = Date.now()

    setTapTimes((previous) => {
      const lastTap = previous.at(-1)
      const next = !lastTap || now - lastTap > 2000 ? [now] : [...previous, now].slice(-8)
      if (next.length === 1) {
        setMetronomeBpm(120)
      } else {
        setMetronomeBpm(getTapBpm(next))
      }
      return next
    })
  }

  async function toggleTuner() {
    if (tunerMode !== 'mic') {
      return
    }

    if (tunerActive) {
      stopTuner()
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })

      const context = tunerContextRef.current ?? new AudioContext()
      tunerContextRef.current = context
      await context.resume()

      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.1

      source.connect(analyser)

      mediaStreamRef.current = stream
      analyserRef.current = analyser
      setTunerActive(true)
      setTunerState({
        status: 'Listening',
        frequency: null,
        note: null,
        cents: null,
        clarity: null,
      })

      const buffer = new Float32Array(analyser.fftSize)
      const updatePitch = () => {
        if (!analyserRef.current) {
          return
        }

        analyserRef.current.getFloatTimeDomainData(buffer)
        const result = detectPitch(buffer, context.sampleRate)

        if (!result) {
          setTunerState((previous) => ({
            ...previous,
            status: 'Listening for a stable pitch',
            frequency: null,
            note: null,
            cents: null,
            clarity: null,
          }))
        } else {
          const note = frequencyToNote(result.frequency)
          setTunerState({
            status: result.clarity > 0.92 ? 'Stable pitch' : 'Pitch detected',
            frequency: result.frequency,
            note: note.name,
            cents: note.cents,
            clarity: result.clarity,
          })
        }

        tunerFrameRef.current = window.requestAnimationFrame(updatePitch)
      }

      tunerFrameRef.current = window.requestAnimationFrame(updatePitch)
    } catch {
      setTunerState({
        status: 'Microphone access was denied or unavailable.',
        frequency: null,
        note: null,
        cents: null,
        clarity: null,
      })
    }
  }

  function stopTuner() {
    if (tunerFrameRef.current) {
      window.cancelAnimationFrame(tunerFrameRef.current)
      tunerFrameRef.current = null
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    analyserRef.current = null
    setTunerActive(false)
    setTunerState({
      status: tunerMode === 'mic' ? 'Mic stopped' : 'Reference tone stopped',
      frequency: null,
      note: null,
      cents: null,
      clarity: null,
    })
  }

  async function toggleEarReference(item) {
    if (tunerMode !== 'tone') {
      return
    }

    if (earReference?.note === item.note) {
      stopEarReference()
      return
    }

    stopEarReference()

    try {
      const context = tunerContextRef.current ?? new AudioContext()
      tunerContextRef.current = context
      await context.resume()

      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const filter = context.createBiquadFilter()
      const output = context.createGain()
      const toneProfile = getReferenceToneProfile(item, instrument)

      oscillator.setPeriodicWave(createHarmonicWave(context, toneProfile.harmonics))
      oscillator.frequency.value = item.frequency
      filter.type = 'lowpass'
      filter.frequency.value = toneProfile.filterFrequency
      filter.Q.value = toneProfile.filterQ
      gain.gain.value = toneProfile.filterGain
      output.gain.setValueAtTime(0.0001, context.currentTime)
      output.gain.exponentialRampToValueAtTime(toneProfile.outputGain, context.currentTime + 0.04)

      oscillator.connect(filter)
      filter.connect(gain)
      gain.connect(output)
      output.connect(context.destination)
      oscillator.start()

      tunerToneNodesRef.current = { oscillator, gain, filter, output }
      setEarReference(item)
      setTunerState({
        status: 'Reference tone playing',
        frequency: item.frequency,
        note: item.note,
        cents: 0,
        clarity: null,
      })
    } catch {
      setTunerState({
        status: 'Could not start the reference tone in this browser.',
        frequency: null,
        note: null,
        cents: null,
        clarity: null,
      })
    }
  }

  function stopEarReference() {
    if (tunerToneNodesRef.current) {
      tunerToneNodesRef.current.oscillator.stop()
      tunerToneNodesRef.current.oscillator.disconnect()
      tunerToneNodesRef.current.gain.disconnect()
      tunerToneNodesRef.current.filter?.disconnect()
      tunerToneNodesRef.current.output?.disconnect()
      tunerToneNodesRef.current = null
    }

    setEarReference(null)
    if (tunerMode === 'tone') {
      setTunerState({
        status: 'Reference tone stopped',
        frequency: null,
        note: null,
        cents: null,
        clarity: null,
      })
    }
  }

  function handleTunerModeChange(nextMode) {
    stopTuner()
    stopEarReference()
    setTunerMode(nextMode)
    setTunerState({
      status: nextMode === 'mic' ? 'Mic ready' : 'Select a string to hear a reference tone',
      frequency: null,
      note: null,
      cents: null,
      clarity: null,
    })
  }

  async function toggleSpeaker() {
    if (speakerPlaying) {
      stopSpeaker()
      return
    }

    try {
      const context = speakerContextRef.current ?? new AudioContext()
      speakerContextRef.current = context
      await context.resume()

      const oscillator = context.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.value = speakerFrequency

      const gain = context.createGain()
      gain.gain.value = speakerVolume

      if (typeof context.createStereoPanner === 'function') {
        const panner = context.createStereoPanner()
        panner.pan.value = speakerPan
        oscillator.connect(gain)
        gain.connect(panner)
        panner.connect(context.destination)
        speakerNodesRef.current = { oscillator, gain, panner }
      } else {
        oscillator.connect(gain)
        gain.connect(context.destination)
        speakerNodesRef.current = { oscillator, gain, panner: null }
      }

      oscillator.start()
      setSpeakerPlaying(true)
      setSpeakerStatus('Tone is playing. Keep volume low before sweeping frequencies.')
    } catch {
      setSpeakerStatus('Could not start audio output in this browser.')
    }
  }

  function stopSpeaker() {
    if (speakerNodesRef.current) {
      speakerNodesRef.current.oscillator.stop()
      speakerNodesRef.current.oscillator.disconnect()
      speakerNodesRef.current.gain.disconnect()
      speakerNodesRef.current.panner?.disconnect()
      speakerNodesRef.current = null
    }

    setSpeakerPlaying(false)
    setSpeakerStatus('')
  }

  useEffect(() => {
    metronomePlayingRef.current = metronomePlaying
  }, [metronomePlaying])

  useEffect(() => {
    metronomeBpmRef.current = metronomeBpm
  }, [metronomeBpm])

  useEffect(() => {
    metronomeVolumeRef.current = metronomeVolume
  }, [metronomeVolume])

  useEffect(() => {
    beatsPerBarRef.current = beatsPerBar
  }, [beatsPerBar])

  useEffect(() => {
    if (!metronomePlaying) {
      clearMetronome()
      metronomeWasPlayingRef.current = false
      return undefined
    }

    const fireImmediately = !metronomeWasPlayingRef.current
    metronomeWasPlayingRef.current = true
    void startMetronome(fireImmediately)

    return () => {
      clearMetronome()
    }
  }, [metronomePlaying])

  useEffect(() => {
    return () => {
      clearMetronome()
      if (tunerFrameRef.current) {
        window.cancelAnimationFrame(tunerFrameRef.current)
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      }
      if (tunerToneNodesRef.current) {
        tunerToneNodesRef.current.oscillator.stop()
        tunerToneNodesRef.current.oscillator.disconnect()
        tunerToneNodesRef.current.gain.disconnect()
        tunerToneNodesRef.current.filter?.disconnect()
        tunerToneNodesRef.current.output?.disconnect()
      }
      if (speakerNodesRef.current) {
        speakerNodesRef.current.oscillator.stop()
        speakerNodesRef.current.oscillator.disconnect()
        speakerNodesRef.current.gain.disconnect()
        speakerNodesRef.current.panner?.disconnect()
      }
    }
  }, [])

  useEffect(() => {
    if (!speakerNodesRef.current) {
      return
    }

    const { oscillator, gain, panner } = speakerNodesRef.current
    oscillator.frequency.setValueAtTime(speakerFrequency, speakerContextRef.current.currentTime)
    gain.gain.setValueAtTime(speakerVolume, speakerContextRef.current.currentTime)
    if (panner) {
      panner.pan.setValueAtTime(speakerPan, speakerContextRef.current.currentTime)
    }
  }, [speakerFrequency, speakerVolume, speakerPan])

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Music Toolbox</p>
          <h1>Practice, tune, and test your setup from one page.</h1>
          <p className="lede">
            Metronome, tap tempo, tuner for guitar and bass, plus a speaker check for
            channel testing and frequency checks.
          </p>
        </div>
        <div className="hero-warning">
          <p className="warning-label">Safety</p>
          <p>
            Extreme low and high frequencies may be hard to hear but can still strain
            speakers or bother animals and young ears. Start quietly.
          </p>
        </div>
      </section>

      <section className="grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="kicker">Metronome</p>
              <h2>{metronomeBpm} BPM</h2>
            </div>
            <button className="primary" type="button" onClick={() => setMetronomePlaying((value) => !value)}>
              {metronomePlaying ? 'Stop' : 'Start'}
            </button>
          </div>
          <label>
            Tempo
            <input
              type="range"
              min="40"
              max="240"
              value={metronomeBpm}
              onChange={(event) => setMetronomeBpm(Number(event.target.value))}
            />
          </label>
          <label>
            Click volume
            <input
              type="range"
              min="0.02"
              max="0.4"
              step="0.01"
              value={metronomeVolume}
              onChange={(event) => setMetronomeVolume(Number(event.target.value))}
            />
          </label>
          <label>
            Bar length
            <select value={beatsPerBar} onChange={(event) => setBeatsPerBar(Number(event.target.value))}>
              {Array.from({ length: 11 }, (_, index) => index + 2).map((beats) => (
                <option key={beats} value={beats}>
                  {beats} beats
                </option>
              ))}
            </select>
          </label>
          <p className="hint">Sets how many beats pass before the accent repeats, from 2 to 12.</p>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="kicker">Tap Tempo</p>
              <h2>{tapBpm ? `${tapBpm} BPM` : 'Tap to measure'}</h2>
            </div>
            <button className="secondary" type="button" onClick={() => setTapTimes([])}>
              Reset
            </button>
          </div>
          <button className="tap-pad" type="button" onClick={handleTap}>
            Tap
          </button>
          <p className="hint">Tap at least twice. The metronome follows your measured tempo automatically.</p>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="kicker">Online Tuner</p>
              <h2>{instrument === 'guitar' ? 'Guitar' : 'Bass'}</h2>
            </div>
            {tunerMode === 'mic' ? (
              <button className="primary" type="button" onClick={toggleTuner}>
                {tunerActive ? 'Stop mic' : 'Start mic'}
              </button>
            ) : (
              <button className="primary" type="button" onClick={stopEarReference}>
                Stop tone
              </button>
            )}
          </div>
          <div className="segmented segmented-two">
            <button
              className={tunerMode === 'mic' ? 'segment active' : 'segment'}
              type="button"
              onClick={() => handleTunerModeChange('mic')}
            >
              Mic
            </button>
            <button
              className={tunerMode === 'tone' ? 'segment active' : 'segment'}
              type="button"
              onClick={() => handleTunerModeChange('tone')}
            >
              By ear
            </button>
          </div>
          <div className="segmented">
            <button
              className={instrument === 'guitar' ? 'segment active' : 'segment'}
              type="button"
              onClick={() => setInstrument('guitar')}
            >
              Guitar
            </button>
            <button
              className={instrument === 'bass' ? 'segment active' : 'segment'}
              type="button"
              onClick={() => setInstrument('bass')}
            >
              Bass
            </button>
          </div>
          <div className="tuner-readout">
            <p className="status">{tunerState.status}</p>
            <div className="note-line">
              <span className="note">{tunerState.note ?? '--'}</span>
              <span className={tunerState.cents === null ? 'cents' : `cents ${Math.abs(tunerState.cents) <= 5 ? 'in-tune' : ''}`}>
                {tunerState.cents === null ? 'waiting' : `${tunerState.cents > 0 ? '+' : ''}${tunerState.cents} cents`}
              </span>
            </div>
            <p className="frequency">
              {tunerState.frequency
                ? `${tunerState.frequency.toFixed(2)} Hz`
                : tunerMode === 'mic'
                  ? 'Play one note at a time near the microphone.'
                  : 'Tap a string below to hear a richer instrument-style reference tone.'}
            </p>
          </div>
          <div className="string-grid">
            {targetStrings.map((item) => (
              <button
                key={item.note}
                className={earReference?.note === item.note ? 'string-card string-card-active' : 'string-card'}
                type="button"
                onClick={() => void toggleEarReference(item)}
              >
                <strong>{item.note}</strong>
                <span>{item.frequency.toFixed(2)} Hz</span>
              </button>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="kicker">Speaker Check</p>
              <h2>{speakerFrequency} Hz</h2>
            </div>
            <button className="primary danger" type="button" onClick={toggleSpeaker}>
              {speakerPlaying ? 'Stop tone' : 'Play tone'}
            </button>
          </div>
          <label>
            Frequency
            <input
              type="range"
              min="20"
              max="16000"
              step="1"
              value={speakerFrequency}
              onChange={(event) => setSpeakerFrequency(Number(event.target.value))}
            />
          </label>
          <label>
            Manual Hz input
            <input
              className="number-input"
              type="number"
              min="20"
              max="16000"
              step="1"
              value={speakerFrequency}
              onChange={(event) => {
                const nextValue = Number(event.target.value)
                if (Number.isNaN(nextValue)) {
                  return
                }
                setSpeakerFrequency(Math.min(16000, Math.max(20, nextValue)))
              }}
            />
          </label>
          <div className="triple-stats">
            <span>20 Hz</span>
            <span>1 kHz</span>
            <span>16 kHz</span>
          </div>
          <label>
            Output level
            <input
              type="range"
              min="0.01"
              max="0.2"
              step="0.01"
              value={speakerVolume}
              onChange={(event) => setSpeakerVolume(Number(event.target.value))}
            />
          </label>
          <div className="segmented">
            <button
              className={speakerPan === -1 ? 'segment active' : 'segment'}
              type="button"
              onClick={() => setSpeakerPan(-1)}
            >
              Left
            </button>
            <button
              className={speakerPan === 0 ? 'segment active' : 'segment'}
              type="button"
              onClick={() => setSpeakerPan(0)}
            >
              Center
            </button>
            <button
              className={speakerPan === 1 ? 'segment active' : 'segment'}
              type="button"
              onClick={() => setSpeakerPan(1)}
            >
              Right
            </button>
          </div>
          <div className={`warning-box warning-box-${speakerWarning.level}`}>
            <strong>{speakerWarning.title}</strong>
            <p>{speakerWarning.text}</p>
          </div>
          {speakerStatus ? <p className="hint">{speakerStatus}</p> : null}
        </article>
      </section>
    </main>
  )
}

function getTapBpm(tapTimes) {
  if (tapTimes.length < 2) {
    return null
  }

  const intervals = []
  for (let index = 1; index < tapTimes.length; index += 1) {
    intervals.push(tapTimes[index] - tapTimes[index - 1])
  }

  const averageInterval = intervals.reduce((sum, value) => sum + value, 0) / intervals.length
  return Math.round(60000 / averageInterval)
}

function createHarmonicWave(context, harmonics) {
  const real = new Float32Array(harmonics.length)
  const imag = new Float32Array(harmonics.length)

  for (let index = 1; index < harmonics.length; index += 1) {
    imag[index] = harmonics[index]
  }

  return context.createPeriodicWave(real, imag)
}

function getReferenceToneProfile(item, instrument) {
  if (instrument === 'bass') {
    if (item.note === 'E1') {
      return {
        harmonics: [0, 1, 0.62, 0.34, 0.2, 0.12, 0.08, 0.04],
        filterFrequency: 2100,
        filterQ: 0.6,
        filterGain: 0.9,
        outputGain: 0.095,
      }
    }

    return {
      harmonics: [0, 1, 0.55, 0.26, 0.13, 0.08, 0.04],
      filterFrequency: 1700,
      filterQ: 0.7,
      filterGain: 0.92,
      outputGain: 0.088,
    }
  }

  if (item.note === 'E4') {
    return {
      harmonics: [0, 1, 0.38, 0.16, 0.08, 0.03],
      filterFrequency: 1550,
      filterQ: 0.75,
      filterGain: 0.78,
      outputGain: 0.078,
    }
  }

  return {
    harmonics: [0, 1, 0.52, 0.24, 0.11, 0.06, 0.03],
    filterFrequency: 1900,
    filterQ: 0.72,
    filterGain: 0.82,
    outputGain: 0.082,
  }
}

function playMetronomeClick(context, volume, accented) {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const now = context.currentTime

  oscillator.type = accented ? 'square' : 'triangle'
  oscillator.frequency.setValueAtTime(accented ? 1400 : 980, now)
  gain.gain.setValueAtTime(volume, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045)

  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.05)
}

function frequencyToNote(frequency) {
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440))
  const exactMidi = 69 + 12 * Math.log2(frequency / 440)
  const cents = Math.round((exactMidi - midi) * 100)
  const noteName = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1

  return {
    name: `${noteName}${octave}`,
    cents,
  }
}

function detectPitch(buffer, sampleRate) {
  let rms = 0
  for (let index = 0; index < buffer.length; index += 1) {
    const value = buffer[index]
    rms += value * value
  }

  rms = Math.sqrt(rms / buffer.length)
  if (rms < 0.01) {
    return null
  }

  let bestOffset = -1
  let bestCorrelation = 0
  let previousCorrelation = 1
  const minSamples = Math.floor(sampleRate / 1200)
  const maxSamples = Math.floor(sampleRate / 40)

  for (let offset = minSamples; offset <= maxSamples; offset += 1) {
    let correlation = 0

    for (let index = 0; index < buffer.length - offset; index += 1) {
      correlation += Math.abs(buffer[index] - buffer[index + offset])
    }

    correlation = 1 - correlation / (buffer.length - offset)

    if (correlation > 0.9 && correlation > previousCorrelation) {
      bestCorrelation = correlation
      bestOffset = offset
    } else if (bestOffset !== -1 && correlation < previousCorrelation) {
      const frequency = sampleRate / bestOffset
      return { frequency, clarity: bestCorrelation }
    }

    previousCorrelation = correlation
  }

  if (bestOffset === -1) {
    return null
  }

  return {
    frequency: sampleRate / bestOffset,
    clarity: bestCorrelation,
  }
}

export default App
