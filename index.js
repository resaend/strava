import express from 'express';
import cors from 'cors';
// bodyParser sudah deprecated untuk Express 4.16.0+, express.json() dan express.urlencoded() adalah penggantinya.
// Jika Anda menggunakan Express versi lama, bodyParser mungkin masih relevan.
// import bodyParser from 'body-parser'; 
import { create } from 'xmlbuilder2';

const app = express();
const port = 4000;

// Middleware
app.use(cors()); // Mengizinkan Cross-Origin Resource Sharing

// Menggunakan middleware bawaan Express untuk parsing JSON dan URL-encoded data
app.use(express.json({ limit: '10mb' })); // Untuk parsing application/json
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Untuk parsing application/x-www-form-urlencoded

app.get('/', (req, res) => {
  res.send('Backend GPX Generator is running. Use POST /generate-gpx to generate GPX files.');
});

// Fungsi Haversine untuk menghitung jarak
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371000; // Radius Bumi dalam meter
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // dalam meter
}

app.post('/generate-gpx', (req, res) => {
  console.log('--- Menerima permintaan /generate-gpx ---');
  console.log('Parsed Body (req.body):', JSON.stringify(req.body, null, 2)); 

  const { points, activityDetails, heartRateData, cadenceData } = req.body;

  // Validasi input krusial
  if (!points || !Array.isArray(points) || points.length < 2) {
    return res.status(400).json({ message: 'Array "points" dibutuhkan dengan minimal 2 titik.' });
  }
  if (!activityDetails || typeof activityDetails !== 'object') {
    return res.status(400).json({ message: 'Objek "activityDetails" dibutuhkan.' });
  }
  if (!activityDetails.startDate || !activityDetails.startTime) {
    return res.status(400).json({ message: 'Field "startDate" dan "startTime" dalam activityDetails dibutuhkan.' });
  }
  if (typeof activityDetails.startDate !== 'string' || typeof activityDetails.startTime !== 'string') {
    return res.status(400).json({ message: '"startDate" dan "startTime" harus berupa string.' });
  }
   if (!/^\d{4}-\d{2}-\d{2}$/.test(activityDetails.startDate)) { // Validasi format YYYY-MM-DD
    return res.status(400).json({ message: 'Format "startDate" harus YYYY-MM-DD.' });
  }
  if (!/^\d{2}:\d{2}$/.test(activityDetails.startTime)) { // Validasi format HH:MM
    return res.status(400).json({ message: 'Format "startTime" harus HH:MM.' });
  }

  const activityName = activityDetails.activityName || 'Generated Activity'; // Ambil nama aktivitas
  const creatorName = activityDetails.watchBrand || 'FakeMyRun GPXGenerator'; // Gunakan merk jam atau nama aplikasi
  console.log(`Merk Jam diterima (untuk creator): ${activityDetails.watchBrand}, Creator yang akan digunakan: ${creatorName}`);


  let initialTimestamp;
  try {
    // Menggabungkan tanggal dan waktu, diasumsikan sebagai UTC jika tidak ada info zona waktu eksplisit dari klien
    // Format yang diterima oleh new Date() bisa bervariasi, YYYY-MM-DDTHH:MM:SSZ adalah yang paling aman.
    initialTimestamp = new Date(`${activityDetails.startDate}T${activityDetails.startTime}:00Z`); // Menambahkan Z untuk menandakan UTC
    if (isNaN(initialTimestamp.getTime())) {
      throw new Error('Tanggal atau waktu mulai tidak valid setelah digabung.');
    }
  } catch (e) {
    console.error("Error parsing date/time:", e.message);
    return res.status(400).json({ message: `Format tanggal/waktu tidak valid: ${activityDetails.startDate} ${activityDetails.startTime}. Gunakan YYYY-MM-DD dan HH:MM (diasumsikan UTC). Error: ${e.message}` });
  }
  
  const activityType = (activityDetails.activityType || 'running').toLowerCase();
  // Ambil speedKmh dari activityDetails, jika tidak ada atau tidak valid, default ke 10
  const speedKmh = typeof activityDetails.speedKmh === 'number' && activityDetails.speedKmh > 0 
                   ? activityDetails.speedKmh 
                   : 10; 
  const speedMps = speedKmh * 1000 / 3600; // konversi km/jam ke m/detik

  try {
    const gpxRoot = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('gpx', {
        version: '1.1',
        creator: creatorName, // Menggunakan variabel creatorName
        xmlns: 'http://www.topografix.com/GPX/1/1',
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        'xsi:schemaLocation':
          'http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd ' +
          'http://www.garmin.com/xmlschemas/GpxExtensions/v3 http://www.garmin.com/xmlschemas/GpxExtensionsv3.xsd ' +
          'http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd',
        'xmlns:gpxtpx': 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1',
        'xmlns:gpxx': 'http://www.garmin.com/xmlschemas/GpxExtensions/v3',
      });

    const metadataNode = gpxRoot.ele('metadata');
    metadataNode.ele('name').txt(activityName).up(); // Tambahkan nama aktivitas di metadata
    metadataNode.ele('time').txt(initialTimestamp.toISOString()).up();
    if (activityDetails.description) { // Tambahkan deskripsi jika ada
        metadataNode.ele('desc').txt(activityDetails.description).up();
    }
    // metadataNode.up(); // Tidak perlu .up() jika sudah selesai dengan metadata

    const trkNode = gpxRoot.ele('trk');
    trkNode.ele('name').txt(activityName).up(); // Nama trek bisa sama dengan nama aktivitas
    trkNode.ele('type').txt(activityType).up(); 

    const trksegNode = trkNode.ele('trkseg');
    let currentTime = new Date(initialTimestamp.getTime());

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      // Validasi minimal untuk setiap titik
      if (typeof point.lat !== 'number' || typeof point.lon !== 'number') {
        console.warn(`Melewatkan titik tidak valid pada indeks ${i}:`, point);
        continue; // Lewati titik yang tidak valid
      }

      const elevation = typeof point.alt === 'number' ? point.alt : 50.0; // Default elevasi jika tidak ada

      // Hitung waktu untuk titik ini berdasarkan jarak dan kecepatan
      if (i > 0) {
        const prevPoint = points[i-1];
        // Pastikan prevPoint juga valid sebelum menghitung jarak
        if (prevPoint && typeof prevPoint.lat === 'number' && typeof prevPoint.lon === 'number') {
            const dist = haversineDistance(prevPoint.lat, prevPoint.lon, point.lat, point.lon);
            // Hindari pembagian dengan nol jika speedMps adalah 0
            const timeIncrementSeconds = speedMps > 0 ? dist / speedMps : 1; // Tambah 1 detik jika kecepatan 0 atau tidak valid
            currentTime = new Date(currentTime.getTime() + Math.round(timeIncrementSeconds * 1000));
        } else {
             // Jika titik sebelumnya tidak valid, tambahkan interval default untuk menjaga urutan waktu
            currentTime = new Date(currentTime.getTime() + 1000); // Tambah 1 detik
        }
      } else {
        // Untuk titik pertama, waktunya adalah initialTimestamp
        currentTime = new Date(initialTimestamp.getTime());
      }

      const trkptNode = trksegNode.ele('trkpt', { lat: point.lat.toFixed(7), lon: point.lon.toFixed(7) });
      trkptNode.ele('ele').txt(elevation.toFixed(1)).up();
      trkptNode.ele('time').txt(currentTime.toISOString()).up();

      // Cek apakah heartRateData dan cadenceData ada dan merupakan array
      const hrValue = (heartRateData && Array.isArray(heartRateData) && heartRateData[i] !== undefined && heartRateData[i] !== null) 
                      ? heartRateData[i] 
                      : null;
      const cadValue = (cadenceData && Array.isArray(cadenceData) && cadenceData[i] !== undefined && cadenceData[i] !== null) 
                       ? cadenceData[i] 
                       : null;

      if (hrValue !== null || cadValue !== null) {
        const extensionsNode = trkptNode.ele('extensions');
        const trackPointExtensionNode = extensionsNode.ele('gpxtpx:TrackPointExtension');
        if (hrValue !== null) {
          trackPointExtensionNode.ele('gpxtpx:hr').txt(String(hrValue)).up();
        }
        if (cadValue !== null) {
          trackPointExtensionNode.ele('gpxtpx:cad').txt(String(cadValue)).up();
        }
        // Tidak perlu .up() di sini jika ini elemen terakhir dalam parent masing-masing
      }
    }

    const xml = gpxRoot.end({ prettyPrint: true });
    
    console.log('GPX XML berhasil dibuat.');

    res.setHeader('Content-Type', 'application/gpx+xml');
    // Membuat nama file yang lebih aman dan deskriptif
    const safeActivityName = activityName.replace(/[^\w.-]/g, '_'); // Ganti karakter tidak aman
    const filename = `${safeActivityName}_${activityDetails.startDate}_${Date.now()}.gpx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xml);

  } catch (error) {
    console.error('Error internal saat membuat GPX:', error);
    // Kirim respons error yang lebih informatif ke klien jika memungkinkan
    res.status(500).json({ message: 'Gagal membuat file GPX karena kesalahan server.', error: error instanceof Error ? error.message : String(error) });
  }
});

app.listen(port, () => {
  console.log(`Backend GPX generator berjalan di http://localhost:${port}`);
});
