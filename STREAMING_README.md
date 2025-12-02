# CESIS Multiview - Streaming Setup

This project streams RTSP camera feeds to a web browser using HLS (HTTP Live Streaming).

## Prerequisites

You need **FFmpeg** installed on your system:

### macOS:
```bash
brew install ffmpeg
```

### Ubuntu/Debian:
```bash
sudo apt update
sudo apt install ffmpeg
```

### Verify Installation:
```bash
ffmpeg -version
```

## Installation

```bash
npm install
```

## Running the Application

### Option 1: Run Both Servers Together (Recommended)
```bash
npm run dev:all
```

This will start:
- Astro dev server on `http://localhost:4321`
- Streaming backend on `http://localhost:3001`

### Option 2: Run Servers Separately

**Terminal 1 - Backend Server:**
```bash
npm run server
```

**Terminal 2 - Astro Dev Server:**
```bash
npm run dev
```

## How It Works

1. **Backend Server** (`server.js`):
   - Receives requests to start streaming a camera
   - Uses FFmpeg to convert RTSP streams to HLS format
   - Serves HLS segments (.m3u8 and .ts files)
   - Manages multiple concurrent streams

2. **Frontend** (Astro + Video.js):
   - Requests the backend to start a camera stream
   - Uses Video.js to play the HLS stream
   - Provides loading states and error handling

## API Endpoints

- `GET /api/streams` - List all available cameras
- `GET /api/stream/start/:cameraId` - Start streaming a camera
- `GET /api/stream/stop/:cameraId` - Stop streaming a camera
- `GET /api/stream/status/:cameraId` - Check if a stream is active
- `GET /api/health` - Server health check

## Camera Configuration

Edit `public/streams.json` to add/modify cameras:

```json
{
  "streams": [
    {
      "id": "cambox11",
      "name": "SALA 1 CAMBOX11 DOMO",
      "url": "rtsp://root:root2021!@CAMBOX11.uv.es/axis-media/media.amp",
      "group": "SALA 1"
    }
  ]
}
```

## Troubleshooting

### FFmpeg Not Found
Make sure FFmpeg is installed and accessible in your PATH.

### Stream Won't Load
1. Check if the RTSP URL is accessible
2. Verify network connectivity to the camera
3. Check backend server logs for FFmpeg errors
4. Some RTSP streams require specific parameters

### High CPU Usage
Each active stream uses CPU for transcoding. Limit concurrent streams if needed.

### CORS Issues
The backend has CORS enabled. If you change ports, update the `BACKEND_URL` in `CameraFeed.astro`.

## Production Deployment

For production:
1. Build the Astro site: `npm run build`
2. Use a process manager (PM2) for the backend server
3. Configure a reverse proxy (nginx) to handle both servers
4. Consider using hardware acceleration for FFmpeg if available

## Notes

- HLS has a 2-6 second delay (inherent to the protocol)
- The backend creates temporary HLS files in the `hls/` directory
- Streams auto-cleanup segments to save disk space
- Multiple clients can watch the same stream without additional transcoding
