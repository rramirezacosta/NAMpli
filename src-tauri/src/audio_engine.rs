use crate::eq::EqChain;
use crate::ir::CabinetIr;
use crate::model_manager::{GainLevel, ModelManager, Sensitivity};
use crate::tuner::Tuner;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, SupportedStreamConfig, SupportedStreamConfigRange};
use parking_lot::Mutex;
use ringbuf::traits::{Consumer, Observer, Producer, Split};
use ringbuf::HeapRb;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Largest chunk the DSP thread processes in one go. Kept modest so a backlog
/// can never push a large burst into the output ring (which would add latency
/// beyond the configured buffer size).
const MAX_BLOCK: usize = 256;
/// Never run the pipeline with less than ~1.3ms of buffered audio. 64 samples is
/// very aggressive and may xrun on slower machines or busy systems; the UI keeps
/// 128 as the recommended low-latency floor.
const MIN_LATENCY_FRAMES: usize = 64;
/// Upper bound for the latency setting (~171ms at 48kHz).
const MAX_LATENCY_FRAMES: usize = 8192;
/// Equal-power crossfade length used when the user changes gain/sensitivity.
const MODEL_CROSSFADE_MS: f32 = 20.0;

/// Errors and counters that the UI can display. The stream error callbacks run
/// on the audio thread, so they only use atomics and `try_lock`.
pub struct AudioHealth {
    xruns: AtomicU64,
    last_error: Mutex<Option<String>>,
}

impl AudioHealth {
    fn new() -> Self {
        AudioHealth {
            xruns: AtomicU64::new(0),
            last_error: Mutex::new(None),
        }
    }

    fn reset(&self) {
        self.xruns.store(0, Ordering::Relaxed);
        *self.last_error.lock() = None;
    }

    /// Record a device/stream error. Never blocks the audio thread.
    fn record(&self, message: String) {
        self.xruns.fetch_add(1, Ordering::Relaxed);
        if let Some(mut slot) = self.last_error.try_lock() {
            *slot = Some(message);
        }
    }

    fn xruns(&self) -> u64 {
        self.xruns.load(Ordering::Relaxed)
    }

    fn last_error(&self) -> Option<String> {
        self.last_error.lock().clone()
    }
}

/// Snapshot returned by `get_audio_status`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    pub powered: bool,
    pub sample_rate: u32,
    pub latency_frames: usize,
    pub xruns: u64,
    pub last_error: Option<String>,
    pub ir_name: Option<String>,
    pub nam_model: Option<String>,
}

/// Shared state between UI thread and audio thread
pub struct SharedState {
    pub sensitivity: Sensitivity,
    pub gain_level: GainLevel,
    pub bass: f32,
    pub middle: f32,
    pub treble: f32,
    /// Power-amp presence, 0..1 (0.5 = neutral).
    pub presence: f32,
    /// Input trim before the model, 0..1 (0.5 = unity, +/-12dB).
    pub preamp: f32,
    pub master_volume: f32,
    pub buffer_size: usize, // in samples, default ~21ms at 48kHz
    pub powered: bool,
    pub sample_rate: u32,
    /// Noise gate settings. Disabled by default so quiet playing is untouched.
    pub gate_enabled: bool,
    pub gate_threshold_db: f32,
    pub gate_decay_ms: f32,
    /// Dry/wet blend for the cabinet IR, 0..1.
    pub ir_mix: f32,
    /// Latest tuner result; `tuner_hz == 0.0` means "no pitch".
    pub tuner_hz: f32,
    pub tuner_level_db: f32,
}

impl SharedState {
    pub fn new() -> Self {
        SharedState {
            sensitivity: Sensitivity::High,
            gain_level: GainLevel::new(1),
            // The NAM captures already include the amp's tone stack at
            // P6 B8 M4 T7, so these are *additional* shaping filters and should
            // start neutral (0 dB) rather than doubling the captured EQ.
            bass: 0.5,
            middle: 0.5,
            treble: 0.5,
            presence: 0.5,
            preamp: 0.5,
            master_volume: 0.5,
            // Actual output latency of the DSP pipeline. One small device period by
            // default so playing feels responsive; the input/output rings are sized
            // from this and it is user-adjustable in Settings.
            buffer_size: 256,
            powered: false,
            sample_rate: 48000,
            gate_enabled: false,
            gate_threshold_db: -60.0,
            gate_decay_ms: 120.0,
            ir_mix: 1.0,
            tuner_hz: 0.0,
            tuner_level_db: -120.0,
        }
    }
}

/// Audio engine that manages cpal streams and audio processing
pub struct AudioEngine {
    pub state: Arc<Mutex<SharedState>>,
    model_manager: Arc<Mutex<ModelManager>>,
    input_stream: Option<cpal::Stream>,
    output_stream: Option<cpal::Stream>,
    worker: Option<std::thread::JoinHandle<()>>,
    worker_stop: Option<Arc<AtomicBool>>,
    pending_input_device: Option<String>,
    pending_output_device: Option<String>,
    /// Selected cpal host name (e.g. "alsa", "jack"). `None` means the
    /// platform default host.
    host: Option<String>,
    /// Resolved cpal IDs of the devices the running streams actually use.
    /// Compared against UI requests so re-selecting the same device does not
    /// needlessly restart audio (which would click/drop out).
    active_input_device: Option<String>,
    active_output_device: Option<String>,
    health: Arc<AudioHealth>,
    ir: Arc<Mutex<Option<CabinetIr>>>,
}

impl AudioEngine {
    pub fn new(model_manager: ModelManager) -> Self {
        AudioEngine {
            state: Arc::new(Mutex::new(SharedState::new())),
            model_manager: Arc::new(Mutex::new(model_manager)),
            input_stream: None,
            output_stream: None,
            worker: None,
            worker_stop: None,
            pending_input_device: None,
            pending_output_device: None,
            host: None,
            active_input_device: None,
            active_output_device: None,
            health: Arc::new(AudioHealth::new()),
            ir: Arc::new(Mutex::new(None)),
        }
    }

    /// Remember which devices the UI selected. If audio is already running the
    /// streams are restarted so the change takes effect immediately — but only
    /// when the selection actually differs from what is running, otherwise
    /// merely opening the settings panel would click/drop the audio.
    pub fn set_devices(
        &mut self,
        input_device_name: Option<String>,
        output_device_name: Option<String>,
    ) -> Result<(), String> {
        let unchanged = match (&input_device_name, &output_device_name) {
            (Some(input), Some(output)) => {
                Some(input) == self.active_input_device.as_ref()
                    && Some(output) == self.active_output_device.as_ref()
            }
            // A `None` request means "fall back to the default", which may well
            // be a real change, so do not skip the restart for it.
            _ => false,
        };

        self.pending_input_device = input_device_name.clone();
        self.pending_output_device = output_device_name.clone();

        if self.is_powered() && !unchanged {
            self.start(input_device_name, output_device_name)?;
        }
        Ok(())
    }

    /// Select which cpal host (ALSA, JACK, ...) to use. Takes effect on the next
    /// stream start; restarts audio immediately when it is already running.
    pub fn set_host(&mut self, host: Option<String>) -> Result<(), String> {
        self.host = host;
        if self.is_powered() {
            self.start(None, None)?;
        }
        Ok(())
    }

    pub fn start(
        &mut self,
        input_device_name: Option<String>,
        output_device_name: Option<String>,
    ) -> Result<(), String> {
        // Stop any previous streams so the engine can be restarted safely.
        self.stop();

        let cpal_host = match self.host.as_deref() {
            Some(name) => {
                let id: cpal::HostId = name
                    .parse()
                    .map_err(|e| format!("Unknown audio host '{}': {}", name, e))?;
                cpal::host_from_id(id)
                    .map_err(|e| format!("Audio host '{}' unavailable: {}", name, e))?
            }
            None => cpal::default_host(),
        };

        // Explicit arguments win; otherwise use whatever the settings panel last
        // selected, then fall back to the system default device.
        let input_name = input_device_name
            .clone()
            .or_else(|| self.pending_input_device.clone());
        let output_name = output_device_name
            .clone()
            .or_else(|| self.pending_output_device.clone());

        let input_device = find_input_device(&cpal_host, input_name.as_deref())
            .ok_or_else(|| "No input device found".to_string())?;
        let output_device = find_output_device(&cpal_host, output_name.as_deref())
            .ok_or_else(|| "No output device found".to_string())?;

        // Stable IDs of the devices we end up opening, so the UI can tell whether
        // its selection really changed.
        let input_device_id = input_device.id().ok().map(|id| id.to_string());
        let output_device_id = output_device.id().ok().map(|id| id.to_string());

        let input_name = input_device
            .description()
            .map(|d| d.name().to_string())
            .unwrap_or_default();
        let output_name = output_device
            .description()
            .map(|d| d.name().to_string())
            .unwrap_or_default();
        log::info!("Using input device: {}", input_name);
        log::info!("Using output device: {}", output_name);

        // NAM models are captured at a fixed sample rate. Prefer that rate for both
        // devices so we never feed the model the wrong rate (which changes pitch/tone).
        let expected_sample_rate = {
            let mm = self.model_manager.lock();
            mm.current_expected_sample_rate()
        };

        // Latency target for the DSP pipeline. Running the NAM model on a dedicated
        // thread means a slow block can never make the ALSA output callback miss its
        // deadline. This many samples of silence are queued up front to absorb
        // scheduling jitter and model switches.
        let latency_frames = {
            let state = self.state.lock();
            state
                .buffer_size
                .clamp(MIN_LATENCY_FRAMES, MAX_LATENCY_FRAMES)
        };

        let output_config = pick_output_config(&output_device, expected_sample_rate)?;
        let input_config = pick_input_config(&input_device, output_config.sample_rate())?;

        // Request a small device period. `SupportedStreamConfig::config()` leaves
        // `buffer_size` at `Default`, which lets ALSA/PipeWire pick something big
        // (its configured quantum is 1024 frames ≈ 21ms). The UI latency setting
        // only sizes our internal ring, so without this the *device* buffers
        // dominate end-to-end latency. cpal's ALSA backend treats `Fixed(n)` as one
        // period with 2-period buffering, and asking for a small period also makes
        // PipeWire lower its graph quantum to match.
        let target_period = latency_frames.clamp(64, 256) as u32;
        let output_stream_config = stream_config(&output_config, target_period, "output");
        let input_stream_config = stream_config(&input_config, target_period, "input");

        let input_channels = input_config.channels() as usize;
        let output_channels = output_config.channels() as usize;
        let input_sample_rate = input_config.sample_rate();
        let output_sample_rate = output_config.sample_rate();

        log::info!(
            "Input: {}Hz, {} channels ({:?})",
            input_sample_rate,
            input_channels,
            input_config.sample_format()
        );
        log::info!(
            "Output: {}Hz, {} channels ({:?})",
            output_sample_rate,
            output_channels,
            output_config.sample_format()
        );

        if input_sample_rate != output_sample_rate {
            return Err(format!(
                "Input device runs at {}Hz but output runs at {}Hz. \
                 Select devices that share a sample rate (preferably {}Hz).",
                input_sample_rate, output_sample_rate, expected_sample_rate
            ));
        }

        if output_sample_rate != expected_sample_rate {
            log::warn!(
                "Sample rate mismatch: device={}Hz, model expects={}Hz. Audio pitch/tone will be wrong.",
                output_sample_rate,
                expected_sample_rate
            );
        } else {
            log::info!(
                "Sample rate matches model expectations: {}Hz",
                output_sample_rate
            );
        }

        // Store sample rate for DSP (DC blocker / EQ) and reset per-run health.
        {
            let mut state = self.state.lock();
            state.sample_rate = output_sample_rate;
            state.tuner_hz = 0.0;
            state.tuner_level_db = -120.0;
        }
        self.health.reset();
        {
            let mut mm = self.model_manager.lock();
            mm.clear_fade();
        }
        // The cabinet IR may have been loaded at a different rate.
        {
            let mut ir = self.ir.lock();
            if let Some(cab) = ir.as_mut() {
                cab.prepare(output_sample_rate);
            }
        }

        // Extra room so the input callback never blocks waiting for the DSP thread.
        let ring_capacity = latency_frames + MAX_BLOCK * 2;
        let (mut raw_producer, mut raw_consumer) =
            HeapRb::<f32>::new(ring_capacity).split();
        let (mut out_producer, mut out_consumer) =
            HeapRb::<f32>::new(ring_capacity).split();

        // Pre-fill with silence: the first output callback always has samples ready,
        // and the pipeline runs at a fixed, predictable latency from the start.
        for _ in 0..latency_frames {
            let _ = out_producer.try_push(0.0);
        }

        log::info!(
            "DSP latency: {} samples (~{:.1}ms), rings: {} samples",
            latency_frames,
            latency_frames as f32 * 1000.0 / output_sample_rate as f32,
            ring_capacity
        );

        let model_manager = Arc::clone(&self.model_manager);
        let state = Arc::clone(&self.state);
        let ir = Arc::clone(&self.ir);
        let sample_rate = output_sample_rate as f32;

        // Input callback: take the first channel (mono guitar input) and push it to
        // the raw ring buffer. This callback must stay allocation- and lock-free.
        let input_callback = move |data: &[f32], _: &cpal::InputCallbackInfo| {
            let frames = data.len() / input_channels;
            for frame in 0..frames {
                let sample = data[frame * input_channels];
                // If the ring is full the DSP thread has fallen behind; dropping a
                // sample is better than letting latency grow without bound.
                let _ = raw_producer.try_push(sample);
            }
        };

        // DSP worker: input trim + gate, NAM inference, cabinet IR, tone stack and
        // gain staging, completely off the audio callback. The output callback
        // only copies pre-rendered samples.
        let worker_stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&worker_stop);
        let worker = std::thread::Builder::new()
            .name("nam-dsp".to_string())
            .spawn(move || {
                // Pre-allocate to avoid heap allocations on the DSP thread.
                let mut buffer = vec![0.0_f32; MAX_BLOCK];
                let mut scratch = vec![0.0_f32; MAX_BLOCK];
                let mut eq = EqChain::new(sample_rate);
                let mut eq_bass = f32::NAN;
                let mut eq_middle = f32::NAN;
                let mut eq_treble = f32::NAN;
                let mut eq_presence = f32::NAN;
                // DC/sub-bass blocker at the output stage. A one-pole high-pass at
                // 65Hz removes DC offsets, string-handling rumble and IR low-end
                // drift before the limiter without thinning the guitar's low E.
                let mut dc_avg = 0.0_f32;
                let alpha =
                    (-2.0_f32 * std::f32::consts::PI * 65.0 / sample_rate).exp();
                // Master gain is smoothed per sample (~5ms) so turning the knob or
                // switching gain models never produces zipper noise or clicks.
                let smooth_coeff = (-1.0_f32 / (0.005 * sample_rate)).exp();
                let mut gain = f32::NAN;
                // Input trim + noise gate state.
                let mut trim = 1.0_f32;
                let mut gate_env = 0.0_f32;
                let mut gate_gain = 1.0_f32;
                let mut tuner = Tuner::new(sample_rate);

                while !stop_flag.load(Ordering::Relaxed) {
                    if raw_consumer.occupied_len() == 0 {
                        // The input callback is driven by the audio device, so a short
                        // sleep is cheaper than spinning.
                        std::thread::sleep(Duration::from_micros(100));
                        continue;
                    }

                    let want = raw_consumer.occupied_len().min(MAX_BLOCK);
                    let got = raw_consumer.pop_slice(&mut buffer[..want]);
                    if got == 0 {
                        continue;
                    }

                    // Snapshot UI-controlled parameters once per block.
                    let (
                        master_volume,
                        bass,
                        middle,
                        treble,
                        presence,
                        preamp,
                        gate_enabled,
                        gate_threshold_db,
                        gate_decay_ms,
                        ir_mix,
                    ) = {
                        let s = state.lock();
                        (
                            s.master_volume,
                            s.bass,
                            s.middle,
                            s.treble,
                            s.presence,
                            s.preamp,
                            s.gate_enabled,
                            s.gate_threshold_db,
                            s.gate_decay_ms,
                            s.ir_mix,
                        )
                    };

                    // Tuner sees the raw input, before trim/gate, so it still works
                    // while the gate is closed or the pickup is quiet.
                    if let Some(reading) = tuner.push(&buffer[..got]) {
                        let mut s = state.lock();
                        s.tuner_hz = reading.hz;
                        s.tuner_level_db = reading.level_db;
                    }

                    // Input trim (0..1 -> -12..+12dB) and noise gate. The gate uses
                    // a fast peak envelope and an asymmetric attack/release so it
                    // opens instantly and fades out over the configured decay.
                    let trim_target = 10.0_f32.powf((preamp - 0.5) * 24.0 / 20.0);
                    let gate_threshold = 10.0_f32.powf(gate_threshold_db / 20.0);
                    let env_coeff = (-1.0_f32 / (0.002 * sample_rate)).exp();
                    let attack_coeff = (-1.0_f32 / (0.001 * sample_rate)).exp();
                    let release_coeff =
                        (-1.0_f32 / (gate_decay_ms.max(10.0) * 0.001 * sample_rate)).exp();

                    for sample in &mut buffer[..got] {
                        trim = smooth_coeff * trim + (1.0 - smooth_coeff) * trim_target;
                        let mut x = *sample * trim;
                        // Track the envelope even while the gate is disabled so
                        // enabling it mid-note does not duck for a few
                        // milliseconds while the envelope catches up.
                        gate_env = env_coeff * gate_env + (1.0 - env_coeff) * x.abs();
                        if gate_enabled {
                            let target = if gate_env > gate_threshold { 1.0 } else { 0.0 };
                            let coeff = if target > gate_gain {
                                attack_coeff
                            } else {
                                release_coeff
                            };
                            gate_gain = coeff * gate_gain + (1.0 - coeff) * target;
                        } else if gate_gain != 1.0 {
                            // Ramp back to unity instead of jumping, so switching the
                            // gate off mid-note does not click.
                            gate_gain = attack_coeff * gate_gain + (1.0 - attack_coeff);
                        }
                        x *= gate_gain;
                        *sample = x;
                    }

                    // Only rebuild biquad coefficients when a knob actually changed.
                    // Updating them every block would reset filter state and click.
                    if bass != eq_bass {
                        eq.set_bass(bass);
                        eq_bass = bass;
                    }
                    if middle != eq_middle {
                        eq.set_middle(middle);
                        eq_middle = middle;
                    }
                    if treble != eq_treble {
                        eq.set_treble(treble);
                        eq_treble = treble;
                    }
                    if presence != eq_presence {
                        eq.set_presence(presence);
                        eq_presence = presence;
                    }

                    // NAM model, crossfading when the user just changed gain.
                    let loudness = {
                        let mut mm = model_manager.lock();
                        mm.process(&mut buffer[..got], &mut scratch[..got])
                    };

                    // Cabinet impulse response. The bundled captures are amp-only,
                    // so without this the output sounds harsh and fizzy.
                    {
                        let mut guard = ir.lock();
                        if let Some(cab) = guard.as_mut() {
                            cab.process_buffer(&mut buffer[..got], ir_mix);
                        }
                    }

                    // Loudness normalization: compensate for model loudness. Target
                    // -14 dBFS is a sensible streaming/playback level.
                    //
                    // Do NOT also scale by `metadata.gain`: that field is NAM's
                    // 0..1 estimate of how compressed/high-gain the model is, not an
                    // input calibration gain. Dividing by it made clean models much
                    // louder than dirty ones (and could clip hard).
                    let target_loudness = -14.0_f32;
                    let loudness_scale =
                        10.0_f32.powf((target_loudness - loudness) / 20.0);
                    let total_gain = loudness_scale * master_volume;

                    // Amp tone stack approximation (bass / middle / treble / presence).
                    eq.process(&mut buffer[..got]);

                    if gain.is_nan() {
                        gain = total_gain;
                    }

                    for sample in &mut buffer[..got] {
                        let x = *sample;
                        dc_avg = alpha * dc_avg + (1.0 - alpha) * x;
                        gain = smooth_coeff * gain + (1.0 - smooth_coeff) * total_gain;
                        // Soft-knee limiter: transparent under -1dBFS, rounds off
                        // peaks above it, and can never produce digital clipping.
                        *sample = soft_clip((x - dc_avg) * gain);
                    }

                    out_producer.push_slice(&buffer[..got]);
                }
            })
            .map_err(|e| format!("Failed to spawn DSP thread: {}", e))?;

        let output_callback = move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
            // cpal output buffers are interleaved, so the number of mono frames is
            // data.len() / channels. The DSP thread produces one mono stream, which
            // is duplicated to every output channel.
            //
            // This closure must never allocate or lock: it is the real ALSA deadline.
            let frames = data.len() / output_channels;
            for frame in 0..frames {
                let sample = out_consumer.try_pop().unwrap_or(0.0);
                let base = frame * output_channels;
                for ch in 0..output_channels {
                    data[base + ch] = sample;
                }
            }
        };

        let input_health = Arc::clone(&self.health);
        let input_stream = match input_device.build_input_stream(
            input_stream_config,
            input_callback,
            move |err| {
                log::error!("Input stream error: {}", err);
                input_health.record(format!("Input device: {}", err));
            },
            Some(Duration::from_millis(10)),
        ) {
            Ok(stream) => stream,
            Err(e) => {
                // Do not leak the DSP thread if stream setup fails.
                worker_stop.store(true, Ordering::Relaxed);
                let _ = worker.join();
                return Err(format!("Failed to build input stream: {}", e));
            }
        };
        let output_health = Arc::clone(&self.health);
        let output_stream = match output_device.build_output_stream(
            output_stream_config,
            output_callback,
            move |err| {
                log::error!("Output stream error: {}", err);
                output_health.record(format!("Output device: {}", err));
            },
            Some(Duration::from_millis(10)),
        ) {
            Ok(stream) => stream,
            Err(e) => {
                worker_stop.store(true, Ordering::Relaxed);
                let _ = worker.join();
                return Err(format!("Failed to build output stream: {}", e));
            }
        };

        if let Err(e) = input_stream.play() {
            worker_stop.store(true, Ordering::Relaxed);
            let _ = worker.join();
            return Err(format!("Failed to start input stream: {}", e));
        }
        if let Err(e) = output_stream.play() {
            worker_stop.store(true, Ordering::Relaxed);
            let _ = worker.join();
            return Err(format!("Failed to start output stream: {}", e));
        }

        self.input_stream = Some(input_stream);
        self.output_stream = Some(output_stream);
        self.worker = Some(worker);
        self.worker_stop = Some(worker_stop);
        self.active_input_device = input_device_id;
        self.active_output_device = output_device_id;

        {
            let mut state = self.state.lock();
            state.powered = true;
        }

        log::info!("Audio engine started");
        Ok(())
    }

    pub fn stop(&mut self) {
        log::info!("Stopping audio engine");
        // Dropping the streams stops the callbacks. Previously they were leaked with
        // std::mem::forget, so turning the amp off did not actually stop audio.
        self.output_stream.take();
        self.input_stream.take();

        // Stop and join the DSP thread. Dropping the streams already released the
        // ring buffer endpoints held by the callbacks, so this terminates promptly.
        if let Some(stop) = self.worker_stop.take() {
            stop.store(true, Ordering::Relaxed);
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        self.active_input_device = None;
        self.active_output_device = None;

        {
            let mut state = self.state.lock();
            state.powered = false;
        }
        log::info!("Audio engine stopped");
    }

    pub fn set_gain_level(&self, level: u32) {
        let gain_level = GainLevel::new(level);
        let (sensitivity, sample_rate) = {
            let mut state = self.state.lock();
            state.gain_level = gain_level;
            (state.sensitivity, state.sample_rate)
        };
        let crossfade = (MODEL_CROSSFADE_MS * sample_rate as f32 / 1000.0) as usize;
        {
            let mut mm = self.model_manager.lock();
            mm.switch_model(sensitivity, gain_level, crossfade);
        }
        log::info!("Gain level set to {}", level);
    }

    pub fn set_sensitivity(&self, sensitivity: &str) {
        let sensitivity = Sensitivity::from_str(sensitivity);
        let (gain_level, sample_rate) = {
            let mut state = self.state.lock();
            state.sensitivity = sensitivity;
            (state.gain_level, state.sample_rate)
        };
        let crossfade = (MODEL_CROSSFADE_MS * sample_rate as f32 / 1000.0) as usize;
        {
            let mut mm = self.model_manager.lock();
            mm.switch_model(sensitivity, gain_level, crossfade);
        }
        log::info!(
            "Sensitivity set to {}",
            if sensitivity == Sensitivity::High {
                "High"
            } else {
                "Low"
            }
        );
    }

    pub fn set_bass(&self, value: f32) {
        {
            let mut state = self.state.lock();
            state.bass = value.clamp(0.0, 1.0);
        }
        log::info!("Bass set to {}", value);
    }

    pub fn set_middle(&self, value: f32) {
        {
            let mut state = self.state.lock();
            state.middle = value.clamp(0.0, 1.0);
        }
        log::info!("Middle set to {}", value);
    }

    pub fn set_treble(&self, value: f32) {
        {
            let mut state = self.state.lock();
            state.treble = value.clamp(0.0, 1.0);
        }
        log::info!("Treble set to {}", value);
    }

    pub fn set_master_volume(&self, value: f32) {
        {
            let mut state = self.state.lock();
            state.master_volume = value.clamp(0.0, 1.0);
        }
        log::info!("Master volume set to {}", value);
    }

    pub fn set_presence(&self, value: f32) {
        {
            let mut state = self.state.lock();
            state.presence = value.clamp(0.0, 1.0);
        }
        log::info!("Presence set to {}", value);
    }

    pub fn set_preamp(&self, value: f32) {
        {
            let mut state = self.state.lock();
            state.preamp = value.clamp(0.0, 1.0);
        }
        log::info!("Preamp trim set to {}", value);
    }

    pub fn set_noise_gate(&self, enabled: bool, threshold_db: f32, decay_ms: f32) {
        {
            let mut state = self.state.lock();
            state.gate_enabled = enabled;
            state.gate_threshold_db = threshold_db.clamp(-80.0, -10.0);
            state.gate_decay_ms = decay_ms.clamp(10.0, 1000.0);
        }
        log::info!(
            "Noise gate: enabled={}, threshold={:.1}dB, decay={:.0}ms",
            enabled,
            threshold_db,
            decay_ms
        );
    }

    pub fn set_ir_mix(&self, value: f32) {
        {
            let mut state = self.state.lock();
            state.ir_mix = value.clamp(0.0, 1.0);
        }
        log::info!("Cabinet IR mix set to {}", value);
    }

    /// Load a cabinet impulse response from disk. Parsing/resampling happens
    /// before the IR lock is taken so the DSP thread is not blocked.
    pub fn load_ir(&self, path: &str) -> Result<String, String> {
        let mut cabinet = CabinetIr::from_file(Path::new(path))?;
        let rate = self.state.lock().sample_rate;
        cabinet.prepare(rate);
        let name = cabinet.file_name().to_string();
        *self.ir.lock() = Some(cabinet);
        log::info!("Loaded cabinet IR: {} ({})", name, path);
        Ok(name)
    }

    pub fn clear_ir(&self) {
        *self.ir.lock() = None;
        log::info!("Cabinet IR cleared");
    }

    pub fn status(&self) -> AudioStatus {
        let (powered, sample_rate, latency_frames) = {
            let state = self.state.lock();
            (state.powered, state.sample_rate, state.buffer_size)
        };
        AudioStatus {
            powered,
            sample_rate,
            latency_frames,
            xruns: self.health.xruns(),
            last_error: self.health.last_error(),
            ir_name: self
                .ir
                .lock()
                .as_ref()
                .map(|cab| cab.file_name().to_string()),
            nam_model: self.nam_model_name(),
        }
    }

    /// Latest tuner reading: `(hz, level_db)`. `hz == 0.0` means no pitch.
    pub fn tuner(&self) -> (f32, f32) {
        let state = self.state.lock();
        (state.tuner_hz, state.tuner_level_db)
    }

    /// Set the DSP pipeline latency. Takes effect immediately by restarting the
    /// streams, because ring buffer sizes are fixed when they are created.
    pub fn set_buffer_size(&mut self, size: usize) -> Result<(), String> {
        let clamped = size.clamp(MIN_LATENCY_FRAMES, MAX_LATENCY_FRAMES);
        {
            let mut state = self.state.lock();
            state.buffer_size = clamped;
        }
        log::info!("Buffer size set to {} samples", clamped);

        if self.is_powered() {
            self.start(None, None)?;
        }
        Ok(())
    }

    /// Select one of the preloaded NAM models by index.
    pub fn set_nam_model(&self, index: usize) {
        let sample_rate = self.state.lock().sample_rate;
        let crossfade = (MODEL_CROSSFADE_MS * sample_rate as f32 / 1000.0) as usize;
        let mut mm = self.model_manager.lock();
        mm.switch_model_index(index, crossfade);
        log::info!("NAM model set to index {}", index);
    }

    /// Filename of the currently active NAM model.
    pub fn nam_model_name(&self) -> Option<String> {
        self.model_manager.lock().current_model_name()
    }

    /// Sorted list of all loaded NAM model filenames.
    pub fn nam_model_names(&self) -> Vec<String> {
        self.model_manager.lock().model_names()
    }

    pub fn is_powered(&self) -> bool {
        self.state.lock().powered
    }
}

fn find_input_device(host: &cpal::Host, id: Option<&str>) -> Option<cpal::Device> {
    if let Some(id) = id {
        if let Some(device) = find_device_by_id(host, id, true) {
            return Some(device);
        }
        log::warn!("Requested input device '{}' not found, using default", id);
    }
    host.default_input_device()
}

fn find_output_device(host: &cpal::Host, id: Option<&str>) -> Option<cpal::Device> {
    if let Some(id) = id {
        if let Some(device) = find_device_by_id(host, id, false) {
            return Some(device);
        }
        log::warn!("Requested output device '{}' not found, using default", id);
    }
    host.default_output_device()
}

fn find_device_by_id(host: &cpal::Host, id: &str, input: bool) -> Option<cpal::Device> {
    // Preferred path: parse the stable `host:device` id we expose to the UI.
    if let Ok(parsed) = id.parse::<cpal::DeviceId>() {
        if let Some(device) = host.device_by_id(&parsed) {
            return Some(device);
        }
    }

    // Fallback for old saved settings that stored the display name.
    let devices: Vec<cpal::Device> = if input {
        host.input_devices().ok()?.collect()
    } else {
        host.output_devices().ok()?.collect()
    };
    devices.into_iter().find(|device| {
        let device_id = device.id().ok();
        let id_str = device_id.as_ref().map(|d| d.to_string());

        // Never resolve a legacy name to a sysdefault endpoint: those route
        // through dmix, which fails when PipeWire already owns the hardware.
        if let Some(s) = &id_str {
            if s == "alsa:sysdefault" || s.starts_with("alsa:sysdefault:") {
                return false;
            }
        }

        let id_matches = device_id
            .as_ref()
            .map(|d| id_str.as_deref() == Some(id) || d.id() == id)
            .unwrap_or(false);
        let name_matches = device
            .description()
            .map(|d| d.name() == id)
            .unwrap_or(false);
        id_matches || name_matches
    })
}

fn pick_output_config(device: &cpal::Device, desired_rate: u32) -> Result<SupportedStreamConfig, String> {
    let ranges = device
        .supported_output_configs()
        .map_err(|e| format!("Failed to query output configs: {}", e))?;
    pick_config(ranges, desired_rate, true)
        .or_else(|| device.default_output_config().ok())
        .ok_or_else(|| "No usable output config found".to_string())
}

fn pick_input_config(device: &cpal::Device, desired_rate: u32) -> Result<SupportedStreamConfig, String> {
    let ranges = device
        .supported_input_configs()
        .map_err(|e| format!("Failed to query input configs: {}", e))?;
    pick_config(ranges, desired_rate, false)
        .or_else(|| device.default_input_config().ok())
        .ok_or_else(|| "No usable input config found".to_string())
}

/// Pick an F32 config at the desired sample rate. Prefer mono input (guitar) and
/// stereo output. Falls back to the device default if nothing matches.
fn pick_config(
    ranges: impl Iterator<Item = SupportedStreamConfigRange>,
    desired_rate: u32,
    prefer_stereo: bool,
) -> Option<SupportedStreamConfig> {
    let mut fallback = None;

    for range in ranges {
        if range.sample_format() != SampleFormat::F32 || !range.contains_rate(desired_rate) {
            continue;
        }

        let config = range.with_sample_rate(desired_rate);
        let channels = config.channels();

        let preferred = if prefer_stereo {
            channels == 2
        } else {
            channels == 1
        };

        if preferred {
            return Some(config);
        }

        if fallback.is_none() {
            fallback = Some(config);
        }
    }

    fallback
}

/// Build a `StreamConfig` that requests a small device period.
///
/// `SupportedStreamConfig::config()` always reports `BufferSize::Default`, which
/// lets ALSA/PipeWire choose a large period (PipeWire defaults to a 1024-frame
/// quantum). In cpal's ALSA backend `BufferSize::Fixed(n)` means "one period of n
/// frames, double-buffered", so this caps device-side latency and also makes
/// PipeWire shrink its graph quantum to the requested period.
fn stream_config(
    config: &SupportedStreamConfig,
    target_period: u32,
    direction: &str,
) -> cpal::StreamConfig {
    let mut stream_config = config.config();

    match config.buffer_size() {
        cpal::SupportedBufferSize::Range { min, max } => {
            // Stay inside the device's supported range and never request more than
            // the target. `min > max` cannot happen, but `max` may be below the
            // target on quirky endpoints.
            let upper = (*max).min(target_period).max(*min);
            let period = target_period.clamp(*min, upper);
            stream_config.buffer_size = cpal::BufferSize::Fixed(period);
            log::info!(
                "{} period: {} frames (device supports {}..={})",
                direction,
                period,
                min,
                max
            );
        }
        cpal::SupportedBufferSize::Unknown => {
            log::info!(
                "{} period: device reports no supported range, using backend default",
                direction
            );
        }
    }

    stream_config
}

/// Soft-knee limiter. Below `KNEE` the signal is untouched; above it the excess
/// is compressed with `tanh` so the output approaches (but never exceeds) full
/// scale. Prevents hard digital clipping from EQ boosts and high-gain models.
#[inline]
fn soft_clip(x: f32) -> f32 {
    const KNEE: f32 = 0.9;
    let magnitude = x.abs();
    if magnitude <= KNEE {
        return x;
    }
    let over = (magnitude - KNEE) / (1.0 - KNEE);
    let shaped = KNEE + (1.0 - KNEE) * over.tanh();
    shaped.copysign(x)
}

#[cfg(test)]
mod tests {
    use super::soft_clip;

    #[test]
    fn limiter_is_transparent_below_the_knee() {
        for x in [-0.9_f32, -0.5, 0.0, 0.3, 0.9] {
            assert!((soft_clip(x) - x).abs() < 1e-6);
        }
    }

    #[test]
    fn limiter_bounds_output_and_keeps_polarity() {
        for x in [0.95_f32, 1.0, 2.0, 50.0] {
            let y = soft_clip(x);
            assert!(y >= 0.0 && y <= 1.0, "x={x} y={y}");
            assert!((soft_clip(-x) + y).abs() < 1e-6);
        }
    }
}
