import "./style.css";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import transferTimes from "../public/transferTimes.json";
import * as turf from "@turf/turf";

let arrondissementGeoJson = null;

fetch("/paris_arrondissements.geojson")
  .then((res) => res.json())
  .then((data) => {
    arrondissementGeoJson = data;
  });

let graph = {};
let start;
let end;
let startTime = null;
const ROUND_DURATION = 30;
const MIN_WAIT_TIME = 1;
const MAX_WAIT_TIME = 4;
const DEFAULT_WAIT_TIME = 2;
const WALKING_SPEED_KMH = 4.5;
const MAX_WALKING_MINUTES = 15;
let timeLeft = ROUND_DURATION;
let timerId = null;
let roundEnded = false;

let selectedLines = [];

const TOTAL_ROUNDS = 5;

let gameStarted = false;
let currentRound = 0;
let roundScores = [];

const METRO_LINES = [
  "1", "2", "3", "3bis", "4", "5", "6", "7", "7bis", "8", "9", "10", "11", "12", "13", "14"
];

const RER_LINES = ["A", "B", "C", "D", "E"];


const TEST_START = null;
const TEST_END = null;

const DEFAULT_TRANSFER_TIME = 5;

const TRANSFER_TIME_BY_STATION = {
  "Châtelet": 7,
  "Montparnasse Bienvenue": 8,
  "République": 5,
  "Gare de Lyon": 6,
  "Saint-Lazare": 6,
  "La Motte-Picquet - Grenelle": 4,
  "Trocadéro": 4,
  "Place de Clichy": 4,
};

fetch("/metroGraph.json")
  .then((res) => res.json())
  .then((data) => {
    graph = data;

    initGame();
  });

function getStationDistrict(stationName) {
  if (!arrondissementGeoJson) return null;

  const coords = getStationCoordinates(stationName);

  if (!coords) return null;

  const point = turf.point([coords.lon, coords.lat]);

  for (const feature of arrondissementGeoJson.features) {
    if (turf.booleanPointInPolygon(point, feature)) {
      return feature.properties.l_ar;
    }
  }

  return null;
}

function formatStationName(station) {
  const district = getStationDistrict(station);

  if (!district) {
    return station;
  }

  const match = district.match(/\d+/);

  if (!match) {
    return station;
  }

  return `${station} (${match[0]}e)`;

function getRandomStation() {
  const stations = Object.keys(graph);
  return stations[Math.floor(Math.random() * stations.length)];
}

function findStation(search) {
  return Object.keys(graph).filter((station) =>
    station.toLowerCase().includes(search.toLowerCase())
  );
}

function getTransferTime(station, previousLine, nextLine) {
  if (!previousLine || previousLine === nextLine) {
    return 0;
  }

  const cleanStation = station.replaceAll('"', "").trim();
  const fromLine = normalizeLine(previousLine);
  const toLine = normalizeLine(nextLine);

  const key = `${cleanStation}|${fromLine}|${toLine}`;

  const walkingTransferTime =
    transferTimes[key] !== undefined
      ? transferTimes[key]
      : DEFAULT_TRANSFER_TIME;

  const waitTime =
  MIN_WAIT_TIME +
  (Math.abs((fromLine + toLine + cleanStation).length) %
    (MAX_WAIT_TIME - MIN_WAIT_TIME + 1));

  return walkingTransferTime + waitTime;
}

function initGame() {
  selectedLines = [];
  currentRound = 0;
  roundScores = [];
  gameStarted = false;
  roundEnded = true;
  clearInterval(timerId);

  renderStartScreen();
}

function startGame() {
  gameStarted = true;
  currentRound = 1;
  roundScores = [];

  startRound();
}

function startRound() {
  selectedLines = [];

  start = "Père Lachaise";

  end = getRandomStation();

  while (end === start) {
    end = getRandomStation();
  }
  startTime = Date.now();
  startTimer();
  render();
}

function goToNextRound() {
  if (currentRound >= TOTAL_ROUNDS) {
    renderFinalScore();
    return;
  }

  currentRound++;
  startRound();
}

function startTimer() {
  clearInterval(timerId);

  timeLeft = ROUND_DURATION;
  roundEnded = false;

  timerId = setInterval(() => {
    timeLeft--;

    const timerElement = document.querySelector("#timer");
    if (timerElement) {
      timerElement.textContent = timeLeft;
    }

    if (timeLeft <= 0) {
      clearInterval(timerId);
      roundEnded = true;
      handleTimeout();
    }
  }, 1000);
}

function handleTimeout() {
  const optimal = shortestPath(start, end);
  const optimalLines = normalizeLines(optimal.lines);

  document.querySelector("#result").innerHTML = `
    <strong>Temps écoulé.</strong><br>
    <strong>Score :</strong> 0 / 100<br><br>

    <strong>Solution optimale</strong><br>
    <strong>Temps total optimal :</strong> ${Math.round(optimal.totalTime)} min<br>
    <strong>Lignes optimales :</strong> ${optimalLines.join(" / ")}<br>
    <strong>Chemin optimal :</strong> ${optimal.path.join(" → ")}
  `;
}

function addSelectedLine(line) {
  if (roundEnded) return;

  selectedLines.push(normalizeLine(line));
  render();
}

function removeSelectedLine(index) {
  if (roundEnded) return;

  selectedLines.splice(index, 1);
  render();
}

function renderSelectedLines() {
  if (selectedLines.length === 0) {
    return `<p class="empty-selection">Aucune ligne sélectionnée</p>`;
  }

  return `
    <div class="selected-lines">
      ${selectedLines
        .map(
          (line, index) => `
            <button class="selected-line metro-line line-${line}" data-index="${index}">
  <img 
  src="/metro-icons/${getLineIconName(line)}.svg"
  alt="Ligne ${line}"
  class="metro-icon"
/>
</button>
            ${index < selectedLines.length - 1 ? `<span class="line-arrow">→</span>` : ""}
          `
        )
        .join("")}
    </div>
  `;
}
function getLineIconName(line) {
  const normalized = normalizeLine(line);

  if (normalized === "3bis") return "3B";
  if (normalized === "7bis") return "7B";

  if (["a", "b", "c", "d", "e"].includes(normalized)) {
    return normalized;
  }

  return normalized;
}

function renderLineButtons(lines, type) {
  return `
    <div class="line-grid ${type}-grid">
      ${lines
        .map((line) => {
          const normalized = normalizeLine(line);
          const isSelected = selectedLines.includes(normalized);

          return `
            <button
              class="line-button ${isSelected ? "disabled-line" : ""}"
              data-line="${line}"
              ${isSelected ? "disabled" : ""}
            >
              <img
                src="/metro-icons/${getLineIconName(line)}.svg"
                alt="Ligne ${line}"
                class="metro-icon"
              />
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderStartScreen() {
  document.querySelector("#app").innerHTML = `
    <main class="page">
      <section class="game-card start-card">
        <p class="eyebrow">Metro Game TEEEEST</p>
        <h1>5 manches pour trouver les meilleurs trajets</h1>
        <p class="start-description">
          Sélectionne les lignes à emprunter dans le bon ordre. Chaque manche est notée sur 100 points.
        </p>

        <button id="start-game" class="primary-button start-button">
          Lancer une partie
        </button>
      </section>
    </main>
  `;

  document.querySelector("#start-game").addEventListener("click", startGame);
}

function render() {
  document.querySelector("#app").innerHTML = `
    <main class="page">
      <section class="game-card">
        <div class="header">
          <div>
            <p class="eyebrow">Metro Game</p>

            <p class="round-indicator">Manche ${currentRound} / ${TOTAL_ROUNDS}</p>
            <h1>Trouve le meilleur itinéraire</h1>
          </div>

          <div class="timer">
            <span id="timer">${timeLeft}</span>s
          </div>
        </div>

        <div class="stations">
          <div class="station">
            <span>Départ</span>
            <strong>${formatStationName(start)}</strong>
          </div>
          <div class="station">
            <span>Arrivée</span>
            <strong>${formatStationName(end)}</strong>
          </div>
        </div>

        <div class="selection-zone">
          <p class="section-title">Ton itinéraire</p>
          ${renderSelectedLines()}
        </div>

        <div class="lines-zone">
        ${renderLineButtons(METRO_LINES, "metro")}

${renderLineButtons(RER_LINES, "rer")}
</div>

        <div class="actions">
          <button id="validate" class="primary-button">Valider</button>
          <button id="new" class="secondary-button">Nouvelle partie</button>
        </div>

        <div id="result" class="result"></div>
      </section>
    </main>
  `;

  document.querySelector("#validate").addEventListener("click", checkAnswer);
  document.querySelector("#new").addEventListener("click", initGame);

  document.querySelectorAll(".line-button").forEach((button) => {
    button.addEventListener("click", () => {
      addSelectedLine(button.dataset.line);
    });
  });

  document.querySelectorAll(".selected-line").forEach((button) => {
    button.addEventListener("click", () => {
      removeSelectedLine(Number(button.dataset.index));
    });
  });
}

function shortestPath(start, end) {
  const distances = {};
  const previous = {};
  const visited = new Set();

  function makeKey(station, line) {
    return JSON.stringify([station, line]);
  }

  function readKey(key) {
    return JSON.parse(key);
  }

  const startKey = makeKey(start, null);
  distances[startKey] = 0;

  while (true) {
    let closestKey = null;

    Object.keys(distances).forEach((key) => {
      if (!visited.has(key)) {
        if (closestKey === null || distances[key] < distances[closestKey]) {
          closestKey = key;
        }
      }
    });

    if (closestKey === null) break;

    const [currentStation, currentLine] = readKey(closestKey);

    if (currentStation === end) break;

    visited.add(closestKey);

    const edges = graph[currentStation] || [];

    edges.forEach((edge) => {
      const rideTime = edge.time;
      const transferTime = getTransferTime(
        currentStation,
        currentLine,
        edge.line
      );

      const totalEdgeTime = rideTime + transferTime;
      const nextKey = makeKey(edge.station, edge.line);
      const newDistance = distances[closestKey] + totalEdgeTime;

      if (
        distances[nextKey] === undefined ||
        newDistance < distances[nextKey]
      ) {
        distances[nextKey] = newDistance;

        previous[nextKey] = {
          previousKey: closestKey,
          fromStation: currentStation,
          toStation: edge.station,
          line: edge.line,
          rideTime,
          transferTime,
          transferStation: transferTime > 0 ? currentStation : null,
          fromLat: edge.fromLat,
fromLon: edge.fromLon,
toLat: edge.toLat,
toLon: edge.toLon,
        };
      }
    });
  }

  const possibleEndKeys = Object.keys(distances).filter((key) => {
    const [station] = readKey(key);
    return station === end;
  });

  if (possibleEndKeys.length === 0) {
    return {
      totalTime: Infinity,
      rideTime: 0,
      transferTime: 0,
      path: [],
      lines: [],
      transfers: [],
    };
  }

  const bestEndKey = possibleEndKeys.reduce((bestKey, key) => {
    return distances[key] < distances[bestKey] ? key : bestKey;
  });

  const steps = [];
  let currentKey = bestEndKey;

  while (currentKey !== startKey) {
    const step = previous[currentKey];

    if (!step) {
      return {
        totalTime: Infinity,
        rideTime: 0,
        transferTime: 0,
        path: [],
        lines: [],
        transfers: [],
      };
    }

    steps.unshift(step);
    currentKey = step.previousKey;
  }

  const path = [start];
  const lines = [];
  const transfers = [];

  let totalRideTime = 0;
  let totalTransferTime = 0;

  steps.forEach((step) => {
    path.push(step.toStation);
    totalRideTime += step.rideTime;
    totalTransferTime += step.transferTime;

    if (lines[lines.length - 1] !== step.line) {
      lines.push(step.line);
    }

    if (step.transferTime > 0) {
      transfers.push({
        station: step.transferStation,
        time: step.transferTime,
      });
    }
  });
const stepLines = steps.map((step) => normalizeLine(step.line));

const mapSteps = steps.map((step) => ({
  line: normalizeLine(step.line),
  fromLat: step.fromLat,
  fromLon: step.fromLon,
  toLat: step.toLat,
  toLon: step.toLon,
}));
 return {
  totalTime: distances[bestEndKey],
  rideTime: totalRideTime,
  transferTime: totalTransferTime,
  path,
  lines,
  transfers,
  stepLines,
  mapSteps,
};

}

function normalizeLine(line) {
  return line
    .toLowerCase()
    .replaceAll("métro", "")
    .replaceAll("metro", "")
    .replaceAll("ligne", "")
    .replaceAll("line", "")
    .replaceAll("m", "")
    .replaceAll('"', "")
    .replace(/^0+/, "")
    .trim();
}

function parsePlayerAnswer(value) {
  return value
    .split("/")
    .map((line) => normalizeLine(line))
    .filter(Boolean);
}

function normalizeLines(lines) {
  return lines
    .map((line) => normalizeLine(line))
    .filter(Boolean);
}

function sameOrderedLines(playerLines, optimalLines) {
  return playerLines.join("/") === optimalLines.join("/");
}


function hasExtraOrMissingLines(playerLines, optimalLines) {
  const missing = optimalLines.filter((line) => !playerLines.includes(line));
  const extra = playerLines.filter((line) => !optimalLines.includes(line));

  return {
    missing,
    extra,
  };
}

function getStationCoordinates(stationName) {
  const edges = graph[stationName] || [];
  const edge = edges.find(
    (edge) =>
      Number.isFinite(edge.fromLat) &&
      Number.isFinite(edge.fromLon)
  );

  if (!edge) return null;

  return {
    lat: edge.fromLat,
    lon: edge.fromLon,
  };
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

function walkingMinutesBetweenStations(fromStation, toStation) {
  const from = getStationCoordinates(fromStation);
  const to = getStationCoordinates(toStation);

  if (!from || !to) return Infinity;

  const distance = distanceKm(from.lat, from.lon, to.lat, to.lon);
  return Math.round((distance / WALKING_SPEED_KMH) * 60);
}

function stationServesLine(station, line) {
  const cleanLine = normalizeLine(line);
  return (graph[station] || []).some(
    (edge) => normalizeLine(edge.line) === cleanLine
  );
}

function getStationsForLine(line) {
  const cleanLine = normalizeLine(line);

  return Object.keys(graph).filter((station) =>
    stationServesLine(station, cleanLine)
  );
}

function findNearestStationOnLine(fromStation, line) {
  const candidates = getStationsForLine(line);

  let best = null;

  candidates.forEach((candidate) => {
    const walkingTime = walkingMinutesBetweenStations(fromStation, candidate);

    if (
      Number.isFinite(walkingTime) &&
      walkingTime <= MAX_WALKING_MINUTES &&
      (!best || walkingTime < best.walkingTime)
    ) {
      best = {
        station: candidate,
        walkingTime,
      };
    }
  });

  return best;
}

function addWalkingStep(route, fromStation, toStation) {
  const walkingTime = walkingMinutesBetweenStations(fromStation, toStation);

  if (!Number.isFinite(walkingTime)) return false;

  route.totalTime += walkingTime;
  route.walkingTime = (route.walkingTime || 0) + walkingTime;

  route.path.push(toStation);
  route.lines.push("walk");

  const from = getStationCoordinates(fromStation);
  const to = getStationCoordinates(toStation);

  if (from && to) {
    route.mapSteps.push({
      line: "walk",
      fromLat: from.lat,
      fromLon: from.lon,
      toLat: to.lat,
      toLon: to.lon,
    });
  }

  return true;
}


function calculatePlayerRoute(start, end, playerLines) {
  if (playerLines.length === 0) {
    return {
      possible: false,
      totalTime: Infinity,
      rideTime: 0,
      transferTime: 0,
      path: [],
      lines: [],
      transfers: [],
    };
  }




  function makeKey(station, lineIndex) {
    return JSON.stringify([station, lineIndex]);
  }

  function readKey(key) {
    return JSON.parse(key);
  }

  const distances = {};
  const previous = {};
  const visited = new Set();

  const startKey = makeKey(start, 0);
  distances[startKey] = 0;

  while (true) {
    let closestKey = null;

    Object.keys(distances).forEach((key) => {
      if (!visited.has(key)) {
        if (closestKey === null || distances[key] < distances[closestKey]) {
          closestKey = key;
        }
      }
    });

    if (closestKey === null) break;

    const [currentStation, currentLineIndex] = readKey(closestKey);

    if (
      currentStation === end &&
      currentLineIndex === playerLines.length - 1
    ) {
      break;
    }

    visited.add(closestKey);

    const edges = graph[currentStation] || [];

    edges.forEach((edge) => {
      const edgeLine = normalizeLine(edge.line);
      const currentPlayerLine = playerLines[currentLineIndex];
      const nextPlayerLine = playerLines[currentLineIndex + 1];

      let nextLineIndex = null;
      let transferTime = 0;

      if (edgeLine === currentPlayerLine) {
        nextLineIndex = currentLineIndex;
      } else if (
        nextPlayerLine &&
        edgeLine === nextPlayerLine
      ) {
        nextLineIndex = currentLineIndex + 1;
        transferTime = getTransferTime(
          currentStation,
          currentPlayerLine,
          nextPlayerLine
        );
      } else {
        return;
      }

      const nextKey = makeKey(edge.station, nextLineIndex);
      const rideTime = edge.time;
      const totalEdgeTime = rideTime + transferTime;
      const newDistance = distances[closestKey] + totalEdgeTime;

      if (
        distances[nextKey] === undefined ||
        newDistance < distances[nextKey]
      ) {
        distances[nextKey] = newDistance;

        previous[nextKey] = {
  previousKey: closestKey,
  fromStation: currentStation,
  toStation: edge.station,
  line: edge.line,
  rideTime,
  transferTime,
  transferStation: transferTime > 0 ? currentStation : null,
  lineIndex: nextLineIndex,
  fromLat: edge.fromLat,
  fromLon: edge.fromLon,
  toLat: edge.toLat,
  toLon: edge.toLon,
};
      }
    });
  }

  const endKey = makeKey(end, playerLines.length - 1);



  if (distances[endKey] === undefined) {
    return {
      possible: false,
      totalTime: Infinity,
      rideTime: 0,
      transferTime: 0,
      path: [],
      lines: playerLines,
      transfers: [],
    };
  }

  const steps = [];
  let currentKey = endKey;

  while (currentKey !== startKey) {
    const step = previous[currentKey];

    if (!step) {
      return {
        possible: false,
        totalTime: Infinity,
        rideTime: 0,
        transferTime: 0,
        path: [],
        lines: playerLines,
        transfers: [],
      };
    }

    steps.unshift(step);
    currentKey = step.previousKey;
  }

  const path = [start];
  const lines = [];
  const transfers = [];

  let totalRideTime = 0;
  let totalTransferTime = 0;

  steps.forEach((step) => {
    path.push(step.toStation);

    totalRideTime += step.rideTime;
    totalTransferTime += step.transferTime;

    const cleanLine = normalizeLine(step.line);

    if (lines[lines.length - 1] !== cleanLine) {
      lines.push(cleanLine);
    }

    if (step.transferTime > 0) {
      transfers.push({
        station: step.transferStation,
        time: step.transferTime,
      });
    }
  });
const mapSteps = steps.map((step) => ({
  line: normalizeLine(step.line),
  fromLat: step.fromLat,
  fromLon: step.fromLon,
  toLat: step.toLat,
  toLon: step.toLon,
}));

  return {
    possible: true,
    totalTime: distances[endKey],
    rideTime: totalRideTime,
    transferTime: totalTransferTime,
    path,
    lines,
    transfers,
    mapSteps,
  };
}

  function calculatePlayerRouteWithWalkingFallback(start, end, playerLines) {
  const strictRoute = calculatePlayerRoute(start, end, playerLines);

  if (strictRoute.possible) {
    return {
      ...strictRoute,
      usedWalkingFallback: false,
      walkingTime: 0,
    };
  }

  if (playerLines.length === 0) {
    return strictRoute;
  }

  const firstLine = playerLines[0];
  const lastLine = playerLines[playerLines.length - 1];

  const startFallback = stationServesLine(start, firstLine)
    ? { station: start, walkingTime: 0 }
    : findNearestStationOnLine(start, firstLine);

  const endFallback = stationServesLine(end, lastLine)
    ? { station: end, walkingTime: 0 }
    : findNearestStationOnLine(end, lastLine);

  if (!startFallback || !endFallback) {
    return strictRoute;
  }

  const metroRoute = calculatePlayerRoute(
    startFallback.station,
    endFallback.station,
    playerLines
  );

  if (!metroRoute.possible) {
    return strictRoute;
  }

  const totalWalkingTime =
    startFallback.walkingTime + endFallback.walkingTime;

  const mapSteps = [];

  if (startFallback.station !== start) {
    const from = getStationCoordinates(start);
    const to = getStationCoordinates(startFallback.station);

    if (from && to) {
      mapSteps.push({
        line: "walk",
        fromLat: from.lat,
        fromLon: from.lon,
        toLat: to.lat,
        toLon: to.lon,
      });
    }
  }

  mapSteps.push(...metroRoute.mapSteps);

  if (endFallback.station !== end) {
    const from = getStationCoordinates(endFallback.station);
    const to = getStationCoordinates(end);

    if (from && to) {
      mapSteps.push({
        line: "walk",
        fromLat: from.lat,
        fromLon: from.lon,
        toLat: to.lat,
        toLon: to.lon,
      });
    }
  }

  return {
    possible: true,
    usedWalkingFallback: true,
    totalTime: metroRoute.totalTime + totalWalkingTime,
    rideTime: metroRoute.rideTime,
    transferTime: metroRoute.transferTime,
    walkingTime: totalWalkingTime,
    path: [
      start,
      ...(startFallback.station !== start ? [startFallback.station] : []),
      ...metroRoute.path.slice(1),
      ...(endFallback.station !== end ? [end] : []),
    ],
    lines: [
      ...(startFallback.station !== start ? ["walk"] : []),
      ...metroRoute.lines,
      ...(endFallback.station !== end ? ["walk"] : []),
    ],
    transfers: metroRoute.transfers,
    mapSteps,
  };
}

function calculateScore(playerRoute, optimal, elapsedSeconds) {
  if (!playerRoute.possible) {
    return {
      total: 0,
      routeScore: 0,
      speedScore: 0,
      gap: null,
      ratio: null,
    };
  }

  const ratio = playerRoute.totalTime / optimal.totalTime;

  let efficiencyRatio;

  if (ratio <= 1) {
    efficiencyRatio = 1;
  } else if (ratio >= 2) {
    efficiencyRatio = 0;
  } else {
    efficiencyRatio = 2 - ratio;
  }

  const routeScore = Math.round(efficiencyRatio * 80);

  let speedRatio;

if (elapsedSeconds <= 5) {
  speedRatio = 1;
} else if (elapsedSeconds >= ROUND_DURATION) {
  speedRatio = 0;
} else {
  speedRatio = 1 - (elapsedSeconds - 5) / (ROUND_DURATION - 5);
}

const speedScore = Math.round(speedRatio * 20);

  const total = Math.min(100, routeScore + speedScore);

  return {
    total,
    routeScore,
    speedScore,
    gap: playerRoute.totalTime - optimal.totalTime,
    ratio,
  };
}

function getLineColor(line) {
  const colors = {
    "1": "#FFCD00",
    "2": "#003CA6",
    "3": "#837902",
    "3bis": "#6EC4E8",
    "4": "#BE418D",
    "5": "#FF7E2E",
    "6": "#6ECA97",
    "7": "#FA9ABA",
    "7bis": "#6ECA97",
    "8": "#E19BDF",
    "9": "#B6BD00",
    "10": "#C9910D",
    "11": "#704B1C",
    "12": "#007852",
    "13": "#6EC4E8",
    "14": "#62259D",
    "a": "#E2231A",
    "b": "#3B71B8",
    "c": "#F7C600",
    "d": "#008B5A",
    "e": "#C43C95",
    walk: "#475569",
  };

  return colors[normalizeLine(line)] || "#111827";
}

function getRouteSegments(route) {
  const segments = [];

  for (let i = 0; i < route.path.length - 1; i++) {
    segments.push({
      from: route.path[i],
      to: route.path[i + 1],
      line: route.lines[Math.min(i, route.lines.length - 1)] || route.lines[0],
    });
  }

  return segments;
}

function buildSmoothRoutePoints(validSteps) {
  return validSteps.map((step) => [step.fromLat, step.fromLon]).concat([
    [validSteps[validSteps.length - 1].toLat, validSteps[validSteps.length - 1].toLon],
  ]);
}

function animatePolyline(map, points, color, delay = 0) {
  setTimeout(() => {
    let index = 1;

    const polyline = L.polyline([points[0]], {
      color,
      weight: 7,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round",
      smoothFactor: 2,
    }).addTo(map);

    const interval = setInterval(() => {
      if (index >= points.length) {
        clearInterval(interval);
        return;
      }

      polyline.addLatLng(points[index]);
      index++;
    }, 55);
  }, delay);
}

function buildRouteSections(validSteps) {
  const sections = [];

  validSteps.forEach((step) => {
    const line = normalizeLine(step.line);
    const from = [step.fromLat, step.fromLon];
    const to = [step.toLat, step.toLon];

    const lastSection = sections[sections.length - 1];

    if (!lastSection || lastSection.line !== line) {
      sections.push({
        line,
        points: [from, to],
      });
    } else {
      lastSection.points.push(to);
    }
  });

  return sections;
}

function addTransferMarker(map, point, delay) {
  setTimeout(() => {
    const marker = L.circleMarker(point, {
      radius: 11,
      color: "#111827",
      weight: 3,
      fillColor: "#ffffff",
      fillOpacity: 1,
      opacity: 1,
    }).addTo(map);

    const element = marker.getElement();

    if (element) {
      element.classList.add("transfer-marker");
    }
  }, delay);
}

function addLineIconMarker(map, section, delay) {
  if (
    !section ||
    !section.points ||
    section.points.length === 0
  ) {
    return;
  }

  if (normalizeLine(section.line) === "walk") {
    return;
  }

  const middleIndex = Math.floor(section.points.length / 2);
  const point = section.points[middleIndex];

  if (
    !point ||
    !Number.isFinite(point[0]) ||
    !Number.isFinite(point[1])
  ) {
    return;
  }

  setTimeout(() => {
    const icon = L.divIcon({
      className: "route-line-map-icon",
      html: `
        <img
          src="/metro-icons/${getLineIconName(section.line)}.svg"
          alt="Ligne ${section.line}"
        />
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    L.marker(point, {
      icon,
      interactive: false,
    }).addTo(map);
  }, delay);
}s

function animateSection(map, section, delay) {
  const color = getLineColor(section.line);

  setTimeout(() => {
    let index = 1;

    const isWalking = normalizeLine(section.line) === "walk";

const polyline = L.polyline([section.points[0]], {
  color,
  weight: isWalking ? 5 : 11,
  opacity: isWalking ? 0.75 : 0.95,
  lineCap: "round",
  lineJoin: "round",
  smoothFactor: 2.5,
  dashArray: isWalking ? "10 10" : null,
}).addTo(map);

    const interval = setInterval(() => {
      if (index >= section.points.length) {
        clearInterval(interval);

        const element = polyline.getElement();
        if (element) {
          element.style.setProperty("--route-check-color", color);
          element.classList.add("route-section-validated");

          setTimeout(() => {
            element.classList.remove("route-section-validated");
          }, 450);
        }

        return;
      }

      polyline.addLatLng(section.points[index]);
      index++;
    }, 70);
  }, delay);
}

function createRouteMap(elementId, bounds) {
  const map = L.map(elementId, {
  zoomControl: false,
  attributionControl: false,
  dragging: false,
  scrollWheelZoom: false,
  doubleClickZoom: false,
  boxZoom: false,
  keyboard: false,
  tap: false,
  zoomSnap: 0.1,
  zoomDelta: 0.1,
});

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
    maxZoom: 50,
    attribution: "© OpenStreetMap © CARTO",
  }).addTo(map);

  map.setView([48.8566, 2.3522], 11.6);

  return map;
}

function drawRouteOnMap(map, route, initialDelay = 0, onComplete = null) {
  const validSteps = route.mapSteps.filter(
    (step) =>
      Number.isFinite(step.fromLat) &&
      Number.isFinite(step.fromLon) &&
      Number.isFinite(step.toLat) &&
      Number.isFinite(step.toLon)
  );

  if (validSteps.length === 0) {
    if (onComplete) onComplete();
    return;
  }

  const routePoints = validSteps.flatMap((step) => [
    [step.fromLat, step.fromLon],
    [step.toLat, step.toLon],
  ]);

  const routeBounds = L.latLngBounds(routePoints);
  const currentBounds = map.getBounds();

  if (!currentBounds.contains(routeBounds)) {
    const expandedBounds = currentBounds.extend(routeBounds);

    map.fitBounds(expandedBounds, {
      padding: [24, 24],
      maxZoom: map.getZoom(),
    });
  }

  const sections = buildRouteSections(validSteps);

  const firstStep = validSteps[0];
  const lastStep = validSteps[validSteps.length - 1];

  L.circleMarker([firstStep.fromLat, firstStep.fromLon], {
    radius: 8,
    color: "#111827",
    weight: 3,
    fillColor: "#22c55e",
    fillOpacity: 1,
  }).addTo(map);

  L.circleMarker([lastStep.toLat, lastStep.toLon], {
    radius: 8,
    color: "#111827",
    weight: 3,
    fillColor: "#ef4444",
    fillOpacity: 1,
  }).addTo(map);

  let delay = initialDelay;

  sections.forEach((section, index) => {
  animateSection(map, section, delay);

  const sectionDuration = section.points.length * 70 + 450;

  addLineIconMarker(map, section, delay + sectionDuration - 250);

  delay += sectionDuration;

  const nextSection = sections[index + 1];

  if (nextSection) {
    const transferPoint = section.points[section.points.length - 1];
    addTransferMarker(map, transferPoint, delay);
    delay += 450;
  }
});

  if (onComplete) {
    setTimeout(onComplete, delay + 300);
  }
}

function showImpossibleRoute(map) {
  const container = map.getContainer();

  const message = document.createElement("div");
  message.className = "map-impossible-message";
  message.innerHTML = `
    <strong>Trajet impossible</strong>
    <span>Les lignes proposées ne permettent pas de relier les deux stations.</span>
  `;

  container.appendChild(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function animateScoreDetails(overlay, score) {
  const scoreValue = overlay.querySelector("#animated-score-value");
  const scoreBar = overlay.querySelector("#animated-score-bar");
  const scoreMessage = overlay.querySelector("#animated-score-message");

  if (!scoreValue || !scoreBar || !scoreMessage) return;

  scoreValue.textContent = "0 / 100";
  scoreBar.style.width = "0%";

  if (score.total === 0) {
    scoreMessage.textContent = "Trajet impossible : 0 point";
    await wait(900);
    scoreBar.style.width = "0%";
    scoreValue.textContent = "0 / 100";
    return;
  }

  scoreMessage.textContent =
  `Qualité du trajet +${score.routeScore} points`;

scoreBar.style.width = `${score.routeScore}%`;
scoreValue.textContent = `${score.routeScore} / 100`;

  await wait(1200);

  const roundedGap = Math.max(0, Math.round(score.gap || 0));

  scoreMessage.textContent =
  `Temps de réponse +${score.speedScore} points`;

scoreBar.style.width = `${score.total}%`;
scoreValue.textContent = `${score.total} / 100`;

  await wait(1300);

  scoreMessage.textContent = "Score final";
}
function openRouteOverlay(playerRoute, optimalRoute, score, isLastRound) {
  let canCloseOverlay = false;
  let mapsAnimationFinished = false;
  let scoreAnimationFinished = false;

  const overlay = document.createElement("div");
  overlay.className = "route-overlay";

  const playerStatus = playerRoute.possible
    ? `${Math.round(playerRoute.totalTime)} min`
    : "Trajet impossible";

  overlay.innerHTML = `
    <div class="route-overlay-panel route-overlay-panel-wide">
      <div class="route-overlay-header">
        <div>
          <p class="eyebrow">Comparaison</p>
          <h2>Ton trajet vs trajet optimal</h2>
        </div>

        <div class="overlay-score">
          <span>Score</span>
          <strong id="animated-score-value">0 / 100</strong>
        </div>
      </div>

      <div class="score-animation-row">
        <div class="score-detail-message">
          <span id="animated-score-message">Calcul du score...</span>
        </div>

        <div class="score-bar-track">
          <div id="animated-score-bar" class="score-bar-fill"></div>
        </div>
      </div>

      <div class="maps-comparison">
        <div class="map-card">
          <div class="map-card-header">
  <h3>Ton trajet</h3>
  <strong>${playerStatus}</strong>
</div>
          <div id="player-route-map" class="route-map-box"></div>
        </div>

        <div class="map-card">
          <div class="map-card-header">
  <h3>Trajet optimal</h3>
  <strong>${Math.round(optimalRoute.totalTime)} min</strong>
</div>
          <div id="optimal-route-map" class="route-map-box"></div>
        </div>
      </div>

      <button id="next-round" class="primary-button next-round-button" disabled>
        ${isLastRound ? "Voir le récapitulatif" : "Trajet suivant"}
      </button>
    </div>
  `;

  function tryUnlockNextButton() {
    if (!mapsAnimationFinished || !scoreAnimationFinished) return;

    canCloseOverlay = true;
    overlay.classList.add("overlay-can-close");
    overlay.querySelector("#next-round").disabled = false;
  }

  document.body.appendChild(overlay);

  overlay.querySelector("#next-round").addEventListener("click", () => {
    if (!canCloseOverlay) return;

    overlay.remove();

    if (isLastRound) {
      renderFinalScore();
    } else {
      goToNextRound();
    }
  });

  const fixedBounds = L.latLngBounds(
    [48.815573, 2.224199],
    [48.902145, 2.469920]
  );

  const playerMap = createRouteMap("player-route-map", fixedBounds);
  const optimalMap = createRouteMap("optimal-route-map", fixedBounds);

  if (playerRoute.possible) {
  drawRouteOnMap(playerMap, playerRoute, 300, () => {
    drawRouteOnMap(optimalMap, optimalRoute, 500, () => {
      mapsAnimationFinished = true;

      animateScoreDetails(overlay, score).then(() => {
        scoreAnimationFinished = true;
        tryUnlockNextButton();
      });
    });
  });
} else {
  showImpossibleRoute(playerMap);

  setTimeout(() => {
    drawRouteOnMap(optimalMap, optimalRoute, 500, () => {
      mapsAnimationFinished = true;

      animateScoreDetails(overlay, score).then(() => {
        scoreAnimationFinished = true;
        tryUnlockNextButton();
      });
    });
  }, 700);
}
}

function renderFinalScore() {
  clearInterval(timerId);
  roundEnded = true;

  const totalScore = roundScores.reduce((sum, round) => sum + round.score, 0);

  document.querySelector("#app").innerHTML = `
    <main class="page">
      <section class="game-card">
        <p class="eyebrow">Fin de partie</p>
        <h1>Score total : ${totalScore} / 500</h1>

        <div class="score-summary">
          ${roundScores
            .map(
              (round) => `
                <div class="score-row">
                  <div>
                    <strong>Manche ${round.round}</strong>
                    <span>${round.start} → ${round.end}</span>
                    <small>Ta réponse : ${round.playerLines} | Optimal : ${round.optimalLines}</small>
                  </div>
                  <strong>${round.score} / 100</strong>
                </div>
              `
            )
            .join("")}
        </div>

        <button id="restart-game" class="primary-button">
          Rejouer
        </button>
      </section>
    </main>
  `;

  document.querySelector("#restart-game").addEventListener("click", startGame);
}

function checkAnswer() {
  if (roundEnded) {
  return;
}

roundEnded = true;
clearInterval(timerId);
  
  const optimal = shortestPath(start, end);

  const playerAnswer = selectedLines;

  const optimalLines = normalizeLines(optimal.lines);
  const playerRoute = calculatePlayerRouteWithWalkingFallback(
  start,
  end,
  playerAnswer
);

  if (optimal.totalTime === Infinity) {
    document.querySelector("#result").innerHTML =
      "Aucun chemin trouvé entre ces deux stations.";
    return;
  }

  const elapsedSeconds = startTime
  ? Math.round((Date.now() - startTime) / 1000)
  : ROUND_DURATION;

const score = calculateScore(
  playerRoute,
  optimal,
  elapsedSeconds
);


  roundScores.push({
  round: currentRound,
  score: score.total,
  start,
  end,
  playerLines: playerAnswer.join(" / ") || "Aucune",
  optimalLines: optimalLines.join(" / "),
  playerTime: playerRoute.possible ? playerRoute.totalTime : null,
  optimalTime: optimal.totalTime,
});

  const isCorrect =
    playerRoute.possible &&
    playerAnswer.join("/") === optimalLines.join("/");

  const optimalTransferText =
    optimal.transfers.length > 0
      ? optimal.transfers
          .map((transfer) => `${transfer.station} : ${transfer.time} min`)
          .join("<br>")
      : "Aucune correspondance";

  const playerTransferText =
    playerRoute.transfers.length > 0
      ? playerRoute.transfers
          .map((transfer) => `${transfer.station} : ${transfer.time} min`)
          .join("<br>")
      : "Aucune correspondance";

  const scoreText = `
  <strong>Score :</strong> ${score.total} / 100<br>
  <strong>Détail du score :</strong><br>
  Qualité du trajet : ${score.routeScore} / 80<br>
  Temps de réponse : ${score.speedScore} / 20<br>
  ${
    score.gap === null
      ? "Écart avec l'optimal : non applicable"
      : `Écart avec l'optimal : +${Math.round(score.gap)} min`
  }
`;

  const playerRouteText = playerRoute.possible
    ? `
      <strong>Temps total de ton trajet :</strong> ${Math.round(playerRoute.totalTime)} min<br>
      <strong>Temps dans le métro :</strong> ${Math.round(playerRoute.rideTime)} min<br>
      <strong>Temps de correspondance :</strong> ${Math.round(playerRoute.transferTime)} min<br>
      <strong>Correspondances :</strong><br>
      ${playerTransferText}<br><br>
      <strong>Chemin de ton trajet :</strong> ${playerRoute.path.join(" → ")}
    `
    : `
      <strong>Trajet proposé :</strong> Impossible<br>
      Les lignes proposées ne permettent pas de relier ces deux stations dans cet ordre.
    `;

  document.querySelector("#result").innerHTML = `
    <strong>Ta réponse :</strong> ${playerAnswer.join(" / ") || "Aucune"}<br>
    <strong>Résultat :</strong> ${isCorrect ? "Correct" : "Incorrect"}<br><br>

    ${scoreText}<br><br>

    <strong>Analyse de ton trajet</strong><br>
    ${playerRouteText}<br><br>

    <hr>

    <strong>Solution optimale</strong><br>
    <strong>Temps total optimal :</strong> ${Math.round(optimal.totalTime)} min<br>
    <strong>Temps dans le métro :</strong> ${Math.round(optimal.rideTime)} min<br>
    <strong>Temps de correspondance :</strong> ${Math.round(optimal.transferTime)} min<br>
    <strong>Lignes optimales :</strong> ${optimalLines.join(" / ")}<br>
    <strong>Correspondances optimales :</strong><br>
    ${optimalTransferText}<br><br>
    <strong>Chemin optimal :</strong> ${optimal.path.join(" → ")}
  `;
  console.log("Player route:", playerRoute);
console.log("Optimal route:", optimal);



openRouteOverlay(playerRoute, optimal, score, currentRound >= TOTAL_ROUNDS);
}


