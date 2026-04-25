import type { WaveUnit } from './resonanceLedger';

export interface AcousticWaveSummary {
    memoryText: string;
    prompt: string;
}

function roundTo(value: number, decimals = 2): string {
    return value.toFixed(decimals);
}

export function summarizeAcousticWave(waveA: number[], vector: WaveUnit[]): AcousticWaveSummary {
    const binCount = waveA.length;
    const totalPhase = waveA.reduce((sum, phase) => sum + phase, 0);
    const averagePhase = totalPhase / Math.max(binCount, 1);
    const variance =
        waveA.reduce((sum, phase) => {
            const delta = phase - averagePhase;
            return sum + delta * delta;
        }, 0) / Math.max(binCount, 1);
    const phaseSpread = Math.sqrt(variance);
    const activeBands = waveA.filter((phase) => phase >= Math.PI).length;

    let dominantBand = 0;
    let dominantPhase = 0;
    for (let i = 0; i < waveA.length; i++) {
        if (waveA[i]! > dominantPhase) {
            dominantBand = i;
            dominantPhase = waveA[i]!;
        }
    }

    const spectralCentroid =
        totalPhase === 0
            ? 0
            : waveA.reduce((sum, phase, index) => sum + phase * index, 0) / totalPhase;

    let meanMagnitude = 0;
    let peakMagnitude = 0;
    let realBias = 0;
    let imaginaryBias = 0;

    for (const unit of vector) {
        const magnitude = Math.sqrt(unit.re * unit.re + unit.im * unit.im);
        meanMagnitude += magnitude;
        peakMagnitude = Math.max(peakMagnitude, magnitude);
        realBias += unit.re;
        imaginaryBias += unit.im;
    }

    meanMagnitude /= Math.max(vector.length, 1);
    realBias /= Math.max(vector.length, 1);
    imaginaryBias /= Math.max(vector.length, 1);

    const featureBlock =
        `frequency bins=${binCount}; ` +
        `dominant band=${dominantBand}; ` +
        `dominant phase=${roundTo(dominantPhase)} rad; ` +
        `spectral centroid=${roundTo(spectralCentroid)}; ` +
        `active bands=${activeBands}; ` +
        `average phase=${roundTo(averagePhase)} rad; ` +
        `phase spread=${roundTo(phaseSpread)} rad; ` +
        `mean interference magnitude=${roundTo(meanMagnitude)}; ` +
        `peak interference magnitude=${roundTo(peakMagnitude)}; ` +
        `real-axis bias=${roundTo(realBias)}; ` +
        `imaginary-axis bias=${roundTo(imaginaryBias)}.`;

    const memoryText = `[Acoustic Uplink] ${featureBlock}`;
    const prompt =
        'Interpret this live acoustic resonance signature from a microphone uplink. ' +
        'This is non-transcribed voice data rather than text. ' +
        'Infer tone, rhythm, tension, steadiness, or intent without claiming exact words.\n\n' +
        `[Acoustic Signature]\n${featureBlock}`;

    return { memoryText, prompt };
}
