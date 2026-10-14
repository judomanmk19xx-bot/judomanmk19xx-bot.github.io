'use strict';

// ── Weather code → icon + text ──
const WMO_CODES = {
  0:  ['☀️',  'Trời quang'],
  1:  ['🌤',  'Ít mây'],
  2:  ['⛅',  'Nhiều mây'],
  3:  ['☁️',  'U ám'],
  45: ['🌫',  'Sương mù'],
  48: ['🌫',  'Sương mù đóng băng'],
  51: ['🌦',  'Mưa phùn nhẹ'],
  53: ['🌦',  'Mưa phùn'],
  55: ['🌦',  'Mưa phùn đặc'],
  61: ['🌧',  'Mưa nhẹ'],
  63: ['🌧',  'Mưa vừa'],
  65: ['🌧',  'Mưa to'],
  71: ['🌨',  'Tuyết nhẹ'],
  73: ['🌨',  'Tuyết vừa'],
  75: ['🌨',  'Tuyết to'],
  77: ['❄️',  'Hạt tuyết'],
  80: ['🌦',  'Mưa rào nhẹ'],
  81: ['🌧',  'Mưa rào'],
  82: ['⛈',  'Mưa rào dữ dội'],
  85: ['🌨',  'Tuyết rào'],
  86: ['🌨',  'Tuyết rào dữ dội'],
  95: ['⛈',  'Giông kèm sấm'],
  96: ['⛈',  'Giông kèm mưa đá nhẹ'],
  99: ['⛈',  'Giông kèm mưa đá'],
};

function wmoInfo(code) {
  for (const [key, val] of Object.entries(WMO_CODES)) {
    if (code >= Number(key) && code < Number(key) + 1) return val;
  }
  return ['☁️', 'Không rõ'];
}

// ── State ──
let stream = null;
let captureData = null;     // { blob, lat, lon, accuracy, weather, location, timestamp, meta }
let watchId = null;
let flashOn = false;

// ── DOM refs ──
const $ = id => document.getElementById(id);
const screens = {
  cam:     $('cam-screen'),
  preview: $('preview-screen'),
  success: $('success-screen'),
};
const video        = $('video');
const canvas       = $('canvas');
const captureBtn   = $('capture-btn');
const flashBtn     = $('flash-btn');
const gpsDot       = $('gps-dot');
const gpsLabel     = $('gps-label');
const weatherBar   = $('weather-bar');
const weatherIcon  = $('weather-icon');
const weatherTemp  = $('weather-temp');
const weatherDesc  = $('weather-desc');
const previewImg   = $('preview-img');
const overlay      = $('photo-overlay');
const infoRows     = $('info-rows');
const overlayToggle= $('overlay-toggle');
const fileInput    = $('file-input');
const loading      = $('loading-overlay');
const loadingText  = $('loading-text');

// ── Helpers ──
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function showLoading(text) {
  loadingText.textContent = text;
  loading.classList.add('active');
}
function hideLoading() { loading.classList.remove('active'); }

function formatDate(d) {
  const h = String(d.getHours()).padStart(2,'0');
  const m = String(d.getMinutes()).padStart(2,'0');
  const s = String(d.getSeconds()).padStart(2,'0');
  const dd= String(d.getDate()).padStart(2,'0');
  const mm= String(d.getMonth()+1).padStart(2,'0');
  const yy= d.getFullYear();
  return { full: `${dd}/${mm}/${yy} ${h}:${m}:${s}`, date: `${yy}${mm}${dd}`, time: `${h}${m}${s}` };
}

function formatCoord(val, pos, neg) {
  if (val == null) return '--';
  const abs = Math.abs(val);
  const deg = Math.floor(abs);
  const min = Math.floor((abs - deg) * 60);
  const sec = ((abs - deg) * 60 - min) * 60;
  const dir = val >= 0 ? pos : neg;
  return `${deg}°${min}'${sec.toFixed(1)}"${dir}`;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Weather fetch ──
async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m`
    + `&timezone=Asia/Ho_Chi_Minh`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Weather fetch failed');
  const j = await r.json();
  const c = j.current;
  return {
    temp:       c.temperature_2m,
    humidity:   c.relative_humidity_2m,
    precip:     c.precipitation,
    windSpeed:  c.wind_speed_10m,
    code:       c.weather_code,
  };
}

// ── Geocoding ──
async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse`
      + `?lat=${lat}&lon=${lon}&format=json&accept-language=vi`;
    const r = await fetch(url, { headers: { 'User-Agent': 'TimemarkPWA/1.0 (contact@minhtri.vn)' } });
    if (!r.ok) return null;
    const j = await r.json();
    const addr = j.address || {};
    const parts = [
      addr.city || addr.town || addr.village || addr.suburb || '',
      addr.county || '',
      addr.state || '',
    ].filter(Boolean);
    return parts.length ? parts.join(', ') : (j.display_name || null);
  } catch { return null; }
}

// ── EXIF writing ──
function decimalToDMS(decimal, ref) {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = (minFloat - min) * 60;
  return [deg, min, sec, ref];
}

async function writeEXIF(blob, data) {
  // Use canvas-based approach for EXIF
  // Real EXIF writing requires binary manipulation — for v1 we embed in filename + JSON
  // The browser's canvas doesn't preserve EXIF, so we write metadata to JSON sidecar
  return blob;
}

function addInfoRow(label, value) {
  const row = document.createElement('div');
  row.className = 'info-row';
  row.innerHTML = `<span class="info-label">${label}</span><span class="info-value">${value}</span>`;
  infoRows.appendChild(row);
}

// ── Watermark canvas ──
function drawWatermark(imgEl, data, showOverlay) {
  const w = imgEl.naturalWidth  || imgEl.width;
  const h = imgEl.naturalHeight || imgEl.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(imgEl, 0, 0);

  if (showOverlay) {
    const pad = Math.max(16, w * 0.02);
    const fs  = Math.max(14, Math.round(w * 0.028));
    const lh  = fs * 1.6;
    const lines = [
      data.location || '—',
      data.ts.full,
      data.weather.temp != null ? `${data.weather.temp}°C · ${data.weather.desc}` : '—',
      data.weather.humidity != null ? `💧 ${data.weather.humidity}%  💨 ${data.weather.windSpeed}km/h` : '—',
    ];

    // Background
    const totalH = lines.length * lh + pad * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const rx = Math.max(8, w * 0.015);
    roundRect(ctx, pad, h - totalH - pad, w - pad * 2, totalH, rx);
    ctx.fill();

    // Text
    ctx.fillStyle = '#fff';
    ctx.font = `${fs}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillText(line, pad + 10, h - totalH + pad + i * lh + 4);
    });
  }

  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Download helper ──
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  downloadBlob(blob, filename);
}

// ── GPS start ──
function startGPS() {
  if (!navigator.geolocation) {
    gpsLabel.textContent = 'GPS không hỗ trợ';
    return;
  }
  gpsDot.className = 'status-dot loading';
  gpsLabel.textContent = 'Đang tìm GPS…';

  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const acc = pos.coords.accuracy;

      gpsDot.className = 'status-dot active';
      gpsLabel.textContent = acc < 20 ? 'GPS ✓' : `GPS ~${Math.round(acc)}m`;

      captureData = captureData || {};
      captureData.lat = lat;
      captureData.lon = lon;
      captureData.accuracy = acc;

      // Fetch weather
      try {
        weatherBar.style.display = 'flex';
        const w = await fetchWeather(lat, lon);
        const [icon, desc] = wmoInfo(w.code);
        captureData.weather = { ...w, icon, desc };
        weatherIcon.textContent = icon;
        weatherTemp.textContent = `${w.temp}°C`;
        weatherDesc.textContent = desc;
      } catch (e) {
        console.warn('Weather failed:', e);
        captureData.weather = { temp: null, desc: 'Lỗi thời tiết' };
        weatherTemp.textContent = '--°C';
        weatherDesc.textContent = 'Không lấy được';
      }

      // Geocode
      try {
        const loc = await reverseGeocode(lat, lon);
        captureData.location = loc;
      } catch (e) {
        console.warn('Geocode failed:', e);
      }

      captureBtn.disabled = false;
    },
    (err) => {
      gpsLabel.textContent = 'GPS lỗi';
      gpsDot.className = 'status-dot';
      console.warn('GPS error:', err);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
  );
}

// ── Camera setup ──
async function setupCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    startGPS();
  } catch (e) {
    alert('Không mở được camera: ' + e.message + '\n\nVui lòng cho phép truy cập camera và vị trí.');
  }
}

// ── Capture ──
async function capture() {
  if (!stream) return;
  captureBtn.disabled = true;
  showLoading('Đang xử lý…');

  try {
    const w = video.videoWidth  || video.clientWidth;
    const h = video.videoHeight || video.clientHeight;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);

    const now = new Date();
    const ts = formatDate(now);

    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));

    captureData = captureData || { lat: null, lon: null };
    captureData.blob = blob;
    captureData.timestamp = now;
    captureData.ts = ts;
    captureData.meta = {
      device: navigator.userAgent,
      screen: `${screen.width}x${screen.height}`,
      pixelRatio: window.devicePixelRatio,
    };

    showPreview();
  } catch (e) {
    alert('Lỗi chụp: ' + e.message);
  } finally {
    hideLoading();
    captureBtn.disabled = false;
  }
}

// ── Preview ──
function showPreview() {
  const d = captureData;
  const ts = d.ts;

  const url = URL.createObjectURL(d.blob);
  const img = new Image();
  img.onload = () => {
    // Update preview image
    previewImg.src = url;

    // Update overlay
    $('ol-loc').textContent   = d.location || `${d.lat?.toFixed(4) || '--'}, ${d.lon?.toFixed(4) || '--'}`;
    $('ol-time').textContent = ts.full;
    $('ol-weather').textContent = d.weather?.temp != null
      ? `${d.weather.temp}°C ${d.weather.icon || ''}`
      : '--';

    // Info rows
    infoRows.innerHTML = '';
    addInfoRow('📍 Vị trí', d.location || `${d.lat?.toFixed(5)}, ${d.lon?.toFixed(5)}`);
    addInfoRow('🕐 Thời điểm', ts.full);
    if (d.weather.temp != null) addInfoRow('🌡 Nhiệt độ', `${d.weather.temp}°C`);
    if (d.weather.humidity != null) addInfoRow('💧 Độ ẩm', `${d.weather.humidity}%`);
    if (d.weather.windSpeed != null) addInfoRow('💨 Gió', `${d.weather.windSpeed} km/h`);
    if (d.weather.desc) addInfoRow('🌥 Thời tiết', d.weather.desc);
    if (d.accuracy) addInfoRow('📶 GPS accuracy', `${Math.round(d.accuracy)}m`);

    URL.revokeObjectURL(url);
    showScreen('preview');
    hideLoading();
  };
  img.src = url;
}

// ── Save ──
async function save() {
  const d = captureData;
  const ts = d.ts;
  const showOverlay = overlayToggle.classList.contains('on');
  const prefix = `IMG_${ts.date}_${ts.time}`;

  showLoading('Đang tạo ảnh…');

  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res; img.onerror = rej;
      img.src = URL.createObjectURL(d.blob);
    });

    // Draw final image
    const finalCanvas = drawWatermark(img, d, showOverlay);

    const finalBlob = await new Promise(r => finalCanvas.toBlob(r, 'image/jpeg', 0.92));

    // Build metadata
    const meta = {
      capturedAt:      ts.full,
      gps: {
        latitude:  d.lat,
        longitude: d.lon,
        accuracy:  d.accuracy,
      },
      weather: {
        temperature:  d.weather?.temp,
        humidity:    d.weather?.humidity,
        windSpeed:   d.weather?.windSpeed,
        description:  d.weather?.desc,
        code:        d.weather?.code,
      },
      location:  d.location,
      device:    d.meta,
    };

    // Download both
    downloadBlob(finalBlob, `${prefix}.jpg`);
    await sleep(400);
    downloadJSON(meta, `${prefix}.json`);

    // Success screen
    $('file-jpg').textContent  = `${prefix}.jpg`;
    $('file-json').textContent = `${prefix}.json`;
    showScreen('success');
  } catch (e) {
    alert('Lỗi lưu: ' + e.message);
  } finally {
    hideLoading();
  }
}

// ── File picked from gallery ──
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  showLoading('Đang đọc ảnh…');
  try {
    const blob = await file.arrayBuffer();
    const b = new Blob([blob], { type: file.type });

    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res; img.onerror = rej;
      img.src = URL.createObjectURL(b);
    });

    const now = new Date();
    const ts = formatDate(now);

    // Try to get GPS from EXIF
    let lat = null, lon = null, acc = null;
    try {
      const exif = await parseEXIF(blob);
      if (exif.GPSLatitude && exif.GPSLongitude) {
        lat = convertDMSToDecimal(exif.GPSLatitude, exif.GPSLatitudeRef);
        lon = convertDMSToDecimal(exif.GPSLongitude, exif.GPSLongitudeRef);
        acc = exif.GPSAltitudeAccuracy || 30;
      }
    } catch {}

    captureData = {
      blob: b,
      lat, lon, accuracy: acc,
      timestamp: now,
      ts,
      meta: { device: navigator.userAgent },
    };

    if (lat && lon) {
      gpsDot.className = 'status-dot active';
      gpsLabel.textContent = 'GPS từ ảnh';
      try {
        weatherBar.style.display = 'flex';
        const w = await fetchWeather(lat, lon);
        const [icon, desc] = wmoInfo(w.code);
        captureData.weather = { ...w, icon, desc };
        weatherIcon.textContent = icon;
        weatherTemp.textContent = `${w.temp}°C`;
        weatherDesc.textContent = desc;
      } catch {}
      try {
        captureData.location = await reverseGeocode(lat, lon);
      } catch {}
    }

    showPreview();
  } catch (e) {
    alert('Lỗi đọc ảnh: ' + e.message);
  } finally {
    hideLoading();
    fileInput.value = '';
  }
});

// Minimal EXIF parser
async function parseEXIF(buffer) {
  const view = new DataView(buffer);
  if (view.getUint16(0) !== 0xFFD8) return {};
  let offset = 2;
  while (offset < view.byteLength - 2) {
    const marker = view.getUint16(offset);
    if (marker === 0xFFE1) {
      const exif = parseEXIFSegment(view, offset + 4);
      if (exif) return exif;
    }
    if ((marker & 0xFF00) !== 0xFF00) break;
    offset += 2 + view.getUint16(offset + 2);
  }
  return {};
}

function parseEXIFSegment(view, start) {
  const result = {};
  try {
    const tiff = view;
    const le = tiff.getUint16(start) === 0x4949; // little endian
    const read = (off, len) => le
      ? (len === 1 ? tiff.getUint8(start + off)
        : len === 2 ? tiff.getUint16(start + off)
        : tiff.getUint32(start + off))
      : (len === 1 ? tiff.getUint8(start + off)
        : len === 2 ? tiff.getUint16(start + off, false)
        : tiff.getUint32(start + off, false));

    const ifdOffset = read(4, 4);
    const numEntries = read(start + ifdOffset, 2);

    for (let i = 0; i < numEntries; i++) {
      const entryOff = start + ifdOffset + 2 + i * 12;
      const tag = read(entryOff, 2);
      const type = read(entryOff + 2, 2);
      const count = read(entryOff + 4, 4);
      const valOff = entryOff + 8;

      // GPS tags
      if (tag === 0x0002) result.GPSLatitude      = readGPSDMS(tiff, start, valOff, le);
      if (tag === 0x0001) result.GPSLatitudeRef   = String.fromCharCode(read(valOff, 1));
      if (tag === 0x0004) result.GPSLongitude     = readGPSDMS(tiff, start, valOff, le);
      if (tag === 0x0003) result.GPSLongitudeRef  = String.fromCharCode(read(valOff, 1));
      if (tag === 0x0006) result.GPSAltitude      = readGPSDMS(tiff, start, valOff, le);
    }
  } catch {}
  return result;
}

function readGPSDMS(view, tiffStart, valOff, le) {
  try {
    const num = valOff + tiffStart;
    const d = view.getUint32(num, le);
    const mi = view.getUint32(num + 4, le);
    const se = view.getUint32(num + 8, le);
    return [d, mi, se];
  } catch { return null; }
}

function convertDMSToDecimal(dms, ref) {
  if (!dms) return null;
  let dd = dms[0] + dms[1] / 60 + dms[2] / 3600;
  if (ref === 'S' || ref === 'W') dd = -dd;
  return dd;
}

// ── Event listeners ──
captureBtn.addEventListener('click', capture);

$('btn-back').addEventListener('click', () => {
  showScreen('cam');
});

$('btn-discard').addEventListener('click', () => {
  captureData = null;
  infoRows.innerHTML = '';
  showScreen('cam');
});

$('btn-save').addEventListener('click', save);

$('btn-new').addEventListener('click', () => {
  captureData = null;
  infoRows.innerHTML = '';
  showScreen('cam');
});

overlayToggle.addEventListener('click', () => {
  overlayToggle.classList.toggle('on');
  if (overlayToggle.classList.contains('on')) {
    overlay.style.display = 'block';
  } else {
    overlay.style.display = 'none';
  }
});

$('gallery-btn').addEventListener('click', () => fileInput.click());

// Flash
flashBtn.addEventListener('click', async () => {
  flashOn = !flashOn;
  flashBtn.style.opacity = flashOn ? '1' : '0.5';
  if (stream) {
    const track = stream.getVideoTracks()[0];
    try {
      await track.applyConstraints({
        advanced: [{ torch: flashOn }]
      });
    } catch {}
  }
});

// ── Boot ──
setupCamera();
