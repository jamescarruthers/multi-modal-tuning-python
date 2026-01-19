"""
Tuning presets for common percussion instruments.

Contains standard tuning ratios for marimbas, vibraphones, xylophones, etc.

Extended with torsional mode tuning based on:
Soares et al. (2021) "Tuning of bending and torsional modes of bars used in
mallet percussion instruments", JASA 150(4), pp.2757-2769.

Notation: "B1:B2:B3:B4|T1:T2" where B=bending, T=torsional ratios
"""

from typing import List, Optional
import math
from ..types import TuningPreset


TUNING_PRESETS: List[TuningPreset] = [
    # === Traditional bending-only presets (backward compatible) ===
    TuningPreset(
        name="1:2.76:5.40",
        ratios=[1, 2.756, 5.404],
        description="Natural uniform bar frequencies (no tuning needed)",
        instrument="Uniform Bar"
    ),
    TuningPreset(
        name="1:4:10",
        ratios=[1, 4, 10],
        description="Standard marimba tuning (triple tuning)",
        instrument="Marimba"
    ),
    TuningPreset(
        name="1:4:9",
        ratios=[1, 4, 9],
        description="Alternative marimba/vibraphone tuning",
        instrument="Vibraphone"
    ),
    TuningPreset(
        name="1:3:6",
        ratios=[1, 3, 6],
        description="Xylophone tuning",
        instrument="Xylophone"
    ),
    TuningPreset(
        name="1:3:6:12",
        ratios=[1, 3, 6, 12],
        description="Extended harmonic series (quadruple tuning)",
        instrument="Custom"
    ),
    TuningPreset(
        name="1:2:4:8",
        ratios=[1, 2, 4, 8],
        description="Octave series (demanding)",
        instrument="Custom"
    ),
    TuningPreset(
        name="1:2:4:8:16",
        ratios=[1, 2, 4, 8, 16],
        description="Extended octave series (5 modes)",
        instrument="Custom"
    ),
    TuningPreset(
        name="1:5:10:15",
        ratios=[1, 5, 10, 15],
        description="Unorthodox quintal tuning",
        instrument="Custom"
    ),
    TuningPreset(
        name="1:2:5:10",
        ratios=[1, 2, 5, 10],
        description="Mixed interval tuning",
        instrument="Custom"
    ),
    TuningPreset(
        name="1:3:5:7:9",
        ratios=[1, 3, 5, 7, 9],
        description="Odd harmonic series",
        instrument="Custom"
    ),

    # === 4-mode bending presets (from Soares paper) ===
    TuningPreset(
        name="1:4:10:16",
        ratios=[1, 4, 10, 16],
        description="Extended vibraphone tuning (4 bending modes)",
        instrument="Vibraphone"
    ),
    TuningPreset(
        name="1:3:6:10",
        ratios=[1, 3, 6, 10],
        description="Extended xylophone tuning (4 bending modes)",
        instrument="Xylophone"
    ),

    # === Combined bending + torsional presets (Soares et al. 2021) ===
    # These use target_modes to specify which mode each ratio corresponds to
    # The ratios list contains all target frequencies in the same order as target_modes
    TuningPreset(
        name="1:4:10|4",
        ratios=[1, 4, 10, 4],  # V1=1×, V2=4×, V3=10×, T1=4×
        target_modes=['V1', 'V2', 'V3', 'T1'],
        description="Marimba with T1 tuned to unison with V2 (Soares)",
        instrument="Marimba"
    ),
    TuningPreset(
        name="1:4:10|5",
        ratios=[1, 4, 10, 5],  # V1=1×, V2=4×, V3=10×, T1=5×
        target_modes=['V1', 'V2', 'V3', 'T1'],
        description="Marimba with T1 at 5× (natural position)",
        instrument="Marimba"
    ),
    TuningPreset(
        name="1:4:10|6",
        ratios=[1, 4, 10, 6],  # V1=1×, V2=4×, V3=10×, T1=6×
        target_modes=['V1', 'V2', 'V3', 'T1'],
        description="Marimba with T1 at 6× (between V2 and V3)",
        instrument="Marimba"
    ),
    TuningPreset(
        name="1:4:10:16|4:16",
        ratios=[1, 4, 10, 16, 4, 16],  # V1=1×, V2=4×, V3=10×, V4=16×, T1=4×, T2=16×
        target_modes=['V1', 'V2', 'V3', 'V4', 'T1', 'T2'],
        description="4 bending + 2 torsional (T1=V2, T2=V4 unison)",
        instrument="Vibraphone"
    ),
    TuningPreset(
        name="1:4:10:16|5:15",
        ratios=[1, 4, 10, 16, 5, 15],  # V1=1×, V2=4×, V3=10×, V4=16×, T1=5×, T2=15×
        target_modes=['V1', 'V2', 'V3', 'V4', 'T1', 'T2'],
        description="4 bending + 2 torsional (separate frequencies)",
        instrument="Vibraphone"
    ),
    TuningPreset(
        name="1:4:10:16|5:20",
        ratios=[1, 4, 10, 16, 5, 20],  # V1=1×, V2=4×, V3=10×, V4=16×, T1=5×, T2=20×
        target_modes=['V1', 'V2', 'V3', 'V4', 'T1', 'T2'],
        description="4 bending + 2 torsional (from Soares paper)",
        instrument="Vibraphone"
    ),
    TuningPreset(
        name="1:4:10:16|6:18",
        ratios=[1, 4, 10, 16, 6, 18],  # V1=1×, V2=4×, V3=10×, V4=16×, T1=6×, T2=18×
        target_modes=['V1', 'V2', 'V3', 'V4', 'T1', 'T2'],
        description="4 bending + 2 torsional (from Soares paper)",
        instrument="Vibraphone"
    ),
]


def get_preset(name: str) -> Optional[TuningPreset]:
    """Get preset by name."""
    for preset in TUNING_PRESETS:
        if preset.name == name:
            return preset
    return None


def calculate_target_frequencies(ratios: List[float], fundamental_hz: float) -> List[float]:
    """Calculate target frequencies from preset and fundamental."""
    return [r * fundamental_hz for r in ratios]


def calculate_torsional_targets(
    torsional_ratios: Optional[List[float]],
    fundamental_hz: float
) -> Optional[List[float]]:
    """
    Calculate torsional target frequencies from ratios and fundamental.

    Args:
        torsional_ratios: Torsional mode ratios (e.g., [5, 20] for T1=5×f1, T2=20×f1)
        fundamental_hz: Fundamental bending frequency in Hz

    Returns:
        List of torsional target frequencies, or None if no torsional ratios
    """
    if torsional_ratios is None:
        return None
    return [r * fundamental_hz for r in torsional_ratios]


def find_nearest_torsional_target(
    computed_freq: float,
    allowed_targets: List[float]
) -> float:
    """
    Find nearest allowed torsional target for flexible torsional tuning.

    Based on Soares et al. (2021) Eq. 4 alternative formulation where
    torsional modes can snap to nearest frequency in allowed set.

    Args:
        computed_freq: Computed torsional frequency
        allowed_targets: List of allowed target frequencies

    Returns:
        Nearest target frequency from allowed set
    """
    if not allowed_targets:
        return computed_freq
    return min(allowed_targets, key=lambda t: abs(t - computed_freq))


def frequency_to_cents(computed: float, target: float) -> float:
    """
    Convert frequency ratio to cents deviation.
    1 cent = 1/100 of a semitone = 1/1200 of an octave.
    """
    if target <= 0 or computed <= 0:
        return 0.0
    return 1200 * math.log2(computed / target)


# Natural frequencies of a uniform rectangular bar (free-free)
# For reference: f_n = (beta_n)^2 / (2*pi*L^2) * sqrt(E*I / (rho*A))
# where beta_1 = 4.730, beta_2 = 7.853, beta_3 = 10.996, beta_4 = 14.137
UNIFORM_BAR_BETAS = [4.730041, 7.853205, 10.995608, 14.137165, 17.278760]

# Frequency ratios for uniform bar (relative to first mode)
# f_n / f_1 = (beta_n / beta_1)^2
UNIFORM_BAR_RATIOS = [(b / UNIFORM_BAR_BETAS[0]) ** 2 for b in UNIFORM_BAR_BETAS]
# Results: [1, 2.76, 5.40, 8.93, 13.34] approximately
