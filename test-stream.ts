const WS_URL = process.env.WS_URL ?? 'ws://localhost:3000/stream';

console.log(`Connecting to ${WS_URL}...`);

const ws = new WebSocket(WS_URL);

ws.onopen = () => {
    console.log('Connected to Virtual Crystal Server');

    const interval = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) {
            clearInterval(interval);
            return;
        }

        const waveA = Array.from({ length: 5 }, () => Math.random() * Math.PI * 2);
        const waveB = Array.from({ length: 5 }, () => Math.random() * Math.PI * 2);

        console.log('Sending wave data...');
        ws.send(JSON.stringify({ waveA, waveB }));
    }, 1500);

    setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) return;

        console.log('Sending wave thought: "What is the frequency of a crystal?"');
        ws.send(JSON.stringify({ thought: 'What is the frequency of a crystal?' }));
    }, 5000);
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Server response:', data);
};

ws.onclose = () => {
    console.log('Connection closed');
};

ws.onerror = (error) => {
    console.error('WebSocket error:', error);
};
