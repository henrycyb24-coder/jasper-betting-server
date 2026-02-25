const express = require("express");
const admin = require("firebase-admin");
const cron = require("node-cron");
const axios = require("axios");

const app = express();
app.use(express.json());

/* ==========================
   FIREBASE INIT
========================== */

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://jasper2plusodds-default-rtdb.firebaseio.com"
});

const db = admin.database();

/* ==========================
   CONFIG
========================== */

const API_KEY = process.env.SPORTMONKS_API_KEY;
const BASE_URL = "https://api.sportmonks.com/v3/football";

/* ==========================
   FETCH FIXTURES WITH ODDS
========================== */

async function fetchTodayFixtures() {
  const today = new Date().toISOString().split("T")[0];

  const url = `${BASE_URL}/fixtures/date/${today}?api_token=${API_KEY}&include=participants;odds`;

  const response = await axios.get(url);
  return response.data.data;
}

/* ==========================
   POISON LOGIC
========================== */

function analyzeFixture(fixture) {
  if (!fixture.odds || fixture.odds.length === 0) return null;

  const home = fixture.participants.find(p => p.meta.location === "home");
  const away = fixture.participants.find(p => p.meta.location === "away");

  const odds = fixture.odds;

  // Pick safest odd (lowest value above 1.20)
  const sortedOdds = odds
    .filter(o => o.value > 1.20)
    .sort((a, b) => a.value - b.value);

  if (!sortedOdds.length) return null;

  const selected = sortedOdds[0];

  return {
    date: fixture.starting_at.split(" ")[0],
    league: fixture.league?.name || "Unknown League",
    homeTeam: home?.name,
    awayTeam: away?.name,
    tip: selected.label,
    odd: selected.value,
    time: fixture.starting_at.split(" ")[1]?.substring(0, 5),
    status: "pending",
    createdAt: Date.now()
  };
}

/* ==========================
   MAIN ENGINE
========================== */

async function runAutoSystem() {
  console.log("Fetching real fixtures...");

  const fixtures = await fetchTodayFixtures();

  const predictions = fixtures
    .map(analyzeFixture)
    .filter(p => p !== null);

  if (!predictions.length) {
    console.log("No predictions available.");
    return;
  }

  const today = new Date().toISOString().split("T")[0];

  await db.ref("jasper2plusodds/dailyTips/today")
    .set(Object.fromEntries(predictions.slice(0,3).map((p,i)=>[`match_${i+1}`,p])));

  await db.ref("jasper2plusodds/bonusTips/today")
    .set(Object.fromEntries(predictions.slice(3,6).map((p,i)=>[`match_${i+1}`,p])));

  await db.ref("jasper2plusodds/accumulator/today")
    .set(Object.fromEntries(predictions.slice(6,10).map((p,i)=>[`match_${i+1}`,p])));

  await db.ref("jasper2plusodds/overUnder/today")
    .set(Object.fromEntries(predictions.slice(10,13).map((p,i)=>[`match_${i+1}`,p])));

  await db.ref("jasper2plusodds/htFt/today")
    .set(Object.fromEntries(predictions.slice(13,15).map((p,i)=>[`match_${i+1}`,p])));

  await db.ref("jasper2plusodds/correctScoreVip/today")
    .set(Object.fromEntries(predictions.slice(15,17).map((p,i)=>[`match_${i+1}`,p])));

  console.log("Real tips posted successfully.");
}

/* ==========================
   CRON 6AM GHANA
========================== */

cron.schedule("0 6 * * *", () => {
  runAutoSystem();
});

/* Manual Test */
app.get("/run-now", async (req, res) => {
  await runAutoSystem();
  res.send("Real system executed ✅");
});

app.get("/", (req, res) => {
  res.send("Jasper Real Betting Engine Running 🚀");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on ${PORT}`));
