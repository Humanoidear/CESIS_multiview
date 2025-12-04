import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();

app.use(cors());

const PORT = process.env.PORT || 8080;
const CAMERA_USERNAME = process.env.CAMERA_USERNAME || "root";
const CAMERA_PASSWORD = process.env.CAMERA_PASSWORD || "";
const streamsPath = new URL("./streams.json", import.meta.url);

function parseDigestHeader(header) {
  if (!header || !header.startsWith("Digest ")) {
    throw new Error("Camera did not return a Digest challenge");
  }

  const challenge = header.slice(7);
  const params = {};
  const regex = /(\w+)=((?:"[^"]+")|[^,]+)/g;
  let match;
  while ((match = regex.exec(challenge)) !== null) {
    const key = match[1];
    let value = match[2].trim();
    if (value.startsWith("\"") && value.endsWith("\"")) {
      value = value.slice(1, -1);
    }
    params[key] = value;
  }
  return params;
}

function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

function authenticate(params, method, digestUri, username, password) {
  if (!username || !password) {
    throw new Error("Missing username or password for digest authentication");
  }
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const ha1 = md5(`${username}:${params.realm}:${password}`);
  const ha2 = md5(`${method}:${digestUri}`);
  const response = md5(`${ha1}:${params.nonce}:${nc}:${cnonce}:${params.qop}:${ha2}`);

  return (
    `Digest username="${username}", realm="${params.realm}", nonce="${params.nonce}", ` +
    `uri="${digestUri}", algorithm=MD5, response="${response}", qop=${params.qop}, nc=${nc}, cnonce="${cnonce}"`
  );
}

async function fetchWithDigest(targetUrl, options = {}) {
  const { method = "GET", headers, username, password, ...fetchOptions } = options;
  const initialResponse = await fetch(targetUrl, {
    ...fetchOptions,
    method,
    headers,
  });

  if (initialResponse.status !== 401) {
    return initialResponse;
  }

  const header = initialResponse.headers.get("www-authenticate");
  const params = parseDigestHeader(header);

  const uri = new URL(targetUrl);
  const digestUri = uri.pathname + uri.search;
  const authHeader = authenticate(params, method, digestUri, username, password);

  const nextHeaders = new Headers(headers || {});
  nextHeaders.set("Authorization", authHeader);

  return fetch(targetUrl, {
    ...fetchOptions,
    method,
    headers: nextHeaders,
  });
}

app.get("/streams", async (_req, res) => {
  try {
    const raw = await readFile(streamsPath, "utf-8");
    res.json(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to read streams configuration", error);
    res.status(500).json({ error: "Unable to load streams configuration" });

    app.get("/credentials", async (_req, res) => {
      res.json({
        username: CAMERA_USERNAME,
        password: CAMERA_PASSWORD
      });
    });
  }
});

app.get("/ptz", async (req, res) => {
  const ip = req.query.ip;
  const command = req.query.command || "info=1&camera=1";

  console.log(`Received PTZ request: ip=${ip}, command=${command}`);

  if (!ip) {
    return res.status(400).json({ error: "Missing required query parameter: ip" });
  }

  const targetUrl = `http://${ip}/axis-cgi/com/ptz.cgi?${command}`;
  console.log(`Target URL: ${targetUrl}`);

  try {
    const response = await fetchWithDigest(targetUrl, { username: CAMERA_USERNAME, password: CAMERA_PASSWORD });
    if (!response.ok) {
      return res.status(response.status).json({ error: `Camera returned status ${response.status}` });
    }

    const data = await response.text();
    res.send(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/reboot", async (req, res) => {
  const ip = req.query.ip;
  console.log(`Received reboot request: ip=${ip}`);

  if (!ip) {
    return res.status(400).json({ error: "Missing required query parameter: ip" });
  }

  const targetUrl = `http://${ip}/axis-cgi/firmwaremanagement.cgi`;
  console.log(`Reboot URL: ${targetUrl}`);

  const payload = JSON.stringify({
    apiVersion: "1.0",
    method: "reboot"
  });

  try {
    const response = await fetchWithDigest(targetUrl, {
      username: CAMERA_USERNAME,
      password: CAMERA_PASSWORD,
      method: "POST",
      body: payload,
      headers: {
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Reboot failed for ${ip}: ${response.status} - ${errorText}`);
      return res.status(response.status).json({ error: `Camera returned status ${response.status}` });
    }

    const result = await response.json();
    console.log(`Reboot response for ${ip}:`, result);
    res.json({ success: true, message: `Camera ${ip} is rebooting`, data: result });
  } catch (error) {
    console.error(`Reboot error for ${ip}:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.use(express.static("dist"));

app.get("/", (_req, res) => {
  res.sendFile(join(__dirname, "index.html"));
});
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

