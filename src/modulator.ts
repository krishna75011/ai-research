/**
 * Modulator Module
 * Converts textual data into wave frequency arrays for holographic interference.
 */

/**
 * Converts a string into a numerical wave frequency array.
 * 
 * Logic:
 * 1. Convert each character to its Unicode code point (mod 256 for range safety).
 * 2. Normalize to a 0.0 - 1.0 range (dividing by 255).
 * 3. Map to a 0 - 2π phase range for wave interference.
 * 
 * @param text - The input string to modulate.
 * @returns An array of numbers representing wave frequencies/phases.
 */
export function textToWave(text: string): number[] {
    const frequencies: number[] = [];
    
    for (const char of text) {
        const codePoint = char.codePointAt(0)!;
        const normalized = (codePoint % 256) / 255;
        const phase = normalized * Math.PI * 2;
        frequencies.push(phase);
    }
    
    return frequencies;
}
