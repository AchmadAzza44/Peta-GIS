require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const wkx = require('wkx');
const proj4 = require('proj4');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Proj4 setup for EPSG:3857 to EPSG:4326
const epsg3857 = "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext  +no_defs";
const epsg4326 = "+proj=longlat +datum=WGS84 +no_defs";

function reprojectCoordinates(coords) {
    if (typeof coords[0] === 'number') {
        const [x, y] = coords;
        if (Math.abs(x) > 180 || Math.abs(y) > 90) {
            return proj4(epsg3857, epsg4326, [x, y]);
        }
        return coords;
    }
    return coords.map(reprojectCoordinates);
}

function parseGeoPackageGeometry(buffer) {
    if (!buffer) return null;
    const magic = buffer.toString('ascii', 0, 2);
    let parsedGeometry = null;

    if (magic === 'GP') {
        const flags = buffer.readUInt8(3);
        const envelopeIndicator = (flags & 0x0E) >> 1;
        let headerLength = 8;
        if (envelopeIndicator === 1) headerLength += 32;
        else if (envelopeIndicator === 2 || envelopeIndicator === 3) headerLength += 48;
        else if (envelopeIndicator === 4) headerLength += 64;

        const wkbBuffer = buffer.slice(headerLength);
        try {
            parsedGeometry = wkx.Geometry.parse(wkbBuffer).toGeoJSON();
        } catch (e) {
            console.error('Error parsing WKB:', e);
            return null;
        }
    } else {
        try {
            parsedGeometry = wkx.Geometry.parse(buffer).toGeoJSON();
        } catch (e) {
            console.error('Error parsing strict WKB:', e);
            return null;
        }
    }

    if (parsedGeometry && parsedGeometry.coordinates) {
        parsedGeometry.coordinates = reprojectCoordinates(parsedGeometry.coordinates);
    }
    return parsedGeometry;
}

const dbPath = path.resolve(__dirname, '../Peta Unib.gpkg');
const db = new Database(dbPath, { readonly: true });

// Read campus boundary into memory for PIP (Point in Polygon) filtering
let campusBoundaryGeoJSON = null;
try {
    const row = db.prepare('SELECT geom FROM unibfix WHERE geom IS NOT NULL LIMIT 1').get();
    if (row && row.geom) {
        campusBoundaryGeoJSON = parseGeoPackageGeometry(row.geom);
        console.log("Loaded campus boundary for filtering.");
    }
} catch (e) {
    console.error("Failed to load campus boundary:", e);
}

function isPointInCampus(lat, lon) {
    if (!campusBoundaryGeoJSON) return true; // Default to true if no boundary loaded

    const pt = [lon, lat]; // GeoJSON uses longitude, latitude
    const type = campusBoundaryGeoJSON.type;
    const coords = campusBoundaryGeoJSON.coordinates;

    function pointInRing(pt, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1];
            const xj = ring[j][0], yj = ring[j][1];
            const intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
                (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    if (type === 'Polygon') {
        return pointInRing(pt, coords[0]);
    } else if (type === 'MultiPolygon') {
        for (const poly of coords) {
            if (pointInRing(pt, poly[0])) return true;
        }
    }
    return false;
}

// ============================================================
//  DATA GEDUNG UNIB LENGKAP (hardcoded + terverifikasi)
//  Koordinat: [lat, lon] format WGS84
// ============================================================
const UNIB_BUILDINGS = [
    // === PUSAT / REKTORAT (Inti) ===
    { id: 'b001', name: 'Rektorat UNIB', category: 'Pusat', lat: -3.75845, lon: 102.27230 },
    { id: 'b002', name: 'Gedung Auditorium UNIB', category: 'Pusat', lat: -3.75700, lon: 102.27180 },
    { id: 'b003', name: 'Perpustakaan UNIB', category: 'Pusat', lat: -3.75400, lon: 102.27810 },
    { id: 'b004', name: 'Gedung LPTIK (TIK)', category: 'Pusat', lat: -3.75680, lon: 102.27750 },

    // === GERBANG & AKSES (Harus ada untuk routing) ===
    { id: 'gd001', name: 'Gerbang Unib Depan', category: 'Gerbang', lat: -3.75820, lon: 102.26720 },
    { id: 'gd002', name: 'Keluar Depan (Exit)', category: 'Gerbang', lat: -3.75780, lon: 102.26700 },
    { id: 'gd003', name: 'Gerbang Rektorat', category: 'Gerbang', lat: -3.75870, lon: 102.27190 },
    { id: 'gd004', name: 'Gerbang Belakang', category: 'Gerbang', lat: -3.75720, lon: 102.27900 },
    { id: 'gd005', name: 'Keluar Belakang (Exit)', category: 'Gerbang', lat: -3.75700, lon: 102.28000 },

    // === LOKASI UTBK ===
    { id: 'utbk001', name: 'Lab Sistem Informasi (UTBK)', category: 'Lokasi UTBK', lat: -3.75250, lon: 102.28010 },
    { id: 'utbk002', name: 'Gedung LPTIK (UTBK)', category: 'Lokasi UTBK', lat: -3.75680, lon: 102.27750 },
    { id: 'utbk003', name: 'Perpustakaan UNIB (UTBK)', category: 'Lokasi UTBK', lat: -3.75400, lon: 102.27810 },
    { id: 'utbk004', name: 'Gedung Kedokteran (UTBK)', category: 'Lokasi UTBK', lat: -3.75200, lon: 102.28050 },
    { id: 'utbk005', name: 'Dekanat Hukum (UTBK)', category: 'Lokasi UTBK', lat: -3.75660, lon: 102.26820 },
    { id: 'utbk006', name: 'Dekanat FEB (UTBK)', category: 'Lokasi UTBK', lat: -3.75990, lon: 102.27050 },
];

// ============================================================
// UTBK Endpoint - data dari GeoPackage
// ============================================================
app.get('/api/utbk', (req, res) => {
    try {
        const rows = db.prepare('SELECT fid, id, Nama_gdg, geom FROM Lokasi_UTBK WHERE geom IS NOT NULL').all();
        const features = rows.map(row => {
            return {
                type: 'Feature',
                properties: { fid: row.fid, id: row.id, name: row.Nama_gdg, type: 'UTBK' },
                geometry: parseGeoPackageGeometry(row.geom)
            };
        }).filter(f => f.geometry !== null);
        res.json({ type: 'FeatureCollection', features });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch UTBK locations' });
    }
});

// ============================================================
// Base Map Endpoints - dari GeoPackage
// ============================================================
app.get('/api/basemap/lines', (req, res) => {
    try {
        // Gunakan jalan_unib_clipped (sudah dipotong sesuai batas kampus UNIB)
        const rows = db.prepare('SELECT fid, geom, other_tags FROM [jalan_unib_clipped] WHERE geom IS NOT NULL').all();
        const features = rows.map(row => {
            // Parse highway type dari other_tags jika ada
            let highway = 'unclassified';
            if (row.other_tags) {
                const highwayMatch = row.other_tags.match(/"highway"=>"([^"]+)"/);
                if (highwayMatch) highway = highwayMatch[1];
            }
            return {
                type: 'Feature',
                properties: { fid: row.fid, highway },
                geometry: parseGeoPackageGeometry(row.geom)
            };
        }).filter(f => f.geometry !== null);
        res.json({ type: 'FeatureCollection', features });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch basemap lines', detail: err.message });
    }
});

app.get('/api/basemap/area', (req, res) => {
    try {
        const rows = db.prepare('SELECT fid, geom FROM unibfix WHERE geom IS NOT NULL').all();
        const features = rows.map(row => {
            return {
                type: 'Feature',
                properties: { fid: row.fid, type: 'CampusBounds' },
                geometry: parseGeoPackageGeometry(row.geom)
            };
        }).filter(f => f.geometry !== null);
        res.json({ type: 'FeatureCollection', features });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch basemap area' });
    }
});

// ============================================================
// Gates Endpoint - dari GeoPackage
// ============================================================
app.get('/api/gates', (req, res) => {
    try {
        const rows = db.prepare('SELECT fid, Namagb, geom FROM GerbangMasuk WHERE geom IS NOT NULL').all();
        const features = rows.map(row => {
            return {
                type: 'Feature',
                properties: { fid: row.fid, name: row.Namagb, type: 'Gate' },
                geometry: parseGeoPackageGeometry(row.geom)
            };
        }).filter(f => f.geometry !== null);
        res.json({ type: 'FeatureCollection', features });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch gates' });
    }
});

// ============================================================
// Buildings Endpoint - data lengkap gedung UNIB
// ============================================================
app.get('/api/buildings', (req, res) => {
    try {
        // Gabungkan data hardcoded + Overpass (jika ada, tanpa duplikat)
        let all = [...UNIB_BUILDINGS];

        // Tambahkan dari Overpass cache (yg belum ada di hardcoded)
        if (osmCampusData.length > 0) {
            const hardcodedNames = new Set(UNIB_BUILDINGS.map(b => b.name.toLowerCase()));
            const osmExtra = osmCampusData.filter(item => {
                const n = item.name.toLowerCase();
                const exclusionsStrict = ['dr.', 'drg', 'bni', 'bri', 'bca', 'meps', 'atm'];
                const exclusionsLoose = [
                    'pondok', 'kontrakan', 'kos', 'spbu', 'tino galo', 'toko', 'warung', 'rstg', 'rumah sakit',
                    'klinik', 'apotek', 'cirrus', 'link', 'prima', 'mastercard', 'visa', 'mandiri', 'bank', 'laundry', 'lapas', 'sate madura', 'sekolah alam', 'indomaret', 'alfamart', 'sd', 'bedengan', 'puteri', 'putri', 'ketua rt',
                    'tahfidz', 'muspani', 'aceh', 'jihadul', 'sunan', 'paud', 'copy centre', 'copycentre', 'hotel', 'tiga putra', 'wisma mecca', 'gudang', 'bengkulu', 'nasi', 'pecel', 'pempek', 'grosir'
                ];

                // Cek pencocokan ketat untuk singkatan (harus satu kata utuh)
                const isStrictExcluded = exclusionsStrict.some(ex => {
                    const regex = new RegExp(`\\b${ex}\\b`, 'i');
                    return regex.test(n) || n === ex;
                });

                // Cek pencocokan longgar (substring di mana saja dalam nama)
                const isLooseExcluded = exclusionsLoose.some(ex => n.includes(ex));

                const isExcluded = isStrictExcluded || isLooseExcluded;

                if (n.includes('kos')) {
                    console.log('DEBUG KOS:', n, 'isLooseExcluded:', isLooseExcluded, 'isExcluded:', isExcluded);
                }

                return !hardcodedNames.has(n) &&
                    item.name !== 'Gedung Tanpa Nama' &&
                    item.name !== 'yes' &&
                    item.name.length > 3 &&
                    !isExcluded;
            }).map(item => ({
                id: item.id,
                name: item.name,
                category: 'Lainnya (OSM)',
                lat: item.center[0],
                lon: item.center[1]
            }));
            all = [...all, ...osmExtra];
        }

        // Filter duplikat yang titiknya persis sama atau sangat berdekatan (4 desimal ~11 meter)
        // Serta dedupikasi nama khusus untuk ATM (contoh: ATM BNI;MasterCard -> ATM BNI)
        const uniqueCoords = new Set();
        const uniqueNames = new Set();
        const uniqueAll = [];

        for (const b of all) {
            // Normalisasi nama ATM untuk deduplikasi (ambil kata sebelum titik koma)
            let normName = b.name;
            if (normName.toUpperCase().includes('ATM')) {
                normName = normName.split(';')[0].trim().toUpperCase();
            }

            const coordKey = `${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;

            // Jika koordinat belum ada DAN (bukan ATM ATAU nama ATM belum ada)
            if (!uniqueCoords.has(coordKey)) {
                if (!normName.includes('ATM') || !uniqueNames.has(normName)) {
                    uniqueCoords.add(coordKey);
                    if (normName.includes('ATM')) uniqueNames.add(normName);

                    // Bersihkan nama ATM yang panjang saat disimpan
                    if (b.name.includes(';')) {
                        b.name = b.name.split(';')[0].trim();
                    }
                    uniqueAll.push(b);
                }
            }
        }
        all = uniqueAll;

        // Kelompokkan per kategori
        const grouped = {};
        all.forEach(b => {
            if (!grouped[b.category]) grouped[b.category] = [];
            grouped[b.category].push({
                id: b.id,
                name: b.name,
                category: b.category,
                center: [b.lat, b.lon],
                geometry: { type: 'Point', coordinates: [b.lon, b.lat] }
            });
        });

        res.json({
            total: all.length,
            grouped,
            all: all.map(b => ({
                id: b.id,
                name: b.name,
                category: b.category,
                center: [b.lat, b.lon],
                geometry: { type: 'Point', coordinates: [b.lon, b.lat] }
            }))
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch buildings' });
    }
});

// ============================================================
// Search Campus - filter lokal dari cache gedung
// ============================================================
app.get('/api/search-campus', (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Query parameter "q" is required' });

    try {
        const lowerQuery = query.toLowerCase();

        // Cari di data hardcoded dulu
        let results = UNIB_BUILDINGS.filter(b =>
            b.name.toLowerCase().includes(lowerQuery) ||
            b.category.toLowerCase().includes(lowerQuery)
        ).map(b => ({
            id: b.id,
            name: b.name,
            fullName: `${b.name} — ${b.category}`,
            category: b.category,
            center: [b.lat, b.lon],
            geometry: { type: 'Point', coordinates: [b.lon, b.lat] }
        }));

        if (osmCampusData.length > 0) {
            const exclusionsStrict = ['dr.', 'drg', 'bni', 'bri', 'bca', 'meps', 'atm'];
            const exclusionsLoose = [
                'pondok', 'kontrakan', 'kos', 'spbu', 'tino galo', 'toko', 'warung', 'rstg', 'rumah sakit',
                'klinik', 'apotek', 'cirrus', 'link', 'prima', 'mastercard', 'visa', 'mandiri', 'bank', 'laundry'
            ];
            const hardcodedNames = new Set(results.map(r => r.name.toLowerCase()));
            const osmResults = osmCampusData.filter(item => {
                const n = item.name.toLowerCase();

                const isStrictExcluded = exclusionsStrict.some(ex => {
                    const regex = new RegExp(`\\b${ex}\\b`, 'i');
                    return regex.test(n) || n === ex;
                });
                const isLooseExcluded = exclusionsLoose.some(ex => n.includes(ex));
                const isExcluded = isStrictExcluded || isLooseExcluded;

                return n.includes(lowerQuery) &&
                    !hardcodedNames.has(n) &&
                    item.name !== 'Gedung Tanpa Nama' &&
                    item.name !== 'yes' &&
                    !isExcluded;
            }).map(item => ({
                id: item.id,
                name: item.name,
                fullName: item.name + ' (OSM)',
                category: 'Lainnya (OSM)',
                center: item.center,
                geometry: item.geometry
            }));
            results = [...results, ...osmResults];
        }

        // Hapus duplikat koordinat dan dedupikasi nama ATM
        const uniqueCoords = new Set();
        const uniqueNames = new Set();
        const uniqueResults = [];

        for (const r of results) {
            let normName = r.name;
            if (normName.toUpperCase().includes('ATM')) {
                normName = normName.split(';')[0].trim().toUpperCase();
            }

            const coordKey = `${r.center[0].toFixed(4)},${r.center[1].toFixed(4)}`;

            if (!uniqueCoords.has(coordKey)) {
                if (!normName.includes('ATM') || !uniqueNames.has(normName)) {
                    uniqueCoords.add(coordKey);
                    if (normName.includes('ATM')) uniqueNames.add(normName);

                    if (r.name.includes(';')) {
                        r.name = r.name.split(';')[0].trim();
                        r.fullName = r.name + ' (OSM)';
                    }
                    uniqueResults.push(r);
                }
            }
        }
        results = uniqueResults;

        res.json({ results: results.slice(0, 20) });
    } catch (err) {
        console.error("Search API Error:", err);
        res.status(500).json({ error: 'Search failed', details: err.message });
    }
});

// ============================================================
// Overpass API Cache (data tambahan dari OSM)
// ============================================================
let osmCampusData = [];

async function prefetchOSMData() {
    console.log("Fetching campus building data from OSM Overpass API...");
    const overpassQuery = `
        [out:json][timeout:30];
        (
          node["name"]["building"](-3.768, 102.258, -3.748, 102.290);
          way["name"]["building"](-3.768, 102.258, -3.748, 102.290);
          node["name"]["amenity"](-3.768, 102.258, -3.748, 102.290);
          way["name"]["amenity"](-3.768, 102.258, -3.748, 102.290);
          node["name"]["office"](-3.768, 102.258, -3.748, 102.290);
          way["name"]["office"](-3.768, 102.258, -3.748, 102.290);
        );
        out center;
    `;

    try {
        const fetch = require('node-fetch');
        const url = process.env.OVERPASS_API_URL || `https://overpass-api.de/api/interpreter`;
        const params = new URLSearchParams();
        params.append('data', overpassQuery);

        const response = await fetch(url, {
            method: 'POST',
            body: params,
            headers: {
                'User-Agent': 'UniversitasBengkuluMapApp/1.0 (education-project)'
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data && data.elements) {
                osmCampusData = data.elements
                    .filter(item => item.tags && item.tags.name && item.tags.name.length > 2)
                    .map(item => {
                        const lat = item.type === 'node' ? item.lat : (item.center ? item.center.lat : null);
                        const lon = item.type === 'node' ? item.lon : (item.center ? item.center.lon : null);
                        if (!lat || !lon) return null;

                        // Strict filter using Campus Boundary Point-in-Polygon check!
                        if (!isPointInCampus(lat, lon)) return null;

                        const name = item.tags.name;
                        return {
                            id: `osm-${item.type}-${item.id}`,
                            name: name,
                            fullName: name,
                            source: 'osm-overpass',
                            center: [lat, lon],
                            geometry: { type: 'Point', coordinates: [lon, lat] }
                        };
                    }).filter(Boolean);
                console.log(`Cached ${osmCampusData.length} buildings from OSM Overpass.`);
            }
        } else {
            console.error("Overpass fetch failed:", response.status, response.statusText);
        }
    } catch (err) {
        console.error("Overpass API Error:", err.message);
    }
}

app.listen(port, () => {
    console.log(`Backend server running on http://localhost:${port}`);
    prefetchOSMData();
});
