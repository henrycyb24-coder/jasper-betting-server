import express from "express";
import axios from "axios";
import admin from "firebase-admin";
import cron from "node-cron";

const app = express();
const PORT = process.env.PORT || 3000;

const SPORT_API_KEY = process.env.SPORTMONKS_API_KEY;
const FIREBASE_SERVICE = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Initialize Firebase
admin.initializeApp({
  credential: admin.credential.cert(FIREBASE_SERVICE),
  databaseURL: "https://jasperodds-2f95e-default-rtdb.firebaseio.com"
});

const db = admin.database();

/* ================= FETCH FIXTURES ================= */

async function fetchFixtures() {
  const today = new Date().toISOString().split("T")[0];

  const response = await axios.get(
    `https://api.sportmonks.com/v3/football/fixtures/date/${today}`,
    {
      params: {
        api_token: SPORT_API_KEY,
        include: "participants,odds,league,scores"
      }
    }
  );

  return response.data.data || [];
}

/* ================= PROBABILITY FUNCTION ================= */

function probabilityFromOdd(odd) {
  return (1 / odd) * 100;
}

/* ================= ADVANCED AI POISON ================= */

function advancedAI(match) {
  const home = match.participants?.find(p => p.meta?.location === "home")?.name;
  const away = match.participants?.find(p => p.meta?.location === "away")?.name;

  if (!home || !away) return null;

  const oddsArray = match.odds || [];
  const candidates = [];

  oddsArray.forEach(o => {
    if (!o.value || !o.label) return;

    const oddValue = parseFloat(o.value);
    const prob = probabilityFromOdd(oddValue);

    if (oddValue < 1.20 || oddValue > 5.00) return; // avoid extreme outliers

    let weight = 1;
    const label = o.label.toLowerCase();

    if (label.includes("over 1.5")) weight = 1.15;
    if (label.includes("btts") || label.includes("both")) weight = 1.10;
    if (label.includes("double chance")) weight = 1.10;
    if (label.includes("home") && !label.includes("over")) weight = 1.05;
    if (label.includes("away") && !label.includes("over")) weight = 1.05;

    const weightedScore = prob * weight;
    candidates.push({ label: o.label, odd: oddValue, probability: prob, weightedScore });
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.weightedScore - a.weightedScore);
  const best = candidates[0];

  return {
    league: match.league?.name || "",
    homeTeam: home,
    awayTeam: away,
    tip: best.label,
    odd: best.odd.toFixed(2),
    probability: best.probability.toFixed(1)
  };
}

/* ================= MOVE TO HISTORY ================= */

async function moveToHistory(section) {
  const today = new Date().toISOString().split("T")[0];
  const todayRef = db.ref(`jasper2plusodds/${section}/today`);
  const snapshot = await todayRef.once("value");
  if (!snapshot.exists()) return;

  await db.ref(`jasper2plusodds/${section}/history/${today}`).set(snapshot.val());
  await todayRef.remove();
}

/* ================= UPDATE RESULTS ================= */

async function updateResults() {
  const fixtures = await fetchFixtures();
  const finished = fixtures.filter(f => f.state === "FINISHED" || f.state === "Finished");

  for (const section of [
    "dailyTips",
    "bonusTips",
    "accumulator",
    "overUnder",
    "htFt",
    "correctScoreVip"
  ]) {
    const ref = db.ref(`jasper2plusodds/${section}/today`);
    const snapshot = await ref.once("value");
    if (!snapshot.exists()) continue;

    const tips = snapshot.val();

    for (const key in tips) {
      const tip = tips[key];

      const match = finished.find(
        f => 
          f.participants?.some(p => p.name === tip.homeTeam) &&
          f.participants?.some(p => p.name === tip.awayTeam)
      );

      if (!match) continue;

      const homeScore = match.scores?.localteam_score ?? 0;
      const awayScore = match.scores?.visitorteam_score ?? 0;
      let result = "lost";

      const t = tip.tip.toLowerCase();
      if (t.includes("over 1.5") && homeScore + awayScore > 1) result = "won";
      if (t.includes("home") && homeScore > awayScore) result = "won";
      if (t.includes("away") && awayScore > homeScore) result = "won";
      if (t.includes("btts") && homeScore > 0 && awayScore > 0) result = "won";

      await ref.child(key).update({ status: result });
    }
  }
}

/* ================= SAVE TIPS ================= */

async function saveTips(fixtures) {
  const today = new Date().toISOString().split("T")[0];
  const timestamp = Date.now();

  const limits = {
    dailyTips: 3,
    bonusTips: 3,
    overUnder: 3,
    htFt: 2,
    correctScoreVip: 2
  };

  const allPredictions = [];

  for (const match of fixtures) {
    const prediction = advancedAI(match);
    if (prediction) allPredictions.push(prediction);
  }

  for (const section in limits) {
    await moveToHistory(section);
    let count = 0;

    for (const p of allPredictions) {
      if (count >= limits[section]) break;

      await db
        .ref(`jasper2plusodds/${section}/today/match_${count}`)
        .set({
          date: today,
          league: p.league,
          homeTeam: p.homeTeam,
          awayTeam: p.awayTeam,
          tip: p.tip,
          odd: p.odd,
          status: "pending",
          createdAt: timestamp
        });

      count++;
    }
  }

  // Accumulator
  await moveToHistory("accumulator");
  const acca = allPredictions.sort((a,b) => b.probability - a.probability).slice(0, 4);
  for (let i = 0; i < acca.length; i++) {
    const p = acca[i];
    await db
      .ref(`jasper2plusodds/accumulator/today/match_${i}`)
      .set({
        date: today,
        league: p.league,
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        tip: p.tip,
        odd: p.odd,
        status: "pending",
        createdAt: timestamp
      });
  }

  console.log("FULL AI PREDICTIONS SAVED");
}

/* ================= GENERATE SYSTEM ================= */

async function generateSystem() {
  const fixtures = await fetchFixtures();
  await saveTips(fixtures);
  await updateResults();
}

app.get("/generate", async (req, res) => {
  await generateSystem();
  res.send("AI System Ran!");
});

/* ================= AUTO 6AM DAILY ================= */

cron.schedule("0 6 * * *", async () => {
  console.log("Running daily generation...");
  await generateSystem();
});

app.listen(PORT, () => console.log("Server running on port " + PORT));
