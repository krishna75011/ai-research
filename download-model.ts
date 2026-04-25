import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

const MODEL_URL = 'https://huggingface.co/bartowski/Qwen2-0.5B-Instruct-GGUF/resolve/main/Qwen2-0.5B-Instruct-Q4_K_M.gguf';
const DEST_FOLDER = path.join(process.cwd(), 'models');
const DEST_PATH = path.join(DEST_FOLDER, 'Qwen2-0.5B-Instruct-Q4_K_M.gguf');

async function download() {
    if (!fs.existsSync(DEST_FOLDER)) {
        fs.mkdirSync(DEST_FOLDER, { recursive: true });
    }

    if (fs.existsSync(DEST_PATH)) {
        console.log('Model already exists at:', DEST_PATH);
        return;
    }

    console.log('Downloading Qwen2 0.5B model...');
    console.log('URL:', MODEL_URL);

    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);

    const tempPath = `${DEST_PATH}.tmp`;
    const fileStream = fs.createWriteStream(tempPath);
    const reader = response.body?.getReader();

    if (!reader) throw new Error('Failed to get reader from response body');

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
            process.stdout.write(`\rProgress: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(2)} MB)`);
        }
    }

    fileStream.end();
    await once(fileStream, 'finish');
    fs.renameSync(tempPath, DEST_PATH);
    console.log('\nDownload complete. Model saved to:', DEST_PATH);
}

download().catch((err) => {
    console.error('\nDownload failed:', err);
    process.exit(1);
});
