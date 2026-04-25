import { once } from 'node:events';
import { createWriteStream, existsSync, renameSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Using bge-small-en-v1.5 as it is explicitly supported and well-tested in node-llama-cpp
const MODEL_URL = 'https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf?download=true';
const DEST_PATH = path.join(process.cwd(), 'models', 'bge-small-en-v1.5-q8_0.gguf');

async function downloadEmbeddingModel() {
    await mkdir(path.dirname(DEST_PATH), { recursive: true });

    if (existsSync(DEST_PATH)) {
        console.log('Model already exists at:', DEST_PATH);
        return;
    }

    console.log('Downloading BGE-small embedding model (~35MB)...');
    console.log('URL:', MODEL_URL);

    const response = await fetch(MODEL_URL);
    if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
    }

    const tempPath = `${DEST_PATH}.tmp`;
    const fileStream = createWriteStream(tempPath);
    const reader = response.body?.getReader();

    if (!reader) throw new Error('Could not access response body');

    let downloadedBytes = 0;
    const totalBytes = Number.parseInt(response.headers.get('content-length') || '0');

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (!fileStream.write(value)) {
            await once(fileStream, 'drain');
        }
        downloadedBytes += value.length;

        if (totalBytes) {
            const percent = ((downloadedBytes / totalBytes) * 100).toFixed(2);
            process.stdout.write(
                `\rProgress: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(2)} MB / ${(totalBytes / 1024 / 1024).toFixed(2)} MB)`
            );
        }
    }

    fileStream.end();
    await once(fileStream, 'finish');
    renameSync(tempPath, DEST_PATH);
    console.log('\nDownload complete. Model saved to:', DEST_PATH);
}

downloadEmbeddingModel().catch((error) => {
    console.error('\nDownload failed:', error);
    process.exit(1);
});
