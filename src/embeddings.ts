import { existsSync } from 'node:fs';
import path from 'node:path';
import { getLlama, type LlamaEmbeddingContext } from 'node-llama-cpp';
import { getModelPath } from './localBrain';

let embeddingContextPromise: Promise<LlamaEmbeddingContext> | null = null;

async function initializeEmbeddingContext(): Promise<LlamaEmbeddingContext> {
    const llama = await getLlama('lastBuild');
    const modelPath = getModelPath('EMBEDDING_MODEL_PATH', 'bge-small-en-v1.5-q8_0.gguf');

    if (!existsSync(modelPath)) {
        throw new Error(`Missing local model file: ${modelPath}`);
    }

    console.log('Initializing embedding model context...');
    const model = await llama.loadModel({ modelPath });
    return model.createEmbeddingContext();
}

async function ensureEmbeddingContext(): Promise<LlamaEmbeddingContext> {
    embeddingContextPromise ??= initializeEmbeddingContext().catch((error) => {
        embeddingContextPromise = null;
        throw error;
    });

    return embeddingContextPromise;
}

/**
 * Computes a vector embedding for the given text using the local embedding model.
 */
export async function computeEmbedding(text: string): Promise<number[]> {
    if (!text.trim()) {
        return [];
    }

    const context = await ensureEmbeddingContext();
    const embedding = await context.getEmbeddingFor(text);
    return [...embedding.vector];
}

/**
 * Calculates cosine similarity between two embedding vectors.
 * A score of 1 means identical, 0 means orthogonal, -1 means opposite.
 */
export function calculateEmbeddingSimilarity(vectorA: number[], vectorB: number[]): number {
    if (!vectorA.length || !vectorB.length || vectorA.length !== vectorB.length) {
        return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vectorA.length; i++) {
        const a = vectorA[i]!;
        const b = vectorB[i]!;
        dotProduct += a * b;
        normA += a * a;
        normB += b * b;
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
