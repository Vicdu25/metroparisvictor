import fs from "fs";
import path from "path";
import readline from "readline";

const GTFS_DIR = "./gtfs";
const OUTPUT_FILE = "./public/metroGraph.json";
const TRANSFER_OUTPUT_FILE = "./public/transferTimes.json";


function parseCSVLine(line) {
  const result = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function clean(value) {
  return value?.replaceAll('"', "").trim();
}

function loadCSV(fileName) {
  const content = fs.readFileSync(path.join(GTFS_DIR, fileName), "utf-8");
  const lines = content.trim().split(/\r?\n/);
  const headers = parseCSVLine(lines[0]).map(clean);

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = clean(values[index]);
    });

    return row;
  });
}

function toNumber(value) {
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

const routes = loadCSV("routes.txt");
const trips = loadCSV("trips.txt");
const stops = loadCSV("stops.txt");
const transfers = loadCSV("transfers.txt");


const metroRoutes = routes.filter((route) => {
  const name = `${route.route_short_name} ${route.route_long_name}`.toLowerCase();

  return (
    name.includes("metro") ||
    name.includes("métro") ||
    route.route_type === "1"
  );
});

const metroRouteIds = new Set(metroRoutes.map((route) => route.route_id));

const routeById = {};
routes.forEach((route) => {
  routeById[route.route_id] = route;
});

const metroTripIds = new Set();
const tripLineById = {};

trips.forEach((trip) => {
  if (metroRouteIds.has(trip.route_id)) {
    const route = routeById[trip.route_id];

    const line =
      route?.route_short_name ||
      route?.route_long_name ||
      "Métro";

    metroTripIds.add(trip.trip_id);
    tripLineById[trip.trip_id] = line;
  }
});

const stopById = {};
const stopDataById = {};
const linesByStopId = {};

stops.forEach((stop) => {
  const stopId = stop.stop_id;

  stopById[stopId] = stop.stop_name;

  stopDataById[stopId] = {
    name: stop.stop_name,
    lat: toNumber(stop.stop_lat),
    lon: toNumber(stop.stop_lon),
  };
});

const stopTimesByTrip = {};

console.log("Lecture de stop_times.txt ligne par ligne...");

const fileStream = fs.createReadStream(path.join(GTFS_DIR, "stop_times.txt"));

const rl = readline.createInterface({
  input: fileStream,
  crlfDelay: Infinity,
});

let headers = [];
let lineCount = 0;

for await (const line of rl) {
  lineCount++;

  if (lineCount === 1) {
    headers = parseCSVLine(line).map(clean);
    continue;
  }

  const values = parseCSVLine(line);
  const row = {};

  headers.forEach((header, index) => {
    row[header] = clean(values[index]);
  });

  if (!metroTripIds.has(row.trip_id)) continue;

  if (!stopTimesByTrip[row.trip_id]) {
    stopTimesByTrip[row.trip_id] = [];
  }

  stopTimesByTrip[row.trip_id].push(row);
}

Object.entries(stopTimesByTrip).forEach(([tripId, times]) => {
  const line = tripLineById[tripId];

  times.forEach((time) => {
    const stopId = time.stop_id;

    if (!linesByStopId[stopId]) {
      linesByStopId[stopId] = new Set();
    }

    linesByStopId[stopId].add(line);
  });
});

const graph = {};
const segmentTimes = {};

function addSegmentTime(from, to, line, time, fromStop, toStop) {
  if (!from || !to || from === to) return;

  if (!Number.isFinite(time)) return;

  const key = `${from}__${to}__${line}`;

  if (!segmentTimes[key]) {
    segmentTimes[key] = {
      from,
      to,
      line,
      times: [],
      fromLat: fromStop?.lat,
      fromLon: fromStop?.lon,
      toLat: toStop?.lat,
      toLon: toStop?.lon,
    };
  }

  if (time >= 0.5 && time <= 8) {
  segmentTimes[key].times.push(time);
}
}

function timeToSeconds(value) {
  const [hours, minutes, seconds] = value.split(":").map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

function getTravelTimeMinutes(currentStopTime, nextStopTime) {
  const departure = timeToSeconds(currentStopTime.departure_time);
  const arrival = timeToSeconds(nextStopTime.arrival_time);

  const diffSeconds = arrival - departure;

  if (!Number.isFinite(diffSeconds) || diffSeconds <= 0) {
    return 2;
  }

  return Math.max(1, Math.round(diffSeconds / 60));
}

Object.entries(stopTimesByTrip).forEach(([tripId, times]) => {
  const line = tripLineById[tripId];

  times.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));

  for (let i = 0; i < times.length - 1; i++) {
    const fromId = times[i].stop_id;
    const toId = times[i + 1].stop_id;

    const from = stopById[fromId];
    const to = stopById[toId];

    const fromStop = stopDataById[fromId];
    const toStop = stopDataById[toId];

    const travelTime = getTravelTimeMinutes(times[i], times[i + 1]);

addSegmentTime(from, to, line, travelTime, fromStop, toStop);
addSegmentTime(to, from, line, travelTime, toStop, fromStop);
  }
});

function average(values) {
  if (values.length === 0) return 2;

  const sorted = [...values].sort((a, b) => a - b);

  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;

  const min = q1 - 1.5 * iqr;
  const max = q3 + 1.5 * iqr;

  const filtered = sorted.filter((value) => value >= min && value <= max);
  const finalValues = filtered.length > 0 ? filtered : sorted;

  const sum = finalValues.reduce((total, value) => total + value, 0);
  const averageMinutes = sum / finalValues.length;

  return Math.max(0.5, Math.round(averageMinutes * 10) / 10);
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const radius = 6371;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateMetroTimeMinutes(fromStop, toStop) {
  if (!fromStop || !toStop) return 2;

  const distance = distanceKm(
    fromStop.lat,
    fromStop.lon,
    toStop.lat,
    toStop.lon
  );

  const averageSpeedKmH = 28;
  const rawMinutes = (distance / averageSpeedKmH) * 60;

  return Math.max(1, Math.min(4, Math.round(rawMinutes)));
}

Object.values(segmentTimes).forEach((segment) => {
  const finalTime = average(segment.times);

  if (!graph[segment.from]) {
    graph[segment.from] = [];
  }

  graph[segment.from].push({
    station: segment.to,
    line: segment.line,
    time: finalTime,
    fromLat: segment.fromLat,
    fromLon: segment.fromLon,
    toLat: segment.toLat,
    toLon: segment.toLon,
  });
});

const transferTimes = {};

transfers.forEach((transfer) => {
  const fromStopId = transfer.from_stop_id;
  const toStopId = transfer.to_stop_id;

  const fromStation = stopById[fromStopId];
  const toStation = stopById[toStopId];

  if (!fromStation || !toStation) return;

  if (fromStation !== toStation) return;

  const fromLines = [...(linesByStopId[fromStopId] || [])];
  const toLines = [...(linesByStopId[toStopId] || [])];

  if (fromLines.length === 0 || toLines.length === 0) return;

  const seconds = Number(transfer.min_transfer_time);

  if (!Number.isFinite(seconds) || seconds <= 0) return;

  const minutes = Math.max(1, Math.round(seconds / 60));

  fromLines.forEach((fromLine) => {
    toLines.forEach((toLine) => {
      const cleanFromLine = fromLine;
      const cleanToLine = toLine;

      if (cleanFromLine === cleanToLine) return;

      const key = `${fromStation}|${cleanFromLine}|${cleanToLine}`;

      if (
        transferTimes[key] === undefined ||
        minutes < transferTimes[key]
      ) {
        transferTimes[key] = minutes;
      }
    });
  });
});

fs.writeFileSync(
  TRANSFER_OUTPUT_FILE,
  JSON.stringify(transferTimes, null, 2),
  "utf-8"
);

console.log("Correspondances générées :", TRANSFER_OUTPUT_FILE);
console.log("Nombre de correspondances :", Object.keys(transferTimes).length);

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(graph, null, 2), "utf-8");

console.log("Graphe généré :", OUTPUT_FILE);
console.log("Nombre de stations :", Object.keys(graph).length);
console.log("Exemple :", Object.entries(graph)[0]);