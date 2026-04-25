export interface Complex {
    re: number;
    im: number;
}

/**
 * Simulates holographic wave interference by combining two frequency waves.
 * 
 * Mathematically, holographic interference occurs when two waves superimpose.
 * Here, we treat the input numerical arrays as phase components (or frequencies 
 * normalized to phases) and perform a vector sum in the complex plane.
 * 
 * @param waveA - First numerical array representing wave frequencies/phases
 * @param waveB - Second numerical array representing wave frequencies/phases
 * @returns An array of complex numbers representing the resulting interference pattern
 */
export function simulateInterference(waveA: number[], waveB: number[]): Complex[] {
    const length = Math.min(waveA.length, waveB.length);
    const result: Complex[] = new Array(length);

    for (let i = 0; i < length; i++) {
        const valA = waveA[i]!;
        const valB = waveB[i]!;

        result[i] = {
            re: Math.cos(valA) + Math.cos(valB),
            im: Math.sin(valA) + Math.sin(valB)
        };
    }

    return result;
}
