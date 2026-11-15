/// Normalized biquad coefficients.
///
/// `b*` are the feed-forward (numerator) coefficients and `a1`/`a2` are the
/// feedback (denominator) coefficients *after* division by `a0`. Keeping the
/// coefficients normalized lets the per-sample process be a simple difference
/// equation with no division.
#[derive(Clone, Copy)]
pub struct BiquadCoeffs {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a1: f32,
    pub a2: f32,
}

impl BiquadCoeffs {
    pub fn unity() -> Self {
        BiquadCoeffs {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
        }
    }
}

/// State for a single biquad filter instance
pub struct BiquadState {
    coeffs: BiquadCoeffs,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl BiquadState {
    pub fn new() -> Self {
        BiquadState {
            coeffs: BiquadCoeffs::unity(),
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    /// Process a single sample
    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let BiquadCoeffs { b0, b1, b2, a1, a2 } = self.coeffs;
        let y = b0 * x + b1 * self.x1 + b2 * self.x2 - a1 * self.y1 - a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }

    /// Update coefficients. Filter history is intentionally preserved so a knob
    /// change does not produce a click/discontinuity.
    pub fn set_coeffs(&mut self, coeffs: BiquadCoeffs) {
        self.coeffs = coeffs;
    }

    /// Process a buffer of samples
    #[inline]
    pub fn process_buffer(&mut self, buffer: &mut [f32]) {
        for sample in buffer.iter_mut() {
            *sample = self.process(*sample);
        }
    }
}

/// Full EQ chain: Bass (low-shelf), Middle (peaking), Treble (high-shelf),
/// Presence (high-shelf around 5kHz, the JCM800 power-amp control).
pub struct EqChain {
    bass: BiquadState,
    middle: BiquadState,
    treble: BiquadState,
    presence: BiquadState,
    sample_rate: f32,
}

impl EqChain {
    pub fn new(sample_rate: f32) -> Self {
        EqChain {
            bass: BiquadState::new(),
            middle: BiquadState::new(),
            treble: BiquadState::new(),
            presence: BiquadState::new(),
            sample_rate,
        }
    }

    /// Set bass filter coefficients (low-shelf, ~100Hz)
    pub fn set_bass(&mut self, value: f32) {
        // value: 0.0 to 1.0, maps to -12dB to +12dB
        let gain_db = (value - 0.5) * 24.0;
        let coeffs = low_shelf(self.sample_rate, 100.0, gain_db);
        self.bass.set_coeffs(coeffs);
    }

    /// Set middle filter coefficients (peaking, ~1000Hz)
    pub fn set_middle(&mut self, value: f32) {
        // value: 0.0 to 1.0, maps to -12dB to +12dB
        let gain_db = (value - 0.5) * 24.0;
        let coeffs = peaking(self.sample_rate, 1000.0, 1.0, gain_db);
        self.middle.set_coeffs(coeffs);
    }

    /// Set treble filter coefficients (high-shelf, ~3000Hz)
    pub fn set_treble(&mut self, value: f32) {
        // value: 0.0 to 1.0, maps to -12dB to +12dB
        let gain_db = (value - 0.5) * 24.0;
        let coeffs = high_shelf(self.sample_rate, 3000.0, gain_db);
        self.treble.set_coeffs(coeffs);
    }

    /// Set presence filter coefficients (high-shelf, ~5000Hz).
    ///
    /// On a JCM800 the presence control lives in the power amp's negative
    /// feedback loop and adds bite above ~4-5kHz rather than the broader treble
    /// shelf. Range is deliberately smaller (+/-9dB) so it complements, rather
    /// than duplicates, the treble control.
    pub fn set_presence(&mut self, value: f32) {
        let gain_db = (value - 0.5) * 18.0;
        let coeffs = high_shelf(self.sample_rate, 5000.0, gain_db);
        self.presence.set_coeffs(coeffs);
    }

    /// Process a buffer through the full EQ chain
    #[inline]
    pub fn process(&mut self, buffer: &mut [f32]) {
        self.bass.process_buffer(buffer);
        self.middle.process_buffer(buffer);
        self.treble.process_buffer(buffer);
        self.presence.process_buffer(buffer);
    }
}

/// Low-shelf filter coefficient calculation (RBJ audio EQ cookbook, S = 1)
fn low_shelf(sample_rate: f32, frequency: f32, gain_db: f32) -> BiquadCoeffs {
    let a = 10.0_f32.powf(gain_db / 40.0);
    let omega = 2.0 * std::f32::consts::PI * frequency / sample_rate;
    let sin_omega = omega.sin();
    let cos_omega = omega.cos();
    let sqrt_a = a.sqrt();
    let alpha = sin_omega / 2.0 * std::f32::consts::SQRT_2;

    let b0 = a * ((a + 1.0) - (a - 1.0) * cos_omega + 2.0 * sqrt_a * alpha);
    let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_omega);
    let b2 = a * ((a + 1.0) - (a - 1.0) * cos_omega - 2.0 * sqrt_a * alpha);
    let a0 = (a + 1.0) + (a - 1.0) * cos_omega + 2.0 * sqrt_a * alpha;
    let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_omega);
    let a2 = (a + 1.0) + (a - 1.0) * cos_omega - 2.0 * sqrt_a * alpha;

    normalize(b0, b1, b2, a0, a1, a2)
}

/// Peaking EQ filter coefficient calculation (RBJ audio EQ cookbook)
fn peaking(sample_rate: f32, frequency: f32, q: f32, gain_db: f32) -> BiquadCoeffs {
    let a = 10.0_f32.powf(gain_db / 40.0);
    let omega = 2.0 * std::f32::consts::PI * frequency / sample_rate;
    let sin_omega = omega.sin();
    let cos_omega = omega.cos();
    let alpha = sin_omega / (2.0 * q);

    let b0 = 1.0 + alpha * a;
    let b1 = -2.0 * cos_omega;
    let b2 = 1.0 - alpha * a;
    let a0 = 1.0 + alpha / a;
    let a1 = -2.0 * cos_omega;
    let a2 = 1.0 - alpha / a;

    normalize(b0, b1, b2, a0, a1, a2)
}

/// High-shelf filter coefficient calculation (RBJ audio EQ cookbook, S = 1)
fn high_shelf(sample_rate: f32, frequency: f32, gain_db: f32) -> BiquadCoeffs {
    let a = 10.0_f32.powf(gain_db / 40.0);
    let omega = 2.0 * std::f32::consts::PI * frequency / sample_rate;
    let sin_omega = omega.sin();
    let cos_omega = omega.cos();
    let sqrt_a = a.sqrt();
    let alpha = sin_omega / 2.0 * std::f32::consts::SQRT_2;

    let b0 = a * ((a + 1.0) + (a - 1.0) * cos_omega + 2.0 * sqrt_a * alpha);
    let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_omega);
    let b2 = a * ((a + 1.0) + (a - 1.0) * cos_omega - 2.0 * sqrt_a * alpha);
    let a0 = (a + 1.0) - (a - 1.0) * cos_omega + 2.0 * sqrt_a * alpha;
    let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_omega);
    let a2 = (a + 1.0) - (a - 1.0) * cos_omega - 2.0 * sqrt_a * alpha;

    normalize(b0, b1, b2, a0, a1, a2)
}

fn normalize(b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) -> BiquadCoeffs {
    let inv_a0 = 1.0 / a0;
    BiquadCoeffs {
        b0: b0 * inv_a0,
        b1: b1 * inv_a0,
        b2: b2 * inv_a0,
        a1: a1 * inv_a0,
        a2: a2 * inv_a0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settle(state: &mut BiquadState, input: f32, samples: usize) -> f32 {
        let mut y = 0.0;
        for _ in 0..samples {
            y = state.process(input);
        }
        y
    }

    #[test]
    fn flat_settings_are_unity() {
        let mut eq = EqChain::new(48_000.0);
        eq.set_bass(0.5);
        eq.set_middle(0.5);
        eq.set_treble(0.5);
        eq.set_presence(0.5);

        let mut buffer = [0.25_f32, -0.5, 0.1, 0.0];
        let expected = buffer;
        eq.process(&mut buffer);

        for (actual, expected) in buffer.iter().zip(expected.iter()) {
            assert!((actual - expected).abs() < 1e-6);
        }
    }

    #[test]
    fn low_shelf_boost_approaches_expected_dc_gain() {
        let mut state = BiquadState::new();
        state.set_coeffs(low_shelf(48_000.0, 100.0, 12.0));
        let y = settle(&mut state, 1.0, 20_000);
        let expected = 10.0_f32.powf(12.0 / 20.0);
        assert!((y - expected).abs() < 0.02, "y={y}, expected={expected}");
    }

    #[test]
    fn peaking_boost_is_centered_at_target_frequency() {
        // A +12 dB peaking filter should have roughly 4x gain at its center.
        let mut state = BiquadState::new();
        state.set_coeffs(peaking(48_000.0, 1000.0, 1.0, 12.0));

        // Prime the filter, then measure a 1 kHz sine's RMS gain.
        let mut input = Vec::with_capacity(48_000);
        let mut output = Vec::with_capacity(48_000);
        for i in 0..48_000 {
            let x = (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / 48_000.0).sin();
            input.push(x);
            output.push(state.process(x));
        }

        let tail = 8_000;
        let in_rms = (input[input.len() - tail..]
            .iter()
            .map(|x| x * x)
            .sum::<f32>()
            / tail as f32)
            .sqrt();
        let out_rms = (output[output.len() - tail..]
            .iter()
            .map(|x| x * x)
            .sum::<f32>()
            / tail as f32)
            .sqrt();
        let gain = out_rms / in_rms;
        assert!((gain - 3.98).abs() < 0.15, "gain={gain}");
    }
}
