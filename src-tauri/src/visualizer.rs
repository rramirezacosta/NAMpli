//! Real-time visualization of the amp's output signal.
//!
//! The DSP worker feeds finished (post-limiter) blocks into a rolling window.
//! The same window supplies the oscilloscope trace and a 1024-point FFT whose
//! magnitudes are folded into log-spaced bands for the spectrum display.
//! Everything is pre-allocated so `push` never allocates on the audio thread.

use std::f32::consts::PI;

use serde::Serialize;

/// Samples kept for both the waveform trace and the FFT window (~21 ms @ 48 kHz).
const WAVE_SAMPLES: usize = 1024;
const FFT_SIZE: usize = 1024;
const BANDS: usize = 64;
const MIN_HZ: f32 = 60.0;
const MAX_HZ: f32 = 16_000.0;
/// Spectrum/level display range in dBFS.
const DB_MIN: f32 = -90.0;
const DB_MAX: f32 = 0.0;

/// Snapshot handed to the UI. `serde` keeps the field names camelCase for TS.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualizationFrame {
    /// Latest `WAVE_SAMPLES` output samples, oldest first, -1..1.
    pub waveform: Vec<f32>,
    /// `BANDS` log-spaced magnitudes, normalized to 0..1 over `DB_MIN..DB_MAX`.
    pub spectrum: Vec<f32>,
    /// RMS level of the analysed window in dBFS.
    pub level_db: f32,
    /// Peak level of the analysed window in dBFS.
    pub peak_db: f32,
}

pub struct Visualizer {
    /// Mono rolling window, read oldest→newest for both displays.
    wave: Vec<f32>,
    write: usize,
    /// Samples accumulated since the last analysis (may exceed `FFT_SIZE` by one block).
    since_analysis: usize,
    sample_rate: f32,
    hann: Vec<f32>,
    real: Vec<f32>,
    imag: Vec<f32>,
    bit_reversal: Vec<usize>,
    /// `(start_bin, end_bin)` for each display band.
    bands: Vec<(usize, usize)>,
    /// Rolling sum of squares over the whole window, so levels are exact
    /// regardless of where DSP block boundaries fall.
    sum_sq: f64,
}

impl Visualizer {
    pub fn new(sample_rate: f32) -> Self {
        let hann: Vec<f32> = (0..FFT_SIZE)
            .map(|i| {
                0.5 - 0.5 * (2.0 * PI * i as f32 / (FFT_SIZE - 1) as f32).cos()
            })
            .collect();

        let mut visualizer = Visualizer {
            wave: vec![0.0; WAVE_SAMPLES],
            write: 0,
            since_analysis: 0,
            sample_rate: 1.0,
            hann,
            real: vec![0.0; FFT_SIZE],
            imag: vec![0.0; FFT_SIZE],
            bit_reversal: bit_reversal_table(FFT_SIZE),
            bands: Vec::new(),
            sum_sq: 0.0,
        };
        visualizer.prepare(sample_rate);
        visualizer
    }

    /// Clear history and recompute sample-rate-dependent band edges. Used when
    /// the stream restarts at a different rate and when the Scope is re-enabled.
    pub fn prepare(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate.max(1.0);
        self.bands = bin_ranges(self.sample_rate);
        self.wave.fill(0.0);
        self.write = 0;
        self.since_analysis = 0;
        self.sum_sq = 0.0;
    }

    /// Feed one finished DSP block. Returns a fresh snapshot whenever a full
    /// analysis window has accumulated (~47 times a second at 48 kHz).
    pub fn push(&mut self, samples: &[f32]) -> Option<VisualizationFrame> {
        if samples.is_empty() {
            return None;
        }

        for &sample in samples {
            let outgoing = self.wave[self.write];
            self.sum_sq -= outgoing as f64 * outgoing as f64;
            self.wave[self.write] = sample;
            self.sum_sq += sample as f64 * sample as f64;
            self.write = (self.write + 1) % WAVE_SAMPLES;
            self.since_analysis += 1;
        }

        if self.since_analysis < FFT_SIZE {
            return None;
        }
        self.since_analysis -= FFT_SIZE;

        Some(self.analyze())
    }

    fn analyze(&mut self) -> VisualizationFrame {
        // Oldest → newest, with the Hann window applied for the FFT only.
        for i in 0..FFT_SIZE {
            let index = (self.write + i) % WAVE_SAMPLES;
            let sample = self.wave[index];
            self.real[i] = sample * self.hann[i];
            self.imag[i] = 0.0;
        }
        fft(&mut self.real, &mut self.imag, &self.bit_reversal);

        // A full-scale sine has magnitude ~FFT_SIZE/2 after the FFT, so divide
        // by that to express bins in dBFS. Take the peak bin in each band so
        // narrow strings stay visible on a log frequency axis.
        let scale = 2.0 / FFT_SIZE as f32;
        let mut spectrum = Vec::with_capacity(BANDS);
        for &(lo, hi) in &self.bands {
            let mut magnitude = 0.0_f32;
            for bin in lo..=hi.min(FFT_SIZE / 2 - 1) {
                let re = self.real[bin];
                let im = self.imag[bin];
                magnitude = magnitude.max((re * re + im * im).sqrt());
            }
            let db = 20.0 * (magnitude * scale).max(1.0e-9).log10();
            let normalized = (db - DB_MIN) / (DB_MAX - DB_MIN);
            spectrum.push(normalized.clamp(0.0, 1.0));
        }

        let rms = (self.sum_sq.max(0.0) / WAVE_SAMPLES as f64).sqrt().max(1.0e-9) as f32;
        let level_db = (20.0 * rms.log10()).clamp(DB_MIN, DB_MAX);
        let peak = self.wave.iter().fold(0.0_f32, |acc, &x| acc.max(x.abs()));
        let peak_db = (20.0 * peak.max(1.0e-9).log10()).clamp(DB_MIN, DB_MAX);

        let mut waveform = Vec::with_capacity(WAVE_SAMPLES);
        for i in 0..WAVE_SAMPLES {
            waveform.push(self.wave[(self.write + i) % WAVE_SAMPLES]);
        }

        VisualizationFrame {
            waveform,
            spectrum,
            level_db,
            peak_db,
        }
    }
}

/// Bit-reversal permutation table for an iterative radix-2 FFT.
fn bit_reversal_table(n: usize) -> Vec<usize> {
    let bits = n.trailing_zeros();
    let shift = usize::BITS - bits;
    (0..n).map(|i| i.reverse_bits() >> shift).collect()
}

/// In-place iterative Cooley–Tukey FFT (forward transform, sign -i).
fn fft(real: &mut [f32], imag: &mut [f32], reversal: &[usize]) {
    let n = real.len();
    for i in 0..n {
        let j = reversal[i];
        if j > i {
            real.swap(i, j);
            imag.swap(i, j);
        }
    }

    let mut len = 2;
    while len <= n {
        let angle = -2.0 * PI / len as f32;
        let step_re = angle.cos();
        let step_im = angle.sin();
        let half = len / 2;
        let mut base = 0;
        while base < n {
            let mut twiddle_re = 1.0_f32;
            let mut twiddle_im = 0.0_f32;
            for j in 0..half {
                let even = base + j;
                let odd = even + half;
                let v_re = real[odd] * twiddle_re - imag[odd] * twiddle_im;
                let v_im = real[odd] * twiddle_im + imag[odd] * twiddle_re;
                real[odd] = real[even] - v_re;
                imag[odd] = imag[even] - v_im;
                real[even] += v_re;
                imag[even] += v_im;

                let next_re = twiddle_re * step_re - twiddle_im * step_im;
                twiddle_im = twiddle_re * step_im + twiddle_im * step_re;
                twiddle_re = next_re;
            }
            base += len;
        }
        len *= 2;
    }
}

/// Log-spaced FFT bin edges covering `MIN_HZ..MAX_HZ`.
fn bin_ranges(sample_rate: f32) -> Vec<(usize, usize)> {
    let bin_hz = sample_rate / FFT_SIZE as f32;
    let max_bin = FFT_SIZE / 2 - 1;
    let ratio = MAX_HZ / MIN_HZ;
    let mut edges = Vec::with_capacity(BANDS + 1);
    for band in 0..=BANDS {
        let hz = MIN_HZ * ratio.powf(band as f32 / BANDS as f32);
        let bin = (hz / bin_hz).round() as usize;
        edges.push(bin.clamp(1, max_bin));
    }
    (0..BANDS)
        .map(|band| {
            let lo = edges[band];
            (lo, edges[band + 1].max(lo))
        })
        .collect()
}

/// Centre frequency of a display band (used by the tests).
#[cfg(test)]
fn band_center_hz(band: usize) -> f32 {
    let ratio = MAX_HZ / MIN_HZ;
    MIN_HZ * ratio.powf((band as f32 + 0.5) / BANDS as f32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(visualizer: &mut Visualizer, samples: &[f32]) -> VisualizationFrame {
        let mut frame = None;
        for chunk in samples.chunks(256) {
            if let Some(next) = visualizer.push(chunk) {
                frame = Some(next);
            }
        }
        frame.expect("a full window should produce a frame")
    }

    fn sine(freq: f32, rate: f32, len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| (2.0 * PI * freq * i as f32 / rate).sin() * 0.5)
            .collect()
    }

    #[test]
    fn reports_no_frame_until_a_window_is_full() {
        let mut visualizer = Visualizer::new(48_000.0);
        assert!(visualizer.push(&vec![0.0; 256]).is_none());
        assert!(visualizer.push(&vec![0.0; 256]).is_none());
        assert!(visualizer.push(&vec![0.0; 512]).is_some());
    }

    #[test]
    fn a_sine_peaks_in_the_expected_band() {
        let rate = 48_000.0;
        let mut visualizer = Visualizer::new(rate);
        let frame = feed(&mut visualizer, &sine(440.0, rate, FFT_SIZE));

        let peak = frame
            .spectrum
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .map(|(i, _)| i)
            .expect("spectrum has bands");
        let centre = band_center_hz(peak);
        assert!(
            (centre - 440.0).abs() < 80.0,
            "peak band centred at {centre:.1}Hz, expected ~440Hz"
        );
    }

    #[test]
    fn silence_produces_a_flat_idle_frame() {
        let mut visualizer = Visualizer::new(48_000.0);
        let frame = feed(&mut visualizer, &vec![0.0; FFT_SIZE]);

        assert!(frame.waveform.iter().all(|&x| x == 0.0));
        assert!(frame.spectrum.iter().all(|&x| x == 0.0));
        assert!(frame.level_db <= -89.0);
        assert!(frame.peak_db <= -89.0);
    }

    #[test]
    fn frames_are_bounded_and_finite() {
        let mut visualizer = Visualizer::new(48_000.0);
        let mut seed = 1234_u32;
        let samples: Vec<f32> = (0..FFT_SIZE)
            .map(|_| {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                ((seed >> 8) as f32 / 16_777_215.0) * 2.0 - 1.0
            })
            .collect();
        let frame = feed(&mut visualizer, &samples);

        assert_eq!(frame.waveform.len(), WAVE_SAMPLES);
        assert_eq!(frame.spectrum.len(), BANDS);
        assert!(frame.waveform.iter().all(|x| x.is_finite() && x.abs() <= 1.0));
        assert!(frame.spectrum.iter().all(|x| x.is_finite() && (0.0..=1.0).contains(x)));
        assert!(frame.level_db.is_finite() && frame.peak_db.is_finite());
    }

    #[test]
    fn levels_match_a_known_sine() {
        let rate = 48_000.0;
        let mut visualizer = Visualizer::new(rate);
        let frame = feed(&mut visualizer, &sine(440.0, rate, FFT_SIZE));
        // A 0.5-amplitude sine has RMS 0.354 (-9.0 dBFS) and peak -6.0 dBFS.
        assert!((frame.level_db + 9.03).abs() < 1.0, "level {}", frame.level_db);
        assert!((frame.peak_db + 6.02).abs() < 1.0, "peak {}", frame.peak_db);
    }

    #[test]
    fn prepare_clears_history() {
        let mut visualizer = Visualizer::new(48_000.0);
        feed(&mut visualizer, &sine(440.0, 48_000.0, FFT_SIZE));
        visualizer.prepare(48_000.0);
        let frame = feed(&mut visualizer, &vec![0.0; FFT_SIZE]);
        assert!(frame.waveform.iter().all(|&x| x == 0.0));
        assert!(frame.spectrum.iter().all(|&x| x == 0.0));
    }
}
