use nam_rs::{Model, NamModel};
use std::collections::HashMap;
use std::path::Path;

/// Sensitivity setting for the amp
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Sensitivity {
    High,
    Low,
}

impl Sensitivity {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "high" | "hi" | "h" => Sensitivity::High,
            _ => Sensitivity::Low,
        }
    }
}

/// Gain level (1-5, maps to G2, G4, G6, G8, G10)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct GainLevel(u32);

impl GainLevel {
    pub fn new(level: u32) -> Self {
        // Clamp to 1-5
        let clamped = level.clamp(1, 5);
        GainLevel(clamped)
    }

    /// Get the G-number for the NAM filename (G2, G4, G6, G8, G10)
    pub fn g_number(&self) -> u32 {
        self.0 * 2
    }
}

/// Key for model lookup
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ModelKey {
    pub sensitivity: Sensitivity,
    pub gain_level: GainLevel,
}

impl ModelKey {
    fn filename_str(&self) -> String {
        let sens = match self.sensitivity {
            Sensitivity::High => "Hi",
            Sensitivity::Low => "Lo",
        };
        format!("JCM800 {} P6 B8 M4 T7 G{}", sens, self.gain_level.g_number())
    }
}

/// Loaded NAM model with metadata
pub struct LoadedModel {
    pub model: Model,
    pub filename: String,
    pub expected_sample_rate: u32,
    pub loudness: f32,
}

/// Equal-power crossfade state for model switches.
///
/// Switching gain on a NAM capture replaces the whole recurrent model state, so
/// a hard swap produces an audible transient. During a fade the DSP thread runs
/// both models and mixes them with sin/cos weights, which keeps the perceived
/// loudness constant across the transition.
#[derive(Debug, Clone)]
pub struct FadeState {
    pub from: ModelId,
    pub remaining: usize,
    pub total: usize,
}

/// Key for model lookup — either a built-in (sensitivity+gain) or an arbitrary filename.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ModelId {
    BuiltIn(ModelKey),
    Custom(String),
}

impl ModelId {
    fn filename_str(&self) -> &str {
        match self {
            ModelId::Custom(s) => s,
            ModelId::BuiltIn(_) => "",
        }
    }
}

/// Manages loading, mapping, and switching NAM models
pub struct ModelManager {
    models: HashMap<ModelId, LoadedModel>,
    current_id: ModelId,
    fade: Option<FadeState>,
    /// Model requested while a fade is still running. Applied when the current
    /// fade finishes so rapid gain-knob moves never stack crossfades.
    pending: Option<(ModelId, usize)>,
}

impl ModelManager {
    pub fn new(nams_dir: &Path) -> Result<Self, String> {
        let mut models = HashMap::new();

        // Define all 10 NAM file mappings
        let mappings = [
            // Gain 1 → G2
            (Sensitivity::High, GainLevel::new(1), "JCM800 Hi P6 B8 M4 T7 G2.nam"),
            (Sensitivity::Low, GainLevel::new(1), "JCM800 Lo P6 B8 M4 T7 G2.nam"),
            // Gain 2 → G4
            (Sensitivity::High, GainLevel::new(2), "JCM800 Hi P6 B8 M4 T7 G4.nam"),
            (Sensitivity::Low, GainLevel::new(2), "JCM800 Lo P6 B8 M4 T7 G4.nam"),
            // Gain 3 → G6
            (Sensitivity::High, GainLevel::new(3), "JCM800 Hi P6 B8 M4 T7 G6.nam"),
            (Sensitivity::Low, GainLevel::new(3), "JCM800 Lo P6 B8 M4 T7 G6.nam"),
            // Gain 4 → G8
            (Sensitivity::High, GainLevel::new(4), "JCM800 Hi P6 B8 M4 T7 G8.nam"),
            (Sensitivity::Low, GainLevel::new(4), "JCM800 Lo P6 B8 M4 T7 G8.nam"),
            // Gain 5 → G10
            (Sensitivity::High, GainLevel::new(5), "JCM800 Hi P6 B8 M4 T7 G10.nam"),
            (Sensitivity::Low, GainLevel::new(5), "JCM800 Lo P6 B8 M4 T7 G10.nam"),
        ];

        for (sensitivity, gain_level, filename) in &mappings {
            let path = nams_dir.join(filename);
            log::info!("Loading NAM model: {}", path.display());

            let nam = NamModel::from_file(&path)
                .map_err(|e| format!("Failed to load {}: {}", path.display(), e))?;

            let model = Model::from_nam(&nam)
                .map_err(|e| format!("Failed to create model from {}: {}", path.display(), e))?;

            // Model metadata. `metadata.gain` is deliberately not used for level
            // compensation: it is NAM's 0..1 estimate of how compressed the model
            // is, not an input calibration gain.
            let expected_sample_rate = nam.expected_sample_rate() as u32;
            let loudness = nam.loudness().unwrap_or(-20.0);

            // A freshly built model already starts from zeroed state, and `reset()`
            // zeroes the same buffers, so pumping `receptive_field` samples of silence
            // through it would just burn CPU (12ms for these models) for no benefit.
            log::info!(
                "Loaded {} (receptive_field={}, sample_rate={}, loudness={:.1}dB)",
                filename,
                model.receptive_field(),
                expected_sample_rate,
                loudness
            );

            let key = ModelId::BuiltIn(ModelKey {
                sensitivity: *sensitivity,
                gain_level: *gain_level,
            });

            models.insert(key, LoadedModel {
                model,
                filename: filename.to_string(),
                expected_sample_rate,
                loudness,
            });
        }

        // Default to High sensitivity, gain level 1
        let current_id = ModelId::BuiltIn(ModelKey {
            sensitivity: Sensitivity::High,
            gain_level: GainLevel::new(1),
        });

        Ok(ModelManager {
            models,
            current_id,
            fade: None,
            pending: None,
        })
    }

    /// Get the expected sample rate of the current model
    pub fn current_expected_sample_rate(&self) -> u32 {
        self.models.get(&self.current_id).map(|m| m.expected_sample_rate).unwrap_or(48000)
    }

    /// Process a buffer through the active model, crossfading from the previous
    /// model when a switch just happened. `scratch` must be at least as long as
    /// `buffer` and is used for the outgoing model's output. Returns the
    /// loudness (dB) to use for normalization on this block.
    pub fn process(&mut self, buffer: &mut [f32], scratch: &mut [f32]) -> f32 {
        let n = buffer.len().min(scratch.len());

        let Some(fade) = self.fade.clone() else {
            let loaded = self
                .models
                .get_mut(&self.current_id)
                .expect("Current model not found");
            loaded.model.process_buffer(&mut buffer[..n]);
            return loaded.loudness;
        };

        // A fade from the same key (or a missing model) is meaningless.
        if fade.from == self.current_id || !self.models.contains_key(&fade.from) {
            self.fade = None;
            let loaded = self
                .models
                .get_mut(&self.current_id)
                .expect("Current model not found");
            loaded.model.process_buffer(&mut buffer[..n]);
            return loaded.loudness;
        }

        let [Some(from), Some(to)] = self
            .models
            .get_disjoint_mut([&fade.from, &self.current_id])
        else {
            self.fade = None;
            let loaded = self
                .models
                .get_mut(&self.current_id)
                .expect("Current model not found");
            loaded.model.process_buffer(&mut buffer[..n]);
            return loaded.loudness;
        };

        // New model writes into `buffer`, outgoing model into `scratch`, then
        // mix with equal-power (sin/cos) weights sample by sample.
        to.model.process_buffer(&mut buffer[..n]);
        from.model.process_buffer(&mut scratch[..n]);

        let start = 1.0 - fade.remaining as f32 / fade.total as f32;
        let step = 1.0 / fade.total as f32;
        for i in 0..n {
            let p = (start + step * (i as f32 + 1.0)).clamp(0.0, 1.0);
            let angle = p * std::f32::consts::FRAC_PI_2;
            let gain_new = angle.sin();
            let gain_old = angle.cos();
            buffer[i] = buffer[i] * gain_new + scratch[i] * gain_old;
        }

        let consumed = n.min(fade.remaining);
        let new_remaining = fade.remaining - consumed;
        let end = 1.0 - new_remaining as f32 / fade.total as f32;
        let loudness = from.loudness + (to.loudness - from.loudness) * end;

        if new_remaining == 0 {
            self.fade = None;
            // Start the next queued switch, if the user moved the knob again
            // while this fade was still running.
            if let Some((next_id, crossfade)) = self.pending.take() {
                if next_id != self.current_id {
                    self.begin_switch(next_id, crossfade);
                }
            }
        } else {
            self.fade = Some(FadeState {
                remaining: new_remaining,
                ..fade.clone()
            });
        }

        loudness
    }

    /// Drop any in-progress crossfade. Called when the streams restart so the
    /// first block does not mix in a stale model.
    pub fn clear_fade(&mut self) {
        self.fade = None;
        self.pending = None;
    }

    /// Reset the target model and start the equal-power fade into it.
    fn begin_switch(&mut self, id: ModelId, crossfade_samples: usize) {
        // `reset()` zeroes every internal buffer, so the new model starts from a
        // clean slate. The crossfade hides the resulting transient.
        if let Some(loaded) = self.models.get_mut(&id) {
            loaded.model.reset();
        }

        if crossfade_samples > 0 {
            self.fade = Some(FadeState {
                from: self.current_id.clone(),
                remaining: crossfade_samples,
                total: crossfade_samples,
            });
        } else {
            self.fade = None;
        }

        self.current_id = id;
    }

    /// Sorted list of loaded model filenames, for UI selection.
    pub fn model_names(&self) -> Vec<String> {
        let mut entries: Vec<&LoadedModel> = self.models.values().collect();
        entries.sort_by(|a, b| a.filename.cmp(&b.filename));
        entries.into_iter().map(|m| m.filename.clone()).collect()
    }

    /// Sorted list of loaded model ids, matching `model_names()`.
    fn sorted_ids(&self) -> Vec<ModelId> {
        let mut entries: Vec<(ModelId, &LoadedModel)> = self.models.iter().map(|(k, v)| (k.clone(), v)).collect();
        entries.sort_by(|a, b| a.1.filename.cmp(&b.1.filename));
        entries.into_iter().map(|(k, _)| k).collect()
    }

    /// Switch to a model by its index in `model_names()`.
    pub fn switch_model_index(&mut self, index: usize, crossfade_samples: usize) {
        let ids = self.sorted_ids();
        if let Some(id) = ids.get(index).cloned() {
            self.switch_to_id(id, crossfade_samples);
        }
    }

    /// Filename of the currently active model.
    pub fn current_model_name(&self) -> Option<String> {
        self.models.get(&self.current_id).map(|m| m.filename.clone())
    }

    /// Switch to a model by ModelId.
    fn switch_to_id(&mut self, id: ModelId, crossfade_samples: usize) {
        if self.current_id == id {
            self.pending = None;
            return;
        }

        if !self.models.contains_key(&id) {
            log::warn!("Model not found for id: {:?}", id);
            return;
        }

        let filename = &self.models.get(&id).unwrap().filename;
        log::info!("Switching to model: {}", filename);

        if self.fade.is_some() {
            self.pending = Some((id, crossfade_samples));
            return;
        }

        self.begin_switch(id, crossfade_samples);
    }

    /// Switch to a model by filename (used for custom/unnamed NAM files).
    pub fn switch_model_by_key(&mut self, filename: &str, crossfade_samples: usize) {
        let id = ModelId::Custom(filename.to_string());
        self.switch_to_id(id, crossfade_samples);
    }

    /// Load a NAM model from raw bytes and register it under the given filename.
    pub fn load_model_from_bytes(&mut self, filename: &str, bytes: Vec<u8>) -> Result<(), String> {
        let json = String::from_utf8(bytes)
            .map_err(|e| format!("NAM file is not valid UTF-8: {}", e))?;
        let nam = NamModel::from_json_str(&json)
            .map_err(|e| format!("Failed to parse NAM: {}", e))?;
        let model = Model::from_nam(&nam)
            .map_err(|e| format!("Failed to create model: {}", e))?;
        let expected_sample_rate = nam.expected_sample_rate() as u32;
        let loudness = nam.loudness().unwrap_or(-20.0);
        log::info!("Loaded custom NAM {} (sample_rate={}, loudness={:.1}dB)", filename, expected_sample_rate, loudness);
        let id = ModelId::Custom(filename.to_string());
        self.models.insert(id, LoadedModel {
            model,
            filename: filename.to_string(),
            expected_sample_rate,
            loudness,
        });
        Ok(())
    }

    /// Switch to a different model based on sensitivity and gain level.
    /// `crossfade_samples` controls the equal-power blend (0 disables it).
    pub fn switch_model(
        &mut self,
        sensitivity: Sensitivity,
        gain_level: GainLevel,
        crossfade_samples: usize,
    ) {
        let id = ModelId::BuiltIn(ModelKey {
            sensitivity,
            gain_level,
        });
        self.switch_to_id(id, crossfade_samples);
    }
}
