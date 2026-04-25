/**
 * Modulator Module
 * Converts textual data into wave frequency arrays for holographic interference.
 */

/**
 * Converts a string into a numerical wave frequency array.
 * 
 * Logic:
 * 1. Convert each character to its ASCII value.
 * 2. Normalize to a 0.0 - 1.0 range (dividing by 255).
 * 3. Map to a 0 - 2π phase range for wave interference.
 * 
 * @param text - The input string to modulate.
 * @returns An array of numbers representing wave frequencies/phases.
 */
export function textToWave(text: string): number[] {
    const frequencies: number[] = [];
    
    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        const normalized = charCode / 255;
        const phase = normalized * Math.PI * 2;
        frequencies.push(phase);
    }
    
    return frequencies;
}
