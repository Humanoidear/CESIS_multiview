import express from 'express';
import { spawn } from 'child_process';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// Enable CORS with specific options
app.use(cors({
    origin: ['http://localhost:4321', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
}));

// Add headers for HLS streaming
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');

    // Set proper MIME types for HLS files
    if (req.path.endsWith('.m3u8')) {
        res.type('application/vnd.apple.mpegurl');
    } else if (req.path.endsWith('.ts')) {
        res.type('video/mp2t');
    }

    next();
});

// Serve static HLS files
app.use('/hls', express.static(path.join(__dirname, 'hls')));

// Store active FFmpeg processes
const activeStreams = new Map();

// Create HLS directory if it doesn't exist
const hlsDir = path.join(__dirname, 'hls');
if (!fs.existsSync(hlsDir)) {
    fs.mkdirSync(hlsDir, { recursive: true });
}

// Load streams configuration
const streamsConfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'public', 'streams.json'), 'utf8')
);

// Start streaming endpoint
app.get('/api/stream/start/:cameraId', (req, res) => {
    const { cameraId } = req.params;

    // Find the stream in config
    const stream = streamsConfig.streams.find(s => s.id === cameraId);

    if (!stream) {
        return res.status(404).json({ error: 'Camera not found' });
    }

    // Check if stream is already active
    if (activeStreams.has(cameraId)) {
        return res.json({
            status: 'already_running',
            hlsUrl: `/hls/${cameraId}/stream.m3u8`
        });
    }

    // Create camera-specific directory
    const cameraDir = path.join(hlsDir, cameraId);
    if (!fs.existsSync(cameraDir)) {
        fs.mkdirSync(cameraDir, { recursive: true });
    }

    // FFmpeg command to convert RTSP to HLS with optimized settings for low latency and minimal buffering
    const ffmpeg = spawn('ffmpeg', [
        '-rtsp_transport', 'tcp',
        '-analyzeduration', '1000000',  // Reduce initial analysis time
        '-probesize', '1000000',        // Reduce probe size for faster startup
        '-fflags', 'nobuffer',          // Disable buffering
        '-flags', 'low_delay',          // Enable low delay mode
        '-i', stream.url,
        '-c:v', 'libx264',              // Re-encode video
        '-preset', 'ultrafast',         // Fastest encoding for minimal delay
        '-tune', 'zerolatency',         // Zero latency tuning
        '-vf', 'scale=480:270',         // Even lower resolution (270p) for less bandwidth
        '-b:v', '400k',                 // Lower bitrate to 400 kbps
        '-maxrate', '500k',             // Lower max bitrate
        '-bufsize', '500k',             // Smaller buffer to reduce latency
        '-r', '12',                     // 12 fps (even lower for less data)
        '-g', '24',                     // GOP size (2 seconds at 12fps)
        '-keyint_min', '24',            // Minimum keyframe interval
        '-sc_threshold', '0',           // Disable scene change detection
        '-profile:v', 'baseline',       // Use baseline profile for faster decoding
        '-level', '3.0',                // H.264 level
        '-c:a', 'aac',                  // AAC audio codec
        '-b:a', '32k',                  // Lower audio bitrate to 32 kbps
        '-ar', '22050',                 // Audio sample rate
        '-ac', '1',                     // Mono audio
        '-f', 'hls',
        '-hls_time', '2',               // 2 second segments (balance between latency and stability)
        '-hls_list_size', '3',          // Keep only 3 segments (reduce memory)
        '-hls_flags', 'delete_segments+omit_endlist+split_by_time',
        '-hls_segment_type', 'mpegts',
        '-start_number', '0',
        '-hls_allow_cache', '0',        // Disable caching
        '-hls_playlist_type', 'event',  // Event playlist type for live streaming
        '-hls_segment_filename', path.join(cameraDir, 'segment%d.ts'),
        path.join(cameraDir, 'stream.m3u8')
    ]);

    ffmpeg.stderr.on('data', (data) => {
        console.log(`[${cameraId}] ${data.toString()}`);
    });

    ffmpeg.on('error', (error) => {
        console.error(`[${cameraId}] Error:`, error);
        activeStreams.delete(cameraId);
    });

    ffmpeg.on('close', (code) => {
        console.log(`[${cameraId}] Process exited with code ${code}`);
        activeStreams.delete(cameraId);
    });

    activeStreams.set(cameraId, ffmpeg);

    res.json({
        status: 'started',
        hlsUrl: `/hls/${cameraId}/stream.m3u8`
    });
});

// Stop streaming endpoint
app.get('/api/stream/stop/:cameraId', (req, res) => {
    const { cameraId } = req.params;

    const ffmpeg = activeStreams.get(cameraId);

    if (!ffmpeg) {
        return res.status(404).json({ error: 'Stream not active' });
    }

    ffmpeg.kill('SIGTERM');
    activeStreams.delete(cameraId);

    res.json({ status: 'stopped' });
});

// Get stream status
app.get('/api/stream/status/:cameraId', (req, res) => {
    const { cameraId } = req.params;
    const isActive = activeStreams.has(cameraId);

    res.json({
        active: isActive,
        hlsUrl: isActive ? `/hls/${cameraId}/stream.m3u8` : null
    });
});

// Get all streams
app.get('/api/streams', (req, res) => {
    res.json(streamsConfig);
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        activeStreams: activeStreams.size,
        streams: Array.from(activeStreams.keys())
    });
});

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('Stopping all streams...');
    for (const [cameraId, ffmpeg] of activeStreams.entries()) {
        console.log(`Stopping ${cameraId}`);
        ffmpeg.kill('SIGTERM');
    }
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`Streaming server running on http://localhost:${PORT}`);
    console.log(`Available cameras: ${streamsConfig.streams.length}`);
    console.log(`\nEndpoints:`);
    console.log(`  - GET /api/streams - List all cameras`);
    console.log(`  - GET /api/stream/start/:cameraId - Start streaming`);
    console.log(`  - GET /api/stream/stop/:cameraId - Stop streaming`);
    console.log(`  - GET /api/stream/status/:cameraId - Check stream status`);
    console.log(`  - GET /api/health - Server health check`);
});
