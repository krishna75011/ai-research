import type { WaveUnit } from './virtualCrystal';

/**
 * Calculates a stable sector bucket for coarse wave clustering.
 */
export function calculateSector(vector: WaveUnit[]): number {
    let sum = 0;
    for (let i = 0; i < vector.length; i++) {
        const unit = vector[i]!;
        sum += (i + 1) * (Math.abs(unit.re) * 17 + Math.abs(unit.im) * 31);
    }

    const sector = Math.floor(sum * 1000) % 10;
    return sector + 1;
}

/**
 * Calculates cosine similarity across real and imaginary vector components.
 * Missing tail elements are treated as zero so longer vectors do not score
 * as perfect matches against a shared prefix alone.
 */
export function cosineSimilarity(vecA: WaveUnit[], vecB: WaveUnit[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.max(vecA.length, vecB.length);

    for (let i = 0; i < len; i++) {
        const a = vecA[i] ?? { re: 0, im: 0 };
        const b = vecB[i] ?? { re: 0, im: 0 };

        dotProduct += a.re * b.re + a.im * b.im;
        normA += a.re * a.re + a.im * a.im;
        normB += b.re * b.re + b.im * b.im;
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
