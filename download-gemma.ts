import { once } from 'node:events';
import { createWriteStream, existsSync, renameSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const MODEL_URL = 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf?download=true';
const DEST_PATH = path.join(process.cwd(), 'models', 'gemma-4-E2B-it-Q4_K_M.gguf');

async function downloadGemma() {
    await mkdir(path.dirname(DEST_PATH), { recursive: true });

    if (existsSync(DEST_PATH)) {
        console.log('Model already exists at:', DEST_PATH);
        return;
    }

    console.log('Downloading Gemma E2B model...');
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

downloadGemma().catch((error) => {
    console.error('\nDownload failed:', error);
    process.exit(1);
});
