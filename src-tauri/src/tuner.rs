//! Monophonic pitch detection for the tuner display.
//!
//! Uses the YIN algorithm: an autocorrelation-style difference function,
//! cumulative-mean normalization, and parabolic interpolation of the first
//! significant dip. It runs on the DSP worker thread once per analysis window,
//! which is fast enough for a tuner and cheap enough to never threaten the
//! audio deadline. All buffers are pre-allocated.
//!
//! The window is sized from the sample rate (see [`Tuner::prepare`]) so it
//! always spans a few periods of the lowest supported note. A fixed sample
//! count would cover fewer periods at higher rates and miss low bass notes.

/// Lowest fundamental we report. The headroom below six-string bass low A
/// (27.5 Hz) keeps notes at the bottom of the range from being clipped when the
/// detected lag rounds past the exact frequency. Also covers five-string low B
/// (30.9 Hz), four-string low E (41.2 Hz) and drop D (36.7 Hz).
const MIN_HZ: f32 = 25.0;
/// Highest fundamental we report (above a high-fret bend).
const MAX_HZ: f32 = 1400.0;
/// Analysis window length as a multiple of the lowest note's period. Three
/// periods leave a two-period integration window at the longest lag, which is
/// what YIN needs for a stable dip on inharmonic wound strings.
const WINDOW_PERIODS: f32 = 3.0;
/// YIN absolute threshold; lower means "more periodic". 0.2 is a bit more
/// forgiving than the textbook 0.15, which helps with the inharmonicity of
/// wound bass strings.
const YIN_THRESHOLD: f32 = 0.2;
/// Ignore anything quieter than this (roughly -100 dBFS).
const SILENCE_RMS: f32 = 1.0e-5;

#[derive(Debug, Clone, Copy, Default)]
pub struct TunerReading {
    /// Detected fundamental in Hz, or 0.0 when no stable pitch was found.
    pub hz: f32,
    /// Input level in dBFS, useful for an "is anything plugged in" check.
    pub level_db: f32,
}

pub struct Tuner {
    /// Always the most recent `self.window.len()` input samples. The length is
    /// derived from the sample rate in `prepare`, not a fixed constant.
    window: Vec<f32>,
    /// Raw difference function for lags `0..=max_lag`.
    diff: Vec<f32>,
    /// Cumulative-mean-normalized difference for the same lags.
    norm: Vec<f32>,
    /// Samples received since the last analysis.
    since_analysis: usize,
    sample_rate: f32,
    min_lag: usize,
    max_lag: usize,
    /// Length of the fixed integration window (`window.len() - max_lag`).
    integration: usize,
}

impl Tuner {
    pub fn new(sample_rate: f32) -> Self {
        let mut tuner = Tuner {
            window: Vec::new(),
            diff: vec![0.0; 2],
            norm: vec![0.0; 2],
            since_analysis: 0,
            sample_rate: 0.0,
            min_lag: 0,
            max_lag: 0,
            integration: 0,
        };
        tuner.prepare(sample_rate);
        tuner
    }

    /// Reset history, for example after the device sample rate changes.
    pub fn prepare(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate.max(1.0);
        self.min_lag = (self.sample_rate / MAX_HZ).floor().max(2.0) as usize;
        self.max_lag = ((self.sample_rate / MIN_HZ).ceil() as usize).max(self.min_lag + 2);
        // The longest lag is one period of the lowest note. Give the analysis a
        // few of those periods so the difference function has a clear dip even
        // for inharmonic bass strings, at any device sample rate.
        let window = (self.max_lag as f32 * WINDOW_PERIODS).ceil() as usize;
        let window = window.max(self.max_lag + 8);
        self.window.resize(window, 0.0);
        self.integration = window - self.max_lag;
        self.diff = vec![0.0; self.max_lag + 2];
        self.norm = vec![0.0; self.max_lag + 2];
        self.window.fill(0.0);
        self.since_analysis = 0;
    }

    /// Feed input samples. Returns `Some` when an analysis was performed, with
    /// `hz == 0.0` if no stable pitch was found.
    pub fn push(&mut self, samples: &[f32]) -> Option<TunerReading> {
        if samples.is_empty() {
            return None;
        }

        let len = self.window.len();
        if samples.len() >= len {
            self.window.copy_from_slice(&samples[samples.len() - len..]);
        } else {
            let shift = samples.len();
            self.window.copy_within(shift.., 0);
            self.window[len - shift..].copy_from_slice(samples);
        }

        self.since_analysis += samples.len();
        if self.since_analysis < len {
            return None;
        }
        self.since_analysis = 0;

        Some(self.analyze())
    }

    fn analyze(&mut self) -> TunerReading {
        // Remove DC so a drifting input (or a strong low-frequency rumble) does
        // not skew the difference function.
        let len = self.window.len();
        let mean: f32 = self.window.iter().sum::<f32>() / len as f32;
        let sum_sq: f32 = self.window.iter().map(|x| {
            let d = x - mean;
            d * d
        }).sum();
        let rms = (sum_sq / len as f32).sqrt();
        let level_db = 20.0 * rms.max(1.0e-9).log10();

        if rms < SILENCE_RMS {
            return TunerReading {
                hz: 0.0,
                level_db,
            };
        }

        // Difference function over a *fixed* integration window so every lag is
        // measured with the same amount of signal.
        let integration = self.integration;
        for tau in 1..=self.max_lag {
            let mut sum = 0.0_f32;
            for j in 0..integration {
                let a = self.window[j] - mean;
                let b = self.window[j + tau] - mean;
                let delta = a - b;
                sum += delta * delta;
            }
            self.diff[tau] = sum;
        }

        // Cumulative mean normalized difference: d'(0) = 1 and
        // d'(tau) = d(tau) / ((1/tau) * sum_{k=1..tau} d(k)).
        let mut cumulative = 0.0_f32;
        self.norm[0] = 1.0;
        for tau in 1..=self.max_lag {
            cumulative += self.diff[tau];
            self.norm[tau] = if cumulative > 0.0 {
                self.diff[tau] * tau as f32 / cumulative
            } else {
                1.0
            };
        }

        // First dip below the threshold, then walk to its local minimum.
        let mut tau_est = None;
        for tau in self.min_lag..=self.max_lag {
            if self.norm[tau] < YIN_THRESHOLD {
                let mut best = tau;
                while best + 1 <= self.max_lag && self.norm[best + 1] < self.norm[best] {
                    best += 1;
                }
                tau_est = Some(best);
                break;
            }
        }

        let Some(tau) = tau_est else {
            return TunerReading {
                hz: 0.0,
                level_db,
            };
        };

        // Parabolic interpolation around the integer lag for sub-sample accuracy.
        let (left, mid, right) = if tau > 1 && tau < self.max_lag {
            (self.norm[tau - 1], self.norm[tau], self.norm[tau + 1])
        } else {
            (self.norm[tau], self.norm[tau], self.norm[tau])
        };
        let denom = left - 2.0 * mid + right;
        let shift = if denom.abs() > 1.0e-9 {
            0.5 * (left - right) / denom
        } else {
            0.0
        };
        let refined = tau as f32 + shift.clamp(-1.0, 1.0);
        if refined <= 0.0 || !refined.is_finite() {
            return TunerReading {
                hz: 0.0,
                level_db,
            };
        }

        let hz = self.sample_rate / refined;
        if !(MIN_HZ..=MAX_HZ).contains(&hz) {
            return TunerReading {
                hz: 0.0,
                level_db,
            };
        }

        TunerReading { hz, level_db }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, rate: f32, len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate).sin() * 0.5)
            .collect()
    }

    /// Feed one full analysis window and return the resulting reading.
    fn reading_for(freq: f32, rate: f32) -> TunerReading {
        let mut tuner = Tuner::new(rate);
        let samples = sine(freq, rate, tuner.window.len());
        tuner.push(&samples).expect("should analyze")
    }

    fn assert_detects(freq: f32, rate: f32) {
        let reading = reading_for(freq, rate);
        assert!(
            (reading.hz - freq).abs() < 1.0,
            "detected {}Hz at {}Hz rate, expected {}Hz",
            reading.hz,
            rate,
            freq
        );
    }

    #[test]
    fn detects_a_sine_wave() {
        assert_detects(110.0, 48_000.0);
    }

    #[test]
    fn detects_guitar_low_e() {
        assert_detects(82.41, 48_000.0);
    }

    #[test]
    fn detects_bass_low_e() {
        assert_detects(41.20, 48_000.0);
    }

    #[test]
    fn detects_bass_drop_d() {
        assert_detects(36.71, 48_000.0);
    }

    #[test]
    fn detects_five_string_low_b() {
        assert_detects(30.87, 48_000.0);
    }

    #[test]
    fn detects_six_string_low_a() {
        assert_detects(27.50, 48_000.0);
    }

    #[test]
    fn detects_bass_notes_at_other_sample_rates() {
        for rate in [44_100.0, 96_000.0] {
            for freq in [27.50, 30.87, 36.71, 41.20] {
                assert_detects(freq, rate);
            }
        }
    }

    #[test]
    fn window_spans_the_same_time_at_any_sample_rate() {
        let low = Tuner::new(44_100.0);
        let high = Tuner::new(96_000.0);
        assert!(high.window.len() > low.window.len());
        let low_ms = low.window.len() as f32 / 44_100.0 * 1000.0;
        let high_ms = high.window.len() as f32 / 96_000.0 * 1000.0;
        assert!(
            (low_ms - high_ms).abs() < 0.5,
            "window durations differ: {low_ms}ms vs {high_ms}ms"
        );
    }

    #[test]
    fn silence_reports_no_pitch() {
        let mut tuner = Tuner::new(48_000.0);
        let samples = vec![0.0_f32; tuner.window.len()];
        let reading = tuner.push(&samples).expect("should analyze");
        assert_eq!(reading.hz, 0.0);
    }
}
